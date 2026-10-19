/**
 * Adaptateur GÉNÉRIQUE pour une PLATEFORME AGRÉÉE (PA, ex-PDP).
 *
 * ─── Pourquoi générique ─────────────────────────────────────────────────────
 * Le registre compte plus de 130 plateformes agréées, chacune avec sa propre
 * API, sous contrat commercial. Aucune spécification publique commune n'existe
 * côté HTTP. Deux voies s'offraient :
 *
 *   1. coder en dur les routes d'une plateforme donnée — impossible sans sa
 *      documentation, et inventer une route serait exactement le genre de faux
 *      connecteur que cet audit existe pour éliminer ;
 *   2. implémenter INTÉGRALEMENT la mécanique (authentification, envoi,
 *      idempotence, relecture de statut, correspondance des statuts, gestion des
 *      rejets) et traiter ce qui varie d'une plateforme à l'autre — URL de base,
 *      chemins, mode d'authentification — comme de la CONFIGURATION explicite,
 *      fournie par le garage depuis son contrat.
 *
 * C'est la voie 2. Rien n'est simulé : chaque appel part réellement sur le
 * réseau, et un échec est rapporté comme un échec (§3, §86).
 *
 * ─── Ce que l'adaptateur ne fait jamais ─────────────────────────────────────
 *  - retourner `{ ok: true }` sans appel réel ;
 *  - inventer un statut `accepted` quand la plateforme dit seulement `submitted`
 *    (§92) — le statut brut est conservé tel quel à côté du statut canonique ;
 *  - journaliser un identifiant, un secret ou un jeton.
 */

import type {
  ConnectionTestResult,
  ConnectionValidationResult,
  CanonicalEInvoiceStatus,
  EInvoiceProviderAdapter,
  EInvoiceProviderCapabilities,
  InvoiceStatusContext,
  InvoiceStatusResult,
  ProviderConnectionContext,
  SubmitInvoiceContext,
  SubmitInvoiceResult,
} from '../adapter'
import { verifierDestination, verifierDestinationSync } from '../ssrf-guard'

/** Identifiant de l'adaptateur, référencé par `ApprovedEInvoicePlatform.adapterId`. */
export const GENERIC_PA_ADAPTER_ID = 'generic-pa'

/** Délai maximal d'un appel plateforme — au-delà, on ne bloque pas l'utilisateur. */
const TIMEOUT_MS = 20_000

/**
 * Champs de configuration d'une connexion.
 *
 * `apiBaseUrl`, `submitPath` et `statusPath` ne sont PAS des secrets : ils
 * décrivent le point d'entrée de la plateforme. Ils sont néanmoins transportés
 * avec les identifiants pour rester d'un seul tenant côté serveur.
 */
export interface GenericPaCredentials {
  /** `oauth2` (client_credentials) ou `api_key`. */
  authMode: 'oauth2' | 'api_key'
  /** Racine de l'API, ex. `https://api.exemple-pa.fr`. HTTPS obligatoire. */
  apiBaseUrl: string
  /** Chemin d'envoi, ex. `/v1/invoices`. */
  submitPath: string
  /**
   * Chemin de relecture de statut. `{id}` y est remplacé par l'identifiant
   * externe retourné à l'envoi, ex. `/v1/invoices/{id}`.
   */
  statusPath: string
  /** OAuth2 — point de jeton. */
  tokenUrl?: string
  clientId?: string
  clientSecret?: string
  scope?: string
  /** Clé API — en-tête et valeur. */
  apiKeyHeader?: string
  apiKey?: string
  /** En-tête supplémentaire éventuel (ex. compte technique). */
  extraHeaderName?: string
  extraHeaderValue?: string
  /**
   * Secret HMAC-SHA256 des webhooks entrants (`X-GF-Signature`). Facultatif :
   * sans lui, le connecteur fonctionne en sortant mais refuse tout webhook
   * (aucune modification de statut ne peut être prouvée).
   */
  webhookSecret?: string
}

/** Champs jamais renvoyés au client, même tronqués. */
export const CHAMPS_SECRETS: ReadonlyArray<keyof GenericPaCredentials> = [
  'clientSecret',
  'apiKey',
  'extraHeaderValue',
  'webhookSecret',
]

