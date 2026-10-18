/**
 * Adaptateur « plateforme agréée » — comportement RÉEL.
 *
 * `fetch` global est remplacé par un espion : ce sont donc les vraies requêtes
 * construites par l'adaptateur qui sont observées (méthode, URL, en-têtes,
 * corps), pas une imitation de l'adaptateur lui-même. Ce que ces tests
 * établissent :
 *
 *  - un test de connexion ne renvoie JAMAIS `ok: true` sans échange réseau (§86) ;
 *  - un statut inconnu ne devient JAMAIS `accepted` (§92) ;
 *  - la clé d'idempotence part bien vers la plateforme ;
 *  - un envoi sans identifiant de suivi est un ÉCHEC, pas un succès silencieux ;
 *  - aucun secret ne transite dans une URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Simulated transport includes DNS, while the real SSRF guard stays enabled.
const dns = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }))
import {
  genericPaAdapter, mapStatut, messageHttp, messageReseau, oublierJetons,
  type GenericPaCredentials,
} from '@/lib/einvoicing/adapters/generic-pa'

const BASE: GenericPaCredentials = {
  authMode: 'api_key',
  apiBaseUrl: 'https://api.plateforme-test.fr',
  submitPath: '/v1/invoices',
  statusPath: '/v1/invoices/{id}',
  apiKeyHeader: 'x-api-key',
  apiKey: 'CLE-SECRETE-NE-DOIT-PAS-FUIR',
}

const OAUTH: GenericPaCredentials = {
  authMode: 'oauth2',
  apiBaseUrl: 'https://api.plateforme-test.fr',
  submitPath: '/v1/invoices',
  statusPath: '/v1/invoices/{id}',
  tokenUrl: 'https://auth.plateforme-test.fr/token',
  clientId: 'client-123',
  clientSecret: 'SECRET-CLIENT-NE-DOIT-PAS-FUIR',
  scope: 'invoices',
}

function ctx(credentials: GenericPaCredentials = BASE) {
  return {
    garageId: 'gA', providerId: 'generic-pa', environment: 'sandbox' as const,
    credentials: credentials as unknown as Record<string, string>,
  }
}

let appels: Array<{ url: string; init: RequestInit }> = []

function reponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  dns.lookup.mockReset().mockImplementation(async (hostname: string) => [{
    address: ['api.plateforme-test.fr', 'auth.plateforme-test.fr'].includes(hostname) ? '93.184.216.34' : '127.0.0.1', family: 4,
  }])
  appels = []
  oublierJetons()
})
afterEach(() => { vi.unstubAllGlobals() })

function espionner(reponses: Array<Response | Error>) {
  let i = 0
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    appels.push({ url: String(url), init })
    const r = reponses[Math.min(i++, reponses.length - 1)]
    if (r instanceof Error) throw r
    return r
  })
}

describe('validateConfiguration — refuse une configuration inexploitable', () => {
  it.each([
    ['mode d’authentification absent', { ...BASE, authMode: undefined as never }],
    ['URL non HTTPS', { ...BASE, apiBaseUrl: 'http://api.plateforme-test.fr' }],
    ['URL absente', { ...BASE, apiBaseUrl: '' }],
    ['chemin d’envoi sans « / »', { ...BASE, submitPath: 'v1/invoices' }],
    ['chemin de statut sans {id}', { ...BASE, statusPath: '/v1/invoices' }],
    ['clé API absente', { ...BASE, apiKey: undefined }],
    ['OAuth2 sans secret', { ...OAUTH, clientSecret: undefined }],
    ['OAuth2 avec point de jeton non HTTPS', { ...OAUTH, tokenUrl: 'http://auth.test/token' }],
  ])('%s → refus motivé', async (_libelle, creds) => {
    const r = await genericPaAdapter.validateConfiguration(ctx(creds as GenericPaCredentials))
    expect(r.ok).toBe(false)
    expect(r.reason).toBeTruthy()
  })

  it('accepte une configuration complète (clé API et OAuth2)', async () => {
    expect((await genericPaAdapter.validateConfiguration(ctx(BASE))).ok).toBe(true)
    expect((await genericPaAdapter.validateConfiguration(ctx(OAUTH))).ok).toBe(true)
  })
})

describe('testConnection — appel RÉSEAU réel, jamais de succès simulé', () => {
  it('une configuration invalide échoue SANS aucune requête', async () => {
    espionner([reponse({}, 200)])
    const r = await genericPaAdapter.testConnection(ctx({ ...BASE, apiKey: undefined }))
    expect(r.ok).toBe(false)
    expect(appels).toHaveLength(0)
  })

  it('succès → une requête est réellement partie, avec l’en-tête d’authentification', async () => {
    espionner([reponse({}, 200)])
    const r = await genericPaAdapter.testConnection(ctx())
    expect(r.ok).toBe(true)
    expect(appels).toHaveLength(1)
    expect(appels[0].url).toBe('https://api.plateforme-test.fr/v1/invoices')
    expect((appels[0].init.headers as Record<string, string>)['x-api-key']).toBe(BASE.apiKey)
  })

  /**
   * ─── 404/405 ne valent « authentification acceptée » qu'en OAUTH2 (GF-025) ──
   *
   * Le test affirmait auparavant l'inverse pour TOUS les modes. Le raisonnement
   * — « le point d'envoi refuse la lecture, donc l'authentification est passée »
   * — ne tient qu'en OAuth2, où `entetesAuth` a réellement exécuté l'échange
   * `client_credentials` et lève sur refus.
   *
   * En mode CLÉ D'API, aucun aller-retour d'authentification n'a lieu : l'en-tête
   * est simplement recopié. Un 404 y prouve seulement que « quelque chose a
   * répondu à cette adresse » — un site vitrine suffisait. La connexion était
   * alors enregistrée `lastTestOk: true`, `status: 'connected'`, et l'écran
   * affichait une pastille « Testée » sur une plateforme qui n'avait jamais vu
   * passer la moindre facture.
   */
  it('CLÉ D’API : un 405 n’est PAS un succès — rien n’a authentifié quoi que ce soit', async () => {
    espionner([reponse({}, 405)])
    const r = await genericPaAdapter.testConnection(ctx())
    expect(r.ok).toBe(false)
    expect(r.message, 'le motif doit être actionnable').toMatch(/405|introuvable|autorisée|URL/i)
  })

  it('OAUTH2 : un 405 après un échange de jeton RÉUSSI vaut authentification acceptée', async () => {
    // Première réponse : le point de jeton. Seconde : la lecture du point d'envoi.
    espionner([reponse({ access_token: 'jeton-de-test', expires_in: 3600 }, 200), reponse({}, 405)])
    const r = await genericPaAdapter.testConnection(ctx(OAUTH))
    expect(r.ok, r.message).toBe(true)
    expect(appels.length, 'l’échange de jeton doit avoir eu lieu').toBeGreaterThanOrEqual(2)
  })

  it.each([[401], [403], [500]])('HTTP %i → échec avec message actionnable', async (status) => {
    espionner([reponse({}, status)])
    const r = await genericPaAdapter.testConnection(ctx())
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/\d{3}|plateforme/i)
  })

  it('panne réseau → échec explicite, jamais un succès', async () => {
    espionner([new Error('getaddrinfo ENOTFOUND api.plateforme-test.fr')])
    const r = await genericPaAdapter.testConnection(ctx())
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/domaine/i)
  })

  it('OAuth2 : obtient un jeton PUIS appelle l’API, et met le jeton en cache', async () => {
    espionner([reponse({ access_token: 'jeton-abc', expires_in: 3600 }), reponse({}, 200)])
    const r = await genericPaAdapter.testConnection(ctx(OAUTH))
    expect(r.ok).toBe(true)
    expect(appels).toHaveLength(2)
    expect(appels[0].url).toBe(OAUTH.tokenUrl)
    expect(String(appels[0].init.body)).toContain('grant_type=client_credentials')
    expect((appels[1].init.headers as Record<string, string>).authorization).toBe('Bearer jeton-abc')

    // Second appel : le jeton est réutilisé, aucun aller-retour supplémentaire.
    appels = []
    espionner([reponse({}, 200)])
    await genericPaAdapter.testConnection(ctx(OAUTH))
    expect(appels).toHaveLength(1)
  })

  it('OAuth2 sans jeton exploitable dans la réponse → échec', async () => {
    espionner([reponse({ pas_de_jeton: true }, 200)])
    const r = await genericPaAdapter.testConnection(ctx(OAUTH))
    expect(r.ok).toBe(false)
  })
})

