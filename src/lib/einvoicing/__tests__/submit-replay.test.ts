/**
 * REJEU d'un envoi réglementaire — concurrence (§3, §4) et reprise après arrêt
 * brutal (§7).
 *
 * `submit-chain.test.ts` prouve l'idempotence du PREMIER envoi : la contrainte
 * UNIQUE sur `idempotencyKey` fait qu'une seule ligne peut naître, donc un seul
 * appel réseau. Ce fichier attaque l'autre porte, restée ouverte : celle par
 * laquelle une transmission qui n'a JAMAIS abouti peut être rejouée.
 *
 * ─── Pourquoi la contrainte UNIQUE ne suffit plus à cet endroit ──────────────
 * Au rejeu, la ligne existe déjà. Le verrou d'unicité a donc déjà joué son rôle
 * et ne protège plus rien : ce qui décide de partir ou non est une LECTURE du
 * statut, suivie d'une ÉCRITURE. Entre les deux, une autre requête — autre clic,
 * autre onglet, autre utilisateur, autre INSTANCE du serveur — peut lire le même
 * statut et conclure la même chose. Deux déclarations de la même facture partent
 * alors vers la plateforme agréée.
 *
 * ─── Ce que la fausse base ci-dessous modélise, et pourquoi ──────────────────
 * Une opération de base de données est ATOMIQUE : `UPDATE ... WHERE status=...`
 * verrouille la ligne, et une seconde mise à jour concurrente réévalue son
 * prédicat sur la version validée par la première (Postgres, READ COMMITTED ;
 * SQLite sérialise de toute façon les écritures). Chaque opération du simulacre
 * est donc écrite SANS `await` interne : elle s'exécute d'un bloc, comme la
 * vraie. Ce qui reste entrelaçable est exactement ce qui l'est en production —
 * l'intervalle ENTRE deux opérations.
 *
 * Sans cela, le test ne prouverait rien : il mesurerait l'ordonnancement de
 * JavaScript, pas la protection du logiciel.
 *
 * Deuxième détail, appris à ses dépens : chaque lecture rend une COPIE. Une
 * première version du simulacre renvoyait la ligne elle-même ; l'écriture du
 * gagnant devenait alors visible dans l'objet déjà lu par les perdants, qui
 * renonçaient d'eux-mêmes. Le test passait — en mesurant une propriété du
 * simulacre, pas du logiciel. Une base rend un instantané, jamais une vue vivante.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.GF_EINVOICE_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64')

type Ligne = Record<string, unknown>

const base = vi.hoisted(() => ({
  connexion: null as Record<string, unknown> | null,
  transmissions: [] as Array<Record<string, unknown>>,
  evenements: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  seq: 0,
}))

/** `where` Prisma restreint à ce que la chaîne d'envoi utilise réellement. */
function correspond(ligne: Ligne, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([champ, attendu]) => {
    if (attendu !== null && typeof attendu === 'object' && 'in' in (attendu as object)) {
      return (attendu as { in: unknown[] }).in.includes(ligne[champ])
    }
    // Borne de temps du prédicat d'abandon : `updatedAt < seuil`.
    if (attendu instanceof Object && 'lt' in (attendu as object)) {
      const borne = new Date((attendu as { lt: Date }).lt).getTime()
      return new Date(ligne[champ] as Date).getTime() < borne
    }
    if (attendu === null) return ligne[champ] === null || ligne[champ] === undefined
    return ligne[champ] === attendu
  })
}

vi.mock('@/lib/db', () => ({
  isPostgresDatabase: () => true,
  prisma: {},
  serverPrisma: () => ({
    garageEInvoiceConnection: { findFirst: async () => base.connexion },
    eInvoiceTransmission: {
      // Contrainte UNIQUE réelle : vérification et insertion d'un seul bloc.
      create: async (a: { data: Ligne }) => {
        if (base.transmissions.some((t) => t.idempotencyKey === a.data.idempotencyKey)) {
          const e = new Error('Unique constraint failed on the fields: (`idempotencyKey`)')
          ;(e as unknown as { code: string }).code = 'P2002'
          throw e
        }
        const row = { id: `t${++base.seq}`, externalId: null, updatedAt: new Date(), ...a.data }
        base.transmissions.push(row)
        return { ...row }
      },
      // INSTANTANÉ, pas une vue : ce que le lecteur garde ne changera plus sous
      // ses pieds. C'est précisément l'hypothèse fausse sur laquelle repose le
      // défaut cherché ici.
      findFirst: async (a: { where: Record<string, unknown> }) => {
        const t = base.transmissions.find((x) => correspond(x, a.where))
        return t ? { ...t } : null
      },
      update: async (a: { where: { id: string }; data: Ligne }) => {
        const row = base.transmissions.find((t) => t.id === a.where.id)!
        Object.assign(row, a.data, { updatedAt: new Date() })
        return { ...row }
      },
      // Prédicat ET écriture d'un seul bloc — c'est ce que garantit le verrou de
      // ligne du moteur, et c'est ce qui rend le compare-and-swap fiable.
      updateMany: async (a: { where: Record<string, unknown>; data: Ligne }) => {
        const cibles = base.transmissions.filter((t) => correspond(t, a.where))
        for (const t of cibles) Object.assign(t, a.data, { updatedAt: new Date() })
        return { count: cibles.length }
      },
    },
    eInvoiceEvent: { create: async (a: { data: Ligne }) => { base.evenements.push(a.data); return a.data } },
    eInvoiceAuditEvent: { create: async (a: { data: Ligne }) => { base.audits.push(a.data); return a.data } },
  }),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }))

