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

/** POST JSON borné dans le temps ; ne lève jamais. */
export async function cloudPost(
  path: string,
  body: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CloudSyncOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${cloudBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    })
    let data: Record<string, unknown> = {}
    try { data = await res.json() } catch { /* corps non JSON */ }
    return {
      ok: res.ok && data.ok !== false,
      status: res.status,
      code: typeof data.code === 'string' ? data.code : undefined,
      data,
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return { ok: false, code: aborted ? 'TIMEOUT' : 'NETWORK' }
  } finally {
    clearTimeout(timer)
  }
}
