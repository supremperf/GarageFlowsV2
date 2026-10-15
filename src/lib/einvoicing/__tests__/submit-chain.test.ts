/**
 * Chaîne d'envoi d'une facture électronique (§88, §94, §95).
 *
 * Ce qui est réellement exercé ici : la validation de profil (fail-closed), la
 * génération CII, l'empreinte, la RÉSERVATION de la clé d'idempotence AVANT
 * l'appel réseau, la persistance de l'identifiant externe et du statut, et le
 * traitement distinct d'un rejet plateforme (document fautif) et d'une panne
 * plateforme (rejouable).
 *
 * Seules la base et le réseau sont simulés — la validation, la sérialisation et
 * la logique d'idempotence sont les vraies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// This suite simulates the transport, including DNS; the production SSRF guard
// still runs against these answers. Do not depend on a public test hostname's
// resolver latency while fetch itself is simulated.
const dns = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }))

process.env.GF_EINVOICE_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64')

const base = vi.hoisted(() => ({
  connexion: null as Record<string, unknown> | null,
  transmissions: [] as Array<Record<string, unknown>>,
  evenements: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  seq: 0,
}))

vi.mock('@/lib/db', () => ({
  isPostgresDatabase: () => true,
  prisma: {},
  serverPrisma: () => ({
    garageEInvoiceConnection: {
      findFirst: async () => base.connexion,
    },
    eInvoiceTransmission: {
      create: async (a: { data: Record<string, unknown> }) => {
        // Contrainte UNIQUE réelle sur idempotencyKey : le simulacre la respecte,
        // sinon le test d'idempotence ne prouverait rien.
        if (base.transmissions.some((t) => t.idempotencyKey === a.data.idempotencyKey)) {
          throw new Error('Unique constraint failed on the fields: (`idempotencyKey`)')
        }
        const row = { id: `t${++base.seq}`, externalId: null, ...a.data }
        base.transmissions.push(row)
        return { ...row }
      },
      // Une lecture rend un INSTANTANÉ. Rendre la ligne elle-même laisserait
      // l'écriture d'un appelant apparaître dans l'objet déjà lu par un autre,
      // et masquerait les courses que ces tests existent pour détecter — voir
      // `submit-concurrency.test.ts`, où ce détail décidait du verdict.
      findFirst: async (a: { where: Record<string, unknown> }) => {
        const t = base.transmissions.find((x) =>
          Object.entries(a.where).every(([k, v]) => x[k] === v))
        return t ? { ...t } : null
      },
      update: async (a: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = base.transmissions.find((t) => t.id === a.where.id)!
        Object.assign(row, a.data)
        return { ...row }
      },
      // Prédicat ET écriture d'un seul bloc, comme le verrou de ligne du moteur.
      updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const cibles = base.transmissions.filter((t) =>
          Object.entries(a.where).every(([k, v]) => {
            if (v !== null && typeof v === 'object' && 'in' in (v as object)) {
              return (v as { in: unknown[] }).in.includes(t[k])
            }
            if (v === null) return t[k] === null || t[k] === undefined
            return t[k] === v
          }))
        for (const t of cibles) Object.assign(t, a.data)
        return { count: cibles.length }
      },
    },
    eInvoiceEvent: { create: async (a: { data: Record<string, unknown> }) => { base.evenements.push(a.data); return a.data } },
    eInvoiceAuditEvent: { create: async (a: { data: Record<string, unknown> }) => { base.audits.push(a.data); return a.data } },
  }),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }))

import { encryptCredential } from '@/lib/einvoicing/credentials-cipher'
import { envoyerFacture, cleIdempotence, preparerDocument, declarerNonParvenue } from '@/lib/einvoicing/submit'

const IDENTIFIANTS = {
  authMode: 'api_key',
  apiBaseUrl: 'https://api.plateforme-test.fr',
  submitPath: '/v1/invoices',
  statusPath: '/v1/invoices/{id}',
  apiKeyHeader: 'x-api-key',
  apiKey: 'CLE-SECRETE',
}

/**
 * Facture VALIDE au regard du profil minimum.
 *
 * Le validateur vérifie réellement la clé de Luhn du SIRET et du SIREN, ainsi
 * que la clé du numéro de TVA intracommunautaire — un jeu de chiffres arbitraire
 * est rejeté, ce qui est le comportement voulu. Ces valeurs sont donc calculées
 * pour satisfaire ces clés (SIREN 100000009, SIRET 10000000900009,
 * TVA FR88100000009) et ne correspondent à aucune entreprise réelle.
 */