describe('submitInvoice — envoi réel et traçabilité', () => {
  const envoi = {
    ...ctx(),
    invoiceId: 'inv-1',
    idempotencyKey: 'cle-idem-abcdef',
    documentFormat: 'cii' as const,
    document: Buffer.from('<xml/>', 'utf8'),
    documentSha256: 'a'.repeat(64),
  }

  it('transmet la clé d’idempotence et l’empreinte du document', async () => {
    espionner([reponse({ id: 'EXT-1', status: 'submitted' }, 201)])
    const r = await genericPaAdapter.submitInvoice(envoi)

    const entetes = appels[0].init.headers as Record<string, string>
    expect(appels[0].init.method).toBe('POST')
    expect(entetes['idempotency-key']).toBe('cle-idem-abcdef')
    const corps = JSON.parse(String(appels[0].init.body))
    expect(corps.documentSha256).toBe('a'.repeat(64))
    expect(Buffer.from(corps.document, 'base64').toString('utf8')).toBe('<xml/>')
    expect(r.externalId).toBe('EXT-1')
    expect(r.status).toBe('submitted')
  })

  it('ÉCHOUE si la plateforme ne renvoie aucun identifiant de suivi', async () => {
    espionner([reponse({ status: 'submitted' }, 201)])
    // Sans identifiant externe, aucun suivi n'est possible et un rejeu
    // créerait un doublon invisible : c'est un échec, pas un succès.
    await expect(genericPaAdapter.submitInvoice(envoi)).rejects.toThrow(/identifiant de suivi/i)
  })

  it('un refus 422 remonte comme une erreur porteuse du détail plateforme', async () => {
    espionner([reponse({ message: 'SIREN acheteur absent' }, 422)])
    await expect(genericPaAdapter.submitInvoice(envoi)).rejects.toThrow(/SIREN acheteur absent/)
  })

  it('un statut inconnu ne devient pas « accepted »', async () => {
    espionner([reponse({ id: 'EXT-2', status: 'en_cours_de_traitement_interne' }, 201)])
    const r = await genericPaAdapter.submitInvoice(envoi)
    expect(r.status).toBe('unknown')
    expect(r.rawStatus).toBe('en_cours_de_traitement_interne') // brut conservé
  })
})