/** Champs de configuration, sûrs à réafficher pour diagnostic. */
export const CHAMPS_PUBLICS: ReadonlyArray<keyof GenericPaCredentials> = [
  'authMode', 'apiBaseUrl', 'submitPath', 'statusPath', 'tokenUrl', 'scope',
  'apiKeyHeader', 'extraHeaderName', 'clientId',
]

function estUrlHttps(v: unknown): boolean {
  // HTTPS ne suffit pas : `https://169.254.169.254/…` et `https://10.0.0.5/…`
  // le sont aussi. La garde refuse en plus les hôtes réservés et les adresses
  // non routables (voir ssrf-guard.ts).
  return verifierDestinationSync(v).ok
}

function estChemin(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith('/') && !v.includes(' ')
}

/** Construit une URL absolue en évitant le double `/`. */
function joindre(base: string, chemin: string): string {
  return `${base.replace(/\/+$/, '')}${chemin}`
}

/** Jeton OAuth2 mis en cache par connexion, jusqu'à sa péremption. */
interface JetonCache { valeur: string; expireA: number }
const cacheJetons = new Map<string, JetonCache>()

/** Vidé par les tests et à la déconnexion — un secret retiré ne doit plus servir. */
export function oublierJetons(cle?: string): void {
  if (cle) cacheJetons.delete(cle)
  else cacheJetons.clear()
}

function cleCache(ctx: ProviderConnectionContext): string {
  return `${ctx.garageId}:${ctx.providerId}:${ctx.environment}`
}

/**
 * Appel sortant borné en temps ET en destination.
 *
 * Deux gardes indissociables :
 *  - `verifierDestination` (avec résolution DNS) est rejouée à CHAQUE appel, et
 *    pas seulement à l'enregistrement de la configuration : une zone DNS peut
 *    changer entre les deux, et `submitPath` / `statusPath` sont concaténés à
 *    la base au moment de l'appel ;
 *  - `redirect: 'error'` : `fetch` suit les redirections par défaut. La
 *    garantie « HTTPS obligatoire » ne portait donc que sur le premier saut, et
 *    une réponse `302 Location: http://169.254.169.254/…` emportait en-têtes
 *    personnalisés et corps de facture vers l'hôte désigné. Une plateforme
 *    agréée n'a aucune raison de rediriger un appel d'API : le refus est franc.
 */