const ENTREES = {
  garageId: 'gA',
  invoiceId: 'inv-1',
  environment: 'sandbox' as const,
  garage: { name: 'Garage Test', siret: '10000000900009', vatNumber: 'FR88100000009', address: '1 rue du Test' },
  invoice: { number: 'FAC-2026-001', issueDate: '2026-06-01', dueDate: null, taxRate: 20, clientName: 'Client Test', clientAddress: '2 rue du Client' },
  lines: [{ description: 'Vidange', quantityTenThousandths: 10000, unitPriceTenThousandths: 1000000 }],
  actorUserId: 'u1',
}

function reponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

beforeEach(() => {
  dns.lookup.mockReset().mockImplementation(async (hostname: string) => {
    return [{ address: hostname === 'api.plateforme-test.fr' ? '93.184.216.34' : '127.0.0.1', family: 4 }]
  })
  base.transmissions = []
  base.evenements = []
  base.audits = []
  base.seq = 0
  base.connexion = {
    id: 'c1', garageId: 'gA', providerId: 'generic-pa', environment: 'sandbox',
    credentials: encryptCredential(JSON.stringify(IDENTIFIANTS)),
    legalEntityId: null,
  }
  vi.unstubAllGlobals()
})

describe('document réglementaire', () => {
  it('produit un CII de profil minimum et une empreinte stable', () => {
    const a = preparerDocument(ENTREES)
    const b = preparerDocument(ENTREES)
    expect(a.xml).toContain('urn:factur-x.eu:1p0:minimum')
    expect(a.xml).toContain('FAC-2026-001')
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(b.sha256).toBe(a.sha256) // déterministe
  })

  it('un montant modifié change l’empreinte du document — mais PAS la clé d’idempotence', () => {
    const a = preparerDocument(ENTREES)
    const b = preparerDocument({
      ...ENTREES,
      lines: [{ ...ENTREES.lines[0], unitPriceTenThousandths: 2000000 }],
    })
    expect(b.sha256).not.toBe(a.sha256)
    // La clé porte sur la FACTURE. Première version : elle mêlait l'empreinte
    // du document, si bien qu'un champ modifié rouvrait l'envoi — une seconde
    // déclaration de la même facture à la plateforme agréée.
    expect(cleIdempotence('gA', 'inv-1')).toBe(cleIdempotence('gA', 'inv-1'))
  })

  it('la clé d’idempotence est déterministe et cloisonnée par garage', () => {
    expect(cleIdempotence('gA', 'inv-1')).toBe(cleIdempotence('gA', 'inv-1'))
    expect(cleIdempotence('gB', 'inv-1')).not.toBe(cleIdempotence('gA', 'inv-1'))
    expect(cleIdempotence('gA', 'inv-2')).not.toBe(cleIdempotence('gA', 'inv-1'))
  })
})

describe('envoi nominal', () => {
  it('transmet, enregistre l’identifiant externe, le statut et le journal', async () => {
    vi.stubGlobal('fetch', async () => reponse({ id: 'EXT-9', status: 'submitted' }, 201))
    const r = await envoyerFacture(ENTREES)

    expect(r.ok).toBe(true)
    expect(r.externalId).toBe('EXT-9')
    expect(r.status).toBe('submitted')

    const t = base.transmissions[0]
    expect(t.externalId).toBe('EXT-9')
    expect(t.status).toBe('submitted')
    expect(t.documentFormat).toBe('cii')
    expect(String(t.documentSha256)).toMatch(/^[0-9a-f]{64}$/)

    expect(base.evenements[0].type).toBe('submitted')
    expect(base.audits[0].action).toBe('submit')
    // Le journal d'audit ne contient AUCUN secret.
    expect(JSON.stringify(base.audits[0])).not.toContain('CLE-SECRETE')
  })
})

