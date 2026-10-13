/**
 * Voie de retour CLOUD → POSTE de l'accord client sur un devis publié.
 *
 * Base RÉELLE (SQLite construite depuis le schéma) : ce qui doit être prouvé ici
 * — idempotence de la preuve, non-régression du statut, clé étrangère jamais
 * pendante — se joue précisément dans la base, pas dans une carte en mémoire.
 *
 * Seul le CLOUD est simulé : ses propres tests couvrent la route de retour.
 *
 * RÉSERVE : la production tourne sur PostgreSQL côté cloud ; côté poste, c'est
 * bien SQLite, donc ce test-ci est représentatif de la cible.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../.tmp-quote-return.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({
  reponse: null as any,
  appels: [] as Array<{ chemin: string; corps: any }>,
}))

vi.mock('@/lib/sync/cloud-client', () => ({
  isDesktopInstance: () => true,
  garageLicenseToken: async () => 'GF2.jeton-licence-test',
  cloudPost: async (chemin: string, corps: unknown) => {
    h.appels.push({ chemin, corps })
    return h.reponse
  },
}))

let prisma: any
let pullQuoteSignatures: (garageId: string) => Promise<any>
const ids = { garageA: '', garageB: '', devis: '' }

const PREUVE = (over: Record<string, unknown> = {}) => ({
  id: 'sig-cloud-1',
  quoteId: ids.devis,
  quoteStatus: 'accepted',
  signerName: 'Client Test',
  signerRole: 'client',
  algorithm: 'SHA-256 / HMAC-SHA256',
  contentHash: 'c'.repeat(64),
  imageHash: 'i'.repeat(64),
  seal: 's'.repeat(64),
  signatureData: '',
  documentSnapshotJson: '{"devis":"canonique"}',
  ipAddress: '203.0.113.9',
  userAgent: 'Mozilla/5.0',
  signedAt: '2026-08-15T10:00:00.000Z',
  ...over,
})

const repond = (signatures: unknown[], reste = false) => {
  h.reponse = { ok: true, data: { signatures, reste } }
}

beforeAll(async () => {
  const { prepareTestDb } = await import('../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ pullQuoteSignatures } = await import('@/lib/sync/quote-return'))

  const a = await prisma.garage.create({ data: { name: 'Garage A', slug: 'ga' } })
  const b = await prisma.garage.create({ data: { name: 'Garage B', slug: 'gb' } })
  ids.garageA = a.id
  ids.garageB = b.id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  h.appels = []
  await prisma.signature.deleteMany({})
  await prisma.quote.deleteMany({})
  const devis = await prisma.quote.create({
    data: {
      garageId: ids.garageA, number: 'DEV-2026-001', status: 'sent',
      clientName: 'Client Test', issueDate: '2026-08-15',
    },
  })
  ids.devis = devis.id
})

describe('rapatriement de l’accord client', () => {
  it('enregistre la preuve ET fait avancer le devis', async () => {
    repond([PREUVE()])
    const res = await pullQuoteSignatures(ids.garageA)

    expect(res.appliquees).toBe(1)
    expect(res.statutsAvances).toBe(1)

    const preuve = await prisma.signature.findUnique({ where: { id: 'sig-cloud-1' } })
    expect(preuve, 'la preuve doit exister localement').toBeTruthy()
    expect(preuve.entityType).toBe('quote')
    expect(preuve.entityId).toBe(ids.devis)
    expect(preuve.seal, 'le sceau est la preuve : il doit arriver intact').toBe('s'.repeat(64))
    expect(preuve.documentSnapshotJson).toBe('{"devis":"canonique"}')

    const devis = await prisma.quote.findUnique({ where: { id: ids.devis } })
    expect(devis.status).toBe('accepted')
  })

  it('un refus client est appliqué comme une acceptation', async () => {
    repond([PREUVE({ quoteStatus: 'refused' })])
    await pullQuoteSignatures(ids.garageA)
    const devis = await prisma.quote.findUnique({ where: { id: ids.devis } })
    expect(devis.status).toBe('refused')
  })

  it('rejouer le passage n’empile AUCUN doublon', async () => {
    repond([PREUVE()])
    await pullQuoteSignatures(ids.garageA)
    await pullQuoteSignatures(ids.garageA)
    await pullQuoteSignatures(ids.garageA)
    expect(await prisma.signature.count({}), 'une seule preuve, rejouée').toBe(1)
  })
})

describe('non-régression du statut', () => {
  it('un devis déjà CONVERTI garde son statut, mais reçoit la preuve', async () => {
    await prisma.quote.update({ where: { id: ids.devis }, data: { status: 'converted' } })
    repond([PREUVE()])
    const res = await pullQuoteSignatures(ids.garageA)

    const devis = await prisma.quote.findUnique({ where: { id: ids.devis } })
    expect(devis.status, 'un devis converti est PLUS avancé qu’accepté').toBe('converted')
    expect(res.statutsAvances).toBe(0)
    // La preuve vaut par elle-même : elle est enregistrée quand même.
    expect(await prisma.signature.count({})).toBe(1)
  })
})

describe('refus d’écrire n’importe quoi', () => {
  it('une preuve dont le devis est INCONNU localement est ignorée', async () => {
    repond([PREUVE({ quoteId: 'devis-qui-nexiste-pas' })])
    const res = await pullQuoteSignatures(ids.garageA)
    expect(res.appliquees, 'aucune clé étrangère pendante').toBe(0)
    expect(await prisma.signature.count({})).toBe(0)
  })

  it('un devis d’un AUTRE garage n’est pas touché', async () => {
    const autre = await prisma.quote.create({
      data: {
        garageId: ids.garageB, number: 'DEV-B-001', status: 'sent',
        clientName: 'Client B', issueDate: '2026-08-15',
      },
    })
    repond([PREUVE({ quoteId: autre.id })])
    const res = await pullQuoteSignatures(ids.garageA)

    expect(res.appliquees).toBe(0)
    const apres = await prisma.quote.findUnique({ where: { id: autre.id } })
    expect(apres.status, 'le devis du garage B reste intact').toBe('sent')
    expect(await prisma.signature.count({})).toBe(0)
  })

  it('un cloud injoignable n’écrit rien et le dit', async () => {
    h.reponse = { ok: false, code: 'NETWORK' }
    const res = await pullQuoteSignatures(ids.garageA)
    expect(res.code).toBe('NETWORK')
    expect(res.appliquees).toBe(0)
    expect(await prisma.signature.count({})).toBe(0)
    const devis = await prisma.quote.findUnique({ where: { id: ids.devis } })
    expect(devis.status).toBe('sent')
  })
})

describe('curseur', () => {
  it('premier passage : aucun curseur — le poste ne détient rien', async () => {
    repond([])
    await pullQuoteSignatures(ids.garageA)
    expect(h.appels[0].corps.since).toBeNull()
  })

  it('passages suivants : curseur RECULÉ d’une minute sur la dernière preuve', async () => {
    repond([PREUVE()])
    await pullQuoteSignatures(ids.garageA)

    h.appels = []
    repond([])
    await pullQuoteSignatures(ids.garageA)

    const since = new Date(h.appels[0].corps.since as string)
    const signee = new Date('2026-08-15T10:00:00.000Z')
    // Deux preuves scellées à la même seconde, dont une seule reçue, seraient
    // sinon sautées définitivement.
    expect(signee.getTime() - since.getTime()).toBe(60_000)
  })

  it('remonte l’arriéré annoncé par le cloud', async () => {
    repond([PREUVE()], true)
    const res = await pullQuoteSignatures(ids.garageA)
    expect(res.resteAPuiser, 'l’appelant doit savoir qu’il reste à puiser').toBe(true)
  })
})