describe('getInvoiceStatus', () => {
  it('substitue {id} et lit le statut', async () => {
    espionner([reponse({ status: 'accepted' })])
    const r = await genericPaAdapter.getInvoiceStatus({ ...ctx(), externalId: 'EXT 42/7' })
    expect(appels[0].url).toBe('https://api.plateforme-test.fr/v1/invoices/EXT%2042%2F7')
    expect(r.status).toBe('accepted')
  })
})

describe('correspondance des statuts', () => {
  it.each([
    ['submitted', 'submitted'], ['ENVOYÉE'.toLowerCase(), 'unknown'],
    ['accepted', 'accepted'], ['Acceptée'.normalize('NFD').replace(/[̀-ͯ]/g, ''), 'accepted'],
    ['rejected', 'rejected'], ['refusee', 'refused'],
    ['paid', 'paid'], ['error', 'error'],
  ])('« %s » → %s', (brut, attendu) => {
    expect(mapStatut(brut)).toBe(attendu)
  })

  it('toute valeur non reconnue devient « unknown », jamais « accepted »', () => {
    for (const v of ['', 'blah', 'ok', 'true', '200', 'validated_by_something']) {
      expect(mapStatut(v)).toBe('unknown')
    }
  })
})

describe('messages opérateur — actionnables et sans détail interne', () => {
  it('couvre les codes HTTP courants', () => {
    expect(messageHttp(401)).toMatch(/identifiants/i)
    expect(messageHttp(404)).toMatch(/URL|chemins/i)
    expect(messageHttp(429)).toMatch(/trop de requêtes/i)
    expect(messageHttp(503)).toMatch(/indisponible/i)
  })

  it('ne divulgue jamais la pile d’appels d’une erreur réseau', () => {
    const err = new Error('connect ECONNREFUSED 10.0.0.1:443')
    err.stack = 'at secretModule (…)'
    const m = messageReseau(err)
    expect(m).not.toContain('10.0.0.1')
    expect(m).not.toContain('secretModule')
  })
})

describe('aucun secret dans les URL', () => {
  it('la clé API et le secret client ne partent jamais en query string', async () => {
    espionner([reponse({ access_token: 't', expires_in: 60 }), reponse({}, 200)])
    await genericPaAdapter.testConnection(ctx(OAUTH))
    for (const a of appels) {
      expect(a.url).not.toContain(OAUTH.clientSecret as string)
      expect(a.url).not.toContain('client_secret')
    }
  })
})