describe('idempotence (§94, §95)', () => {
  it('vingt envois concurrents de la MÊME facture → une seule soumission', async () => {
    let envois = 0
    vi.stubGlobal('fetch', async () => {
      envois += 1
      return reponse({ id: `EXT-${envois}`, status: 'submitted' }, 201)
    })

    const resultats = await Promise.all(
      Array.from({ length: 20 }, () => envoyerFacture(ENTREES)),
    )

    // Une seule ligne de transmission, donc un seul appel réseau.
    expect(base.transmissions).toHaveLength(1)
    expect(envois).toBe(1)
    expect(resultats.filter((r) => r.ok)).toHaveLength(1)
    for (const r of resultats.filter((r) => !r.ok)) {
      expect(r.code).toBe('ALREADY_SUBMITTED')
    }
  })

  it('un second envoi rend l’état CONNU au lieu de renvoyer', async () => {
    vi.stubGlobal('fetch', async () => reponse({ id: 'EXT-1', status: 'submitted' }, 201))
    await envoyerFacture(ENTREES)

    const second = await envoyerFacture(ENTREES)
    expect(second.ok).toBe(false)
    expect(second.code).toBe('ALREADY_SUBMITTED')
    expect(second.externalId).toBe('EXT-1')
    expect(base.transmissions).toHaveLength(1)
  })

  it('la réservation a lieu AVANT l’appel : la ligne existe même quand la réponse se perd', async () => {
    // La connexion tombe SANS réponse : GarageFlows ne peut pas savoir si la
    // plateforme a pris la facture (§96).
    vi.stubGlobal('fetch', async () => { throw new Error('socket hang up') })
    const premier = await envoyerFacture(ENTREES)
    expect(premier.ok).toBe(false)
    expect(premier.code).toBe('PROVIDER_UNAVAILABLE')
    expect(base.transmissions).toHaveLength(1)
    // Issue INCONNUE — surtout pas « échec » : renvoyer à l'aveugle risquerait
    // une double déclaration.
    expect(base.transmissions[0].status).toBe('unknown')

    // Un nouvel essai ne repart donc PAS tout seul.
    const rejeu = await envoyerFacture(ENTREES)
    expect(rejeu.code).toBe('ALREADY_SUBMITTED')
    expect(base.transmissions).toHaveLength(1)
  })

  it('une plateforme qui RÉPOND une erreur n’enferme pas la facture : le rejeu est permis', async () => {
    // 401 : la clé n'est pas encore activée côté plateforme. Elle a répondu,
    // donc elle n'a PAS pris la facture — c'est le cas de figure le plus
    // courant lors d'une première configuration.
    vi.stubGlobal('fetch', async () => reponse({ message: 'clé inconnue' }, 401))
    const premier = await envoyerFacture(ENTREES)
    expect(premier.ok).toBe(false)
    expect(premier.code).toBe('PROVIDER_REJECTED')
    expect(base.transmissions).toHaveLength(1)

    // L'exploitant corrige sa configuration et réessaie : cela doit PARTIR.
    vi.stubGlobal('fetch', async () => reponse({ id: 'EXT-42', status: 'submitted' }, 201))
    const second = await envoyerFacture(ENTREES)
    expect(second.ok).toBe(true)
    expect(second.externalId).toBe('EXT-42')
    // Toujours UNE seule transmission : la ligne a été rejouée, pas dupliquée.
    expect(base.transmissions).toHaveLength(1)
    expect(base.transmissions[0].externalId).toBe('EXT-42')
  })

  it('une facture RÉELLEMENT transmise ne repart jamais, même après modification', async () => {
    vi.stubGlobal('fetch', async () => reponse({ id: 'EXT-1', status: 'submitted' }, 201))
    await envoyerFacture(ENTREES)

    // Le nom du client change (champ resté modifiable) : l'empreinte du
    // document change, la clé d'idempotence NON.
    let appels = 0
    vi.stubGlobal('fetch', async () => { appels += 1; return reponse({ id: 'EXT-2', status: 'submitted' }, 201) })
    const second = await envoyerFacture({
      ...ENTREES,
      invoice: { ...ENTREES.invoice, clientName: 'Client renommé' },
    })
    expect(second.code).toBe('ALREADY_SUBMITTED')
    expect(second.externalId).toBe('EXT-1')
    expect(appels).toBe(0)
    expect(base.transmissions).toHaveLength(1)
  })

  it('une issue inconnue se dénoue par une déclaration TRACÉE de l’exploitant', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('socket hang up') })
    const premier = await envoyerFacture(ENTREES)
    const tid = String(premier.transmissionId)
    expect(base.transmissions[0].status).toBe('unknown')

    // L'exploitant a vérifié sur le portail : la facture n'y est pas.
    const decl = await declarerNonParvenue('gA', tid, 'user-1')
    expect(decl.ok).toBe(true)
    expect(base.transmissions[0].status).toBe('error')
    expect(base.audits.some((a: any) => a.action === 'declare_not_received')).toBe(true)

    // Le rejeu est alors possible, sur la MÊME ligne.
    vi.stubGlobal('fetch', async () => reponse({ id: 'EXT-7', status: 'submitted' }, 201))
    const rejeu = await envoyerFacture(ENTREES)
    expect(rejeu.ok).toBe(true)
    expect(base.transmissions).toHaveLength(1)
    expect(base.transmissions[0].externalId).toBe('EXT-7')
  })

  it('une transmission ABOUTIE ne peut pas être déclarée non parvenue', async () => {
    vi.stubGlobal('fetch', async () => reponse({ id: 'EXT-1', status: 'submitted' }, 201))
    const r = await envoyerFacture(ENTREES)
    const decl = await declarerNonParvenue('gA', String(r.transmissionId), 'user-1')
    expect(decl.ok).toBe(false)
    expect(decl.code).toBe('ALREADY_SUBMITTED')
  })

  it('une transmission d’un AUTRE garage ne peut pas être déclarée non parvenue', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('socket hang up') })
    const r = await envoyerFacture(ENTREES)
    const decl = await declarerNonParvenue('gB', String(r.transmissionId), 'intrus')
    expect(decl.ok).toBe(false)
    expect(decl.code).toBe('INVOICE_NOT_FOUND')
  })

})

