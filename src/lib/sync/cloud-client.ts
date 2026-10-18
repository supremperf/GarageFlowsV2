/**
 * Client de synchronisation POSTE → CLOUD (côté serveur Next embarqué d'Electron).
 *
 * Ne s'exécute JAMAIS sur le déploiement cloud lui-même : là-bas la base EST la
 * source de vérité (`isPostgresDatabase()`), il n'y a rien à remonter.
 *
 * Tout est BEST-EFFORT et borné dans le temps : une panne réseau ne doit jamais
 * faire échouer l'action locale du patron. L'état de synchronisation est
 * remonté à l'appelant pour que l'interface dise la vérité
 * (« attribution enregistrée · synchronisation cloud en attente ») plutôt que
 * d'annoncer un succès qui n'a pas eu lieu.
 */
import { isPostgresDatabase } from '@/lib/db'
import { JsonResponseError, readJsonObject } from '@/lib/security/bounded-json-response'

/** URL officielle compilée — même constante que electron/license-endpoint.js. */
export const OFFICIAL_LICENSE_SERVER = 'https://app.garageflows.fr'

/**
 * Base de l'autorité cloud. Une surcharge non-HTTPS est ignorée (anti-downgrade),
 * sauf en développement local explicite (`GF_ALLOW_INSECURE_SYNC=1`) pour pouvoir
 * tester la chaîne complète contre un serveur de recette.
 */
export function cloudBaseUrl(): string {
  const raw = String(process.env.GF_LICENSE_SERVER ?? '').trim().replace(/\/+$/, '')
  if (!raw) return OFFICIAL_LICENSE_SERVER
  if (/^https:\/\//i.test(raw)) return raw
  if (process.env.GF_ALLOW_INSECURE_SYNC === '1' && /^http:\/\//i.test(raw)) return raw
  return OFFICIAL_LICENSE_SERVER
}

/** Vrai si CETTE instance est un poste (et doit donc remonter au cloud). */
export function isDesktopInstance(): boolean {
  return !isPostgresDatabase()
}

/**
 * Licence GARAGE active du poste — SA seule preuve d'identité auprès du cloud.
 *
 * Vit ici plutôt que dans un module métier : plusieurs voies de remontée en ont
 * besoin (interventions, mécaniciens, publication de devis) et il ne doit
 * exister qu'UNE définition de « quelle licence prouve ce garage ». Une clé
 * mécanicien est explicitement écartée : elle ne pilote rien.
 */
export async function garageLicenseToken(garageId: string): Promise<string | null> {
  const { prisma } = await import('@/lib/db')
  const license = await prisma.licenseKey.findFirst({
    where: { garageId, status: 'active', licenseType: { not: 'mechanic' } },
    select: { token: true },
    orderBy: { createdAt: 'desc' },
  })
  return license?.token ?? null
}

export interface CloudSyncOutcome {
  ok: boolean
  /** Code renvoyé par le cloud, ou 'NETWORK'/'TIMEOUT' si injoignable. */
  code?: string
  status?: number
  data?: Record<string, unknown>
}

const DEFAULT_TIMEOUT_MS = 8_000
// Photo responses may contain an 8 MiB image in base64 (~10.67 MiB), plus JSON.
// This budget is for response envelopes only; uploads/business limits are unchanged.
export const MAX_CLOUD_RESPONSE_BYTES = 16 * 1024 * 1024
const BOUNDED_REPLY_PATHS = new Set([
  '/api/sync/job-photo', '/api/sync/mechanic-assignment', '/api/sync/mechanic-status',
  '/api/sync/mechanic-avatar', '/api/sync/portal-account', '/api/sync/quote', '/api/sync/portal',
])

/** POST JSON borné dans le temps ; ne lève jamais. */
export async function cloudPost(
  path: string,
  body: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CloudSyncOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let status: number | undefined
  try {
    const res = await fetch(`${cloudBaseUrl()}${path}`, {
      method: 'POST',
      // Never forward license tokens, avatars or business bodies across a redirect.
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    })
    status = res.status
    // Legacy bulk proofs/message histories can validly exceed 16 MiB. Do not
    // break them with a silent global cap: preserve their budget until the
    // producer/client pagination protocol is upgraded. They remain deadline-
    // and chunk-bounded, but their total-byte risk is explicitly still open.
    const data = await readJsonObject(res, {
      maxBytes: !res.ok || BOUNDED_REPLY_PATHS.has(path) ? MAX_CLOUD_RESPONSE_BYTES : Infinity,
      signal: controller.signal,
    })
    // All current sync handlers explicitly acknowledge success. A captive HTML
    // page, truncated body, scalar or empty envelope must never mark local work synced.
    if ((!res.ok && data.ok === true) || (res.ok && data.ok !== false && (!Object.hasOwn(data, 'ok') || data.ok !== true))) {
      throw new JsonResponseError('INVALID_RESPONSE')
    }
    return {
      ok: res.ok && data.ok === true,
      status: res.status,
      code: typeof data.code === 'string' ? data.code : undefined,
      data,
    }
  } catch (err) {
    const aborted = controller.signal.aborted || err instanceof Error && err.name === 'AbortError'
    if (aborted) return { ok: false, code: 'TIMEOUT' }
    if (err instanceof JsonResponseError) {
      return { ok: false, code: err.code, status: status !== undefined && status >= 400 ? status : 502,
        data: { ok: false, code: err.code } }
    }
    return { ok: false, code: 'NETWORK' }
  } finally {
    clearTimeout(timer)
  }
}