import { encryptCredential } from '@/lib/einvoicing/credentials-cipher'
import { envoyerFacture, cleIdempotence, declarerNonParvenue } from '@/lib/einvoicing/submit'

const IDENTIFIANTS = {
  authMode: 'api_key',
  apiBaseUrl: 'https://api.plateforme-test.fr',
  submitPath: '/v1/invoices',
  statusPath: '/v1/invoices/{id}',
  apiKeyHeader: 'x-api-key',
  apiKey: 'CLE-SECRETE',
}

/** Mêmes valeurs que `submit-chain` : clés SIREN/SIRET/TVA valides, entreprise fictive. */
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

/** Compte les envois RÉELS partis sur le réseau. */
function compterEnvois() {
  const compteur = { n: 0 }
  vi.stubGlobal('fetch', async () => {
    compteur.n += 1
    return reponse({ id: `EXT-${compteur.n}`, status: 'submitted' }, 201)
  })
  return compteur
}

/** Pose une transmission dans l'état voulu, sans passer par la chaîne d'envoi. */
function transmissionExistante(
  statut: string,
  externalId: string | null = null,
  ageMinutes = 0,
) {
  base.transmissions.push({
    id: 't-existante',
    garageId: ENTREES.garageId,
    invoiceId: ENTREES.invoiceId,
    providerId: 'generic-pa',
    connectionId: 'c1',
    environment: 'sandbox',
    status: statut,
    documentFormat: 'cii',
    documentSha256: 'a'.repeat(64),
    externalId,
    idempotencyKey: cleIdempotence(ENTREES.garageId, ENTREES.invoiceId),
    errorMessage: null,
    updatedAt: new Date(Date.now() - ageMinutes * 60_000),
  })
}