describe('refus et pannes — distingués', () => {
  it('un document non conforme est refusé AVANT tout appel réseau', async () => {
    let appele = false
    vi.stubGlobal('fetch', async () => { appele = true; return reponse({}, 200) })

    // Sans SIRET ni n° de TVA, le profil minimum ne peut pas être satisfait.
    const r = await envoyerFacture({
      ...ENTREES,
      garage: { name: 'Garage', siret: null, vatNumber: null, address: null },
    })

    expect(r.ok).toBe(false)
    expect(r.code).toBe('DOCUMENT_INVALID')
    expect(r.issues?.length).toBeGreaterThan(0)
    expect(appele).toBe(false)
    expect(base.transmissions).toHaveLength(0)
  })

  it('un rejet plateforme (422) est un REJET, pas une panne', async () => {
    vi.stubGlobal('fetch', async () => reponse({ message: 'Identifiant acheteur absent' }, 422))
    const r = await envoyerFacture(ENTREES)
    expect(r.code).toBe('PROVIDER_REJECTED')
    expect(r.message).toContain('Identifiant acheteur absent')
    expect(base.transmissions[0].status).toBe('rejected')
  })

  it('une panne (500) est rapportée comme telle', async () => {
    vi.stubGlobal('fetch', async () => reponse({}, 503))
    const r = await envoyerFacture(ENTREES)
    expect(r.code).toBe('PROVIDER_UNAVAILABLE')
    expect(base.transmissions[0].status).toBe('error')
  })
})

describe('préconditions de connexion', () => {
  it('sans connexion configurée → refus explicite, aucune transmission', async () => {
    base.connexion = null
    const r = await envoyerFacture(ENTREES)
    expect(r.code).toBe('NO_CONNECTION')
    expect(base.transmissions).toHaveLength(0)
  })

  it('identifiants illisibles → refus explicite (jamais un envoi à l’aveugle)', async () => {
    base.connexion = { ...base.connexion, credentials: 'gfeic1.1.aaa.bbb.ccc' }
    const r = await envoyerFacture(ENTREES)
    expect(r.code).toBe('CONNECTION_UNUSABLE')
    expect(base.transmissions).toHaveLength(0)
  })
})