async function fetchAvecDelai(url: string, init: RequestInit): Promise<Response> {
  // The existing deadline covers DNS AND dispatch/response headers. A lookup
  // cannot be cancelled by node:dns, but it must not hold the caller forever,
  // reset the budget, or dispatch a request after the deadline has expired.
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Request aborted: platform deadline exceeded')
      error.name = 'AbortError'
      ctrl.abort(error)
      reject(error)
    }, TIMEOUT_MS)
  })
  try {
    return await Promise.race([
      (async () => {
        const verdict = await verifierDestination(url)
        if (ctrl.signal.aborted) throw ctrl.signal.reason
        if (!verdict.ok) throw new Error(verdict.message ?? 'Destination refusée.')
        return fetch(url, { ...init, signal: ctrl.signal, redirect: 'error' })
      })(),
      expired,
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Message opérateur à partir d'un code HTTP — jamais une pile, jamais un secret. */
export function messageHttp(status: number): string {
  if (status === 401) return 'Identifiants refusés par la plateforme (401). Vérifiez la clé ou le couple client.'
  if (status === 403) return "Accès refusé par la plateforme (403). Le compte n'a pas les droits nécessaires."
  if (status === 404) return 'Point d’entrée introuvable (404). Vérifiez l’URL de l’API et les chemins configurés.'
  if (status === 409) return 'Conflit signalé par la plateforme (409).'
  if (status === 422) return 'Document refusé par la plateforme (422) : voir le détail du rejet.'
  if (status === 429) return 'Trop de requêtes (429). Réessayez dans quelques instants.'
  if (status >= 500) return `La plateforme est indisponible (${status}). Réessayez plus tard.`
  return `Réponse inattendue de la plateforme (${status}).`
}

/** Message opérateur pour une panne réseau/TLS/DNS — sans détail interne. */
export function messageReseau(err: unknown): string {
  const brut = err instanceof Error ? err.message : ''
  if (/abort/i.test(brut)) return 'La plateforme n’a pas répondu dans le délai imparti.'
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(brut)) return 'Nom de domaine introuvable : vérifiez l’URL de l’API.'
  if (/CERT|TLS|SSL|self.signed/i.test(brut)) return 'Certificat TLS refusé par la plateforme.'
  if (/ECONNREFUSED/i.test(brut)) return 'Connexion refusée par la plateforme.'
  return 'Impossible de joindre la plateforme.'
}

/**
 * Correspondance statut plateforme → statut canonique.
 *
 * Toute valeur non reconnue devient `unknown` — JAMAIS `accepted`. Le statut
 * brut est conservé par l'appelant pour diagnostic (§92).
 */
export function mapStatut(rawStatus: string): CanonicalEInvoiceStatus {
  const s = String(rawStatus ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  const table: Record<string, CanonicalEInvoiceStatus> = {
    draft: 'draft', brouillon: 'draft',
    pending: 'submission_pending', enattente: 'submission_pending', queued: 'submission_pending',
    submitted: 'submitted', envoye: 'submitted', envoyee: 'submitted', sent: 'submitted',
    received: 'received_by_platform', recu: 'received_by_platform', recue: 'received_by_platform',
    delivered: 'delivered', delivre: 'delivered', delivree: 'delivered', distribuee: 'delivered',
    accepted: 'accepted', accepte: 'accepted', acceptee: 'accepted', approved: 'accepted',
    rejected: 'rejected', rejete: 'rejected', rejetee: 'rejected',
    refused: 'refused', refuse: 'refused', refusee: 'refused',
    paid: 'paid', paye: 'paid', payee: 'paid', encaissee: 'paid',
    error: 'error', erreur: 'error', failed: 'error',
  }
  return table[s] ?? 'unknown'
}

function credentials(ctx: ProviderConnectionContext): GenericPaCredentials {
  return ctx.credentials as unknown as GenericPaCredentials
}

/** En-têtes d'authentification, jamais journalisés. */
async function entetesAuth(ctx: ProviderConnectionContext): Promise<Record<string, string>> {
  const c = credentials(ctx)
  const entetes: Record<string, string> = { accept: 'application/json' }

  if (c.extraHeaderName && c.extraHeaderValue) {
    entetes[c.extraHeaderName] = c.extraHeaderValue
  }

  if (c.authMode === 'api_key') {
    entetes[c.apiKeyHeader || 'authorization'] = c.apiKey ?? ''
    return entetes
  }

  // OAuth2 client_credentials, jeton mis en cache jusqu'à 30 s avant péremption.
  const cle = cleCache(ctx)
  const enCache = cacheJetons.get(cle)
  if (enCache && enCache.expireA > Date.now()) {
    entetes.authorization = `Bearer ${enCache.valeur}`
    return entetes
  }

  const corps = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: c.clientId ?? '',
    client_secret: c.clientSecret ?? '',
    ...(c.scope ? { scope: c.scope } : {}),
  })
  const r = await fetchAvecDelai(c.tokenUrl as string, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: corps.toString(),
  })
  if (!r.ok) throw new ErreurPlateforme(r.status, messageHttp(r.status))

  const j = (await r.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null
  const jeton = j?.access_token
  if (!jeton) throw new ErreurPlateforme(502, 'La plateforme n’a pas renvoyé de jeton d’accès exploitable.')

  const dureeS = Number.isFinite(j?.expires_in) ? Number(j?.expires_in) : 300
  cacheJetons.set(cle, { valeur: jeton, expireA: Date.now() + Math.max(0, dureeS - 30) * 1000 })
  entetes.authorization = `Bearer ${jeton}`
  return entetes
}

export class ErreurPlateforme extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

export const genericPaAdapter: EInvoiceProviderAdapter = {
  providerId: GENERIC_PA_ADAPTER_ID,
  displayName: 'Plateforme agréée (configuration manuelle)',

  async getCapabilities(): Promise<EInvoiceProviderCapabilities> {
    return {
      outgoingInvoices: true,
      incomingInvoices: false,
      invoiceStatuses: true,
      // Réception HMAC-SHA256 implémentée dans `webhook.ts` (route
      // /api/einvoicing/webhooks/[providerId]). Sans secret configuré, la route
      // refuse — la capacité est donc réelle mais opt-in par connexion.
      webhooks: true,
      eReporting: false,
      paymentReporting: false,
      sandbox: true,
    }
  },

  async validateConfiguration(ctx: ProviderConnectionContext): Promise<ConnectionValidationResult> {
    const c = credentials(ctx)
    if (c?.authMode !== 'oauth2' && c?.authMode !== 'api_key') {
      return { ok: false, reason: 'Mode d’authentification manquant (oauth2 ou api_key).' }
    }
    if (!estUrlHttps(c.apiBaseUrl)) {
      return { ok: false, reason: 'URL de l’API manquante ou non HTTPS.' }
    }
    if (!estChemin(c.submitPath)) return { ok: false, reason: 'Chemin d’envoi invalide (doit commencer par « / »).' }
    if (!estChemin(c.statusPath)) return { ok: false, reason: 'Chemin de statut invalide (doit commencer par « / »).' }
    if (!c.statusPath.includes('{id}')) {
      return { ok: false, reason: 'Le chemin de statut doit contenir « {id} ».' }
    }
    if (c.authMode === 'oauth2') {
      if (!estUrlHttps(c.tokenUrl)) return { ok: false, reason: 'URL du jeton OAuth2 manquante ou non HTTPS.' }
      if (!c.clientId || !c.clientSecret) return { ok: false, reason: 'Identifiant ou secret client manquant.' }
    } else if (!c.apiKey) {
      return { ok: false, reason: 'Clé API manquante.' }
    }
    return { ok: true }
  },

  /**
   * Test de connexion RÉEL : obtention effective des en-têtes d'authentification
   * (donc, en OAuth2, un aller-retour sur le point de jeton) puis un appel au
   * point d'entrée d'envoi en lecture. Un `{ ok: true }` n'est jamais renvoyé
   * sans qu'un échange réseau ait eu lieu (§86).
   */
  async testConnection(ctx: ProviderConnectionContext): Promise<ConnectionTestResult> {
    const valide = await this.validateConfiguration(ctx)
    if (!valide.ok) {
      return { ok: false, message: valide.reason ?? 'Configuration incomplète.', recommendedAction: 'Complétez la configuration.' }
    }
    const c = credentials(ctx)
    try {
      const entetes = await entetesAuth(ctx)
      const r = await fetchAvecDelai(joindre(c.apiBaseUrl, c.submitPath), { method: 'GET', headers: entetes })

      // 404/405 sur une LECTURE d'un point d'envoi est normal — MAIS SEULEMENT
      // EN OAUTH2 (GF-025). Là, `entetesAuth` a réellement exécuté l'échange
      // `client_credentials` et lève sur refus : l'authentification est prouvée
      // avant l'appel, et le code de retour du point d'envoi n'apporte rien.
      //
      // En mode CLÉ D'API, rien de tel : l'en-tête est simplement recopié, aucun
      // aller-retour d'authentification n'a lieu. Un 404 y signifiait donc
      // seulement « quelque chose a répondu à cette adresse » — un site vitrine
      // suffisait. La connexion était alors enregistrée `lastTestOk: true`,
      // `status: 'connected'`, et l'écran affichait une pastille « Testée » sur
      // une plateforme qui n'a jamais vu passer la moindre facture.
      const c404Acceptable = (r.status === 404 || r.status === 405) && c.authMode === 'oauth2'
      if (r.ok || c404Acceptable) {
        return {
          ok: true,
          environment: ctx.environment,
          message: `Connexion établie avec la plateforme (${r.status}).`,
          capabilities: await this.getCapabilities(),
        }
      }
      return { ok: false, message: messageHttp(r.status), recommendedAction: r.status === 401 || r.status === 403 ? 'Vérifiez les identifiants.' : 'Vérifiez l’URL et les chemins.' }
    } catch (err) {
      if (err instanceof ErreurPlateforme) return { ok: false, message: err.message }
      return { ok: false, message: messageReseau(err) }
    }
  },

  /**
   * Envoi RÉEL du document. La clé d'idempotence est transmise à la plateforme
   * (en-tête `Idempotency-Key`, convention la plus répandue) ET conservée côté
   * GarageFlows : c'est la persistance locale qui garantit qu'une facture n'est
   * pas soumise deux fois, indépendamment du comportement de la plateforme.
   */
  async submitInvoice(ctx: SubmitInvoiceContext): Promise<SubmitInvoiceResult> {
    // La configuration est revalidée ICI, et pas seulement au « Tester la
    // connexion » : c'est l'envoi qui transporte la facture ET la clé API. Une
    // connexion enregistrée avant un durcissement, restaurée depuis une
    // sauvegarde, ou modifiée en base, aurait sinon transmis les deux EN CLAIR
    // sur `http://` sans qu'aucun contrôle ne s'y oppose.
    const valide = await this.validateConfiguration(ctx as unknown as ProviderConnectionContext)
    if (!valide.ok) {
      throw new ErreurPlateforme(0, `Configuration de plateforme inutilisable : ${valide.reason ?? 'incomplète'}`)
    }
    const c = credentials(ctx)
    const entetes = await entetesAuth(ctx)
    const r = await fetchAvecDelai(joindre(c.apiBaseUrl, c.submitPath), {
      method: 'POST',
      headers: {
        ...entetes,
        'content-type': 'application/json',
        'idempotency-key': ctx.idempotencyKey,
      },
      body: JSON.stringify({
        format: ctx.documentFormat,
        documentSha256: ctx.documentSha256,
        // Le document réglementaire lui-même, encodé — aucune transformation
        // supplémentaire n'est appliquée à ce stade.
        document: Buffer.from(ctx.document).toString('base64'),
        ...(ctx.legalEntityId ? { legalEntityId: ctx.legalEntityId } : {}),
      }),
    })

    const charge = (await r.json().catch(() => null)) as Record<string, unknown> | null
    if (!r.ok) {
      const detail = typeof charge?.message === 'string' ? ` — ${charge.message}` : ''
      throw new ErreurPlateforme(r.status, `${messageHttp(r.status)}${detail}`)
    }

    // L'identifiant externe est indispensable : sans lui, aucun suivi n'est
    // possible et l'on ne saurait pas si un rejeu créerait un doublon.
    const externalId =
      (typeof charge?.id === 'string' && charge.id) ||
      (typeof charge?.externalId === 'string' && charge.externalId) ||
      (typeof charge?.invoiceId === 'string' && charge.invoiceId) ||
      ''
    if (!externalId) {
      throw new ErreurPlateforme(502, 'La plateforme n’a pas renvoyé d’identifiant de suivi : envoi non traçable.')
    }

    const rawStatus = typeof charge?.status === 'string' ? charge.status : 'submitted'
    return { externalId, status: mapStatut(rawStatus), rawStatus }
  },

  async getInvoiceStatus(ctx: InvoiceStatusContext): Promise<InvoiceStatusResult> {
    const c = credentials(ctx)
    const entetes = await entetesAuth(ctx)
    const url = joindre(c.apiBaseUrl, c.statusPath.replace('{id}', encodeURIComponent(ctx.externalId)))
    const r = await fetchAvecDelai(url, { method: 'GET', headers: entetes })
    if (!r.ok) throw new ErreurPlateforme(r.status, messageHttp(r.status))

    const charge = (await r.json().catch(() => null)) as Record<string, unknown> | null
    const rawStatus = typeof charge?.status === 'string' ? charge.status : ''
    return { status: mapStatut(rawStatus), rawStatus, rawPayload: charge }
  },

  mapProviderStatus(rawStatus: string): CanonicalEInvoiceStatus {
    return mapStatut(rawStatus)
  },
}