beforeEach(() => {
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

describe('premier envoi — la contrainte UNIQUE tient', () => {
  it('vingt requêtes concurrentes sur une facture jamais transmise → un seul envoi', async () => {
    const envois = compterEnvois()
    const r = await Promise.all(Array.from({ length: 20 }, () => envoyerFacture(ENTREES)))

    expect(envois.n).toBe(1)
    expect(base.transmissions).toHaveLength(1)
    expect(r.filter((x) => x.ok)).toHaveLength(1)
    expect(r.filter((x) => x.code === 'ALREADY_SUBMITTED')).toHaveLength(19)
  })
})

describe('REJEU concurrent — là où la contrainte UNIQUE ne protège plus', () => {
  for (const statut of ['error', 'rejected']) {
    it(`vingt rejeux concurrents d'une transmission « ${statut} » → un seul envoi`, async () => {
      // Situation courante : la plateforme a répondu 401 (clé pas encore
      // activée) ou 422. Rien n'est parti, le rejeu est légitime. L'exploitant
      // corrige, puis double-clique — ou deux instances traitent la file.
      transmissionExistante(statut)
      const envois = compterEnvois()

      const r = await Promise.all(Array.from({ length: 20 }, () => envoyerFacture(ENTREES)))

      // UNE seule déclaration part à la plateforme agréée. C'est la propriété
      // réglementaire : deux envois de la même facture, c'est deux créances
      // déclarées pour une seule vente.
      expect(envois.n).toBe(1)
      expect(base.transmissions).toHaveLength(1)
      expect(r.filter((x) => x.ok)).toHaveLength(1)
      // Les dix-neuf autres doivent être REFUSÉES explicitement — jamais
      // silencieusement transformées en succès.
      for (const perdant of r.filter((x) => !x.ok)) {
        expect(perdant.code).toBe('ALREADY_SUBMITTED')
      }
    })
  }

  it('le perdant d\'une course de rejeu ne réécrit pas l\'issue du gagnant', async () => {
    transmissionExistante('error')
    const envois = compterEnvois()
    await Promise.all(Array.from({ length: 20 }, () => envoyerFacture(ENTREES)))

    // L'identifiant rendu par la plateforme est celui de l'unique envoi.
    expect(base.transmissions[0].externalId).toBe('EXT-1')
    expect(base.transmissions[0].status).toBe('submitted')
    expect(envois.n).toBe(1)
    // Et l'audit ne rapporte qu'une soumission.
    expect(base.audits.filter((a) => a.action === 'submit')).toHaveLength(1)
  })

  it('une transmission ABOUTIE ne repart pas, même sous vingt requêtes', async () => {
    transmissionExistante('submitted', 'EXT-DEJA')
    const envois = compterEnvois()

    const r = await Promise.all(Array.from({ length: 20 }, () => envoyerFacture(ENTREES)))

    expect(envois.n).toBe(0)
    expect(r.every((x) => x.code === 'ALREADY_SUBMITTED')).toBe(true)
    expect(base.transmissions[0].externalId).toBe('EXT-DEJA')
  })

  it('une transmission d\'issue INCONNUE ne repart pas toute seule', async () => {
    // Connexion coupée sans réponse : nul ne sait si la plateforme a pris la
    // facture. Seule une déclaration humaine tracée peut rouvrir le rejeu.
    transmissionExistante('unknown')
    const envois = compterEnvois()

    const r = await Promise.all(Array.from({ length: 20 }, () => envoyerFacture(ENTREES)))

    expect(envois.n).toBe(0)
    expect(r.every((x) => x.code === 'ALREADY_SUBMITTED')).toBe(true)
  })

  it('un envoi EN COURS n\'est pas doublé par une requête arrivée entre-temps', async () => {
    transmissionExistante('submission_pending')
    const envois = compterEnvois()

    const r = await Promise.all(Array.from({ length: 20 }, () => envoyerFacture(ENTREES)))

    expect(envois.n).toBe(0)
    expect(r.every((x) => x.code === 'ALREADY_SUBMITTED')).toBe(true)
    // Le message doit inviter à actualiser, pas affirmer une transmission.
    expect(r[0].message).toMatch(/en cours/i)
  })
})

describe('deux factures distinctes ne se gênent pas', () => {
  it('le verrou porte sur la facture, pas sur le garage', async () => {
    const envois = compterEnvois()
    await Promise.all([
      envoyerFacture(ENTREES),
      envoyerFacture({ ...ENTREES, invoiceId: 'inv-2', invoice: { ...ENTREES.invoice, number: 'FAC-2026-002' } }),
    ])
    expect(envois.n).toBe(2)
    expect(base.transmissions).toHaveLength(2)
  })
})

describe('reprise après un arrêt brutal (§7)', () => {
  /**
   * Le cas : le serveur est tué — redéploiement, coupure, plantage — ENTRE la
   * réservation et le traitement de la réponse. La ligne reste « en cours » et
   * plus aucun processus ne s'en occupe. Ni le rejeu (statut non rejouable) ni
   * la déclaration de non-parvenance (réservée au statut « inconnu ») ne
   * l'acceptaient : la facture devenait réglementairement intransmissible, ce
   * qui est exactement la panne que la gestion des 401 avait déjà éliminée
   * ailleurs.
   */
  it('une transmission « en cours » ABANDONNÉE peut être déclarée non parvenue', async () => {
    transmissionExistante('submission_pending', null, 60)
    const envois = compterEnvois()

    // Le rejeu automatique reste refusé : nul ne sait si la plateforme a reçu
    // la facture. C'est une décision humaine, pas une déduction du logiciel.
    expect((await envoyerFacture(ENTREES)).code).toBe('ALREADY_SUBMITTED')
    expect(envois.n).toBe(0)

    // L'exploitant vérifie sur le portail de sa plateforme, puis déclare.
    const decl = await declarerNonParvenue('gA', 't-existante', 'u1')
    expect(decl.ok).toBe(true)
    expect(base.audits.some((a) => a.action === 'declare_not_received')).toBe(true)

    // Et la facture redevient transmissible.
    const rejeu = await envoyerFacture(ENTREES)
    expect(rejeu.ok).toBe(true)
    expect(envois.n).toBe(1)
    expect(base.transmissions).toHaveLength(1)
  })

  it('un envoi RÉELLEMENT en cours n\'est pas déclarable — la course serait perdue d\'avance', async () => {
    // Quelques secondes : un appel peut très bien être en vol. Le déclarer non
    // parvenu autoriserait un rejeu pendant que le premier aboutit.
    transmissionExistante('submission_pending', null, 0)
    const decl = await declarerNonParvenue('gA', 't-existante', 'u1')
    expect(decl.ok).toBe(false)
    expect(decl.message).toMatch(/en cours/i)
  })

  it('le message rendu à l\'exploitant dit ce qu\'il doit faire', async () => {
    transmissionExistante('submission_pending', null, 60)
    const r = await envoyerFacture(ENTREES)
    // Surtout pas « déjà transmise » : ce serait faux, et l'exploitant
    // classerait la facture comme partie.
    expect(r.message).toMatch(/sans issue connue|vérifiez/i)
    expect(r.message).not.toMatch(/a déjà été transmise/i)
  })

  it('deux exploitants qui déclarent en même temps n\'écrivent qu\'une décision', async () => {
    transmissionExistante('unknown')
    const r = await Promise.all([
      declarerNonParvenue('gA', 't-existante', 'u1'),
      declarerNonParvenue('gA', 't-existante', 'u2'),
    ])
    expect(r.filter((x) => x.ok)).toHaveLength(1)
    // Le journal d'audit doit refléter UNE vérification, pas deux : relu plus
    // tard, deux lignes laisseraient croire à un double contrôle.
    expect(base.audits.filter((a) => a.action === 'declare_not_received')).toHaveLength(1)
  })
})
