/**
 * Rattrapage des clés mécaniciens après une coupure réseau.
 *
 * Un poste travaille hors ligne : garage en sous-sol, panne ADSL. Les gestes
 * faits pendant ce temps doivent être RATTRAPÉS, et l'écran ne doit jamais
 * affirmer qu'ils sont parvenus au cloud.
 *
 * Deux défauts corrigés le 15/08/2026 :
 *
 *  · une RÉATTRIBUTION ne remettait pas `cloudSyncedAt` à null. La clé gardait
 *    l'horodatage de l'attribution précédente : l'écran affichait
 *    « Synchronisée », le cloud associait encore la clé à l'ANCIEN mécanicien,
 *    et le rattrapage — qui filtre sur `cloudSyncedAt: null` — ne la voyait
 *    jamais ;
 *  · une RÉVOCATION n'écrivait rien du tout et le rattrapage ne traitait que
 *    les attributions. Un mécanicien licencié dont on révoquait la clé pendant
 *    une coupure gardait l'accès à sa PWA indéfiniment.
 *
 * Base RÉELLE : c'est l'état persisté qui décide du rattrapage, pas une
 * intention en mémoire. Seul le transport est simulé.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../.tmp-mecano-rattrapage.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ post: vi.fn(), garageId: '' }))
vi.mock('@/lib/sync/cloud-client', () => ({
  cloudPost: (...a: unknown[]) => h.post(...a),
  garageLicenseToken: async () => 'GF2.jeton-licence-test',
  // On éprouve le chemin POSTE : c'est le seul où le rattrapage existe.
  isDesktopInstance: () => true,
}))

vi.mock('@/lib/api-helpers', () => ({
  requireSession: async () => ({ user: { id: 'owner-1', role: 'OWNER', garageId: h.garageId } }),
  withAuth: (fn: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => {
      try { return await fn(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e }
    },
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))
vi.mock('@/lib/license/mechanic-admin', () => ({
  macFor: () => 'mac-de-test',
  revokeDevices: async () => 0,
}))

let prisma: any
let retryPendingMechanicSyncs: any
let pushMechanicStatus: any
let statutPOST: any
let garageId = ''
let mechanicId = ''

/** Crée une clé mécanicien dans l'état voulu. */
async function cle(licenseId: string, over: Record<string, unknown> = {}) {
  return prisma.licenseKey.create({
    data: {
      licenseId, token: `GF2.${licenseId}`, customerId: 'c1', licenseType: 'mechanic',
      expiryAt: new Date('2027-01-01'), status: 'active', garageId, mechanicId,
      cloudSyncedAt: null, ...over,
    },
  })
}

/** La licence GARAGE, indispensable pour que la poussée soit tentée. */
async function licenceGarage() {
  return prisma.licenseKey.create({
    data: {
      licenseId: 'garage-1', token: 'GF2.garage', customerId: 'c1', licenseType: 'premium',
      expiryAt: new Date('2027-01-01'), status: 'active', garageId,
    },
  })
}

beforeAll(async () => {
  const { prepareTestDb } = await import('../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ retryPendingMechanicSyncs, pushMechanicStatus } = await import('@/lib/sync/mechanic-sync'))
  ;({ POST: statutPOST } = (await import('@/app/api/mechanic-licenses/[lid]/status/route')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'G', slug: 'rattrapage' } })).id
  h.garageId = garageId
  mechanicId = (await prisma.mechanic.create({
    data: { name: 'Meca', avatar: 'a', color: '#111', garageId },
  })).id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  h.post.mockReset().mockResolvedValue({ ok: true, status: 200, data: { ok: true } })
  await prisma.licenseKey.deleteMany({})
  await licenceGarage()
})

describe('une révocation faite hors ligne est rattrapée', () => {
  it('le rattrapage rejoue le STATUT, pas seulement les attributions', async () => {
    await cle('mec-1', { status: 'revoked', revokedAt: new Date() })
    const faits = await retryPendingMechanicSyncs(garageId)

    expect(faits, 'une révocation en attente doit être rejouée').toBe(1)
    const [, corps] = h.post.mock.calls[0]
    expect(h.post.mock.calls[0][0]).toBe('/api/sync/mechanic-status')
    expect(corps).toMatchObject({ status: 'revoked' })
  })

  it('une suspension aussi', async () => {
    await cle('mec-2', { status: 'suspended', suspendedAt: new Date() })
    await retryPendingMechanicSyncs(garageId)
    expect(h.post.mock.calls[0][1]).toMatchObject({ status: 'suspended' })
  })

  it('confirmée par le cloud, elle cesse d’être en attente', async () => {
    await cle('mec-3', { status: 'revoked' })
    await retryPendingMechanicSyncs(garageId)
    const apres = await prisma.licenseKey.findUnique({ where: { licenseId: 'mec-3' }, select: { cloudSyncedAt: true } })
    expect(apres.cloudSyncedAt, 'sans cette écriture, le rattrapage rejouerait à chaque passage').not.toBeNull()
  })

  it('refusée par le cloud, elle RESTE en attente', async () => {
    h.post.mockResolvedValue({ ok: false, code: 'NETWORK' })
    await cle('mec-4', { status: 'revoked' })
    await retryPendingMechanicSyncs(garageId)
    const apres = await prisma.licenseKey.findUnique({ where: { licenseId: 'mec-4' }, select: { cloudSyncedAt: true } })
    expect(apres.cloudSyncedAt, 'marquer « synchronisée » sur un échec est le pire des cas').toBeNull()
  })
})

describe('retirer un accès prime sur en accorder un', () => {
  it('la clé révoquée passe avant la clé active quand le plafond est de 1', async () => {
    await cle('mec-active', { status: 'active' })
    await cle('mec-revoquee', { status: 'revoked' })
    await retryPendingMechanicSyncs(garageId, 1)
    expect(h.post).toHaveBeenCalledTimes(1)
    expect(h.post.mock.calls[0][0], 'un accès à retirer est plus urgent qu’un accès à ouvrir')
      .toBe('/api/sync/mechanic-status')
  })
})

describe('une clé attribuée mais jamais confirmée reste rattrapée', () => {
  it('le canal ATTRIBUTION est utilisé pour une clé active', async () => {
    await cle('mec-5', { status: 'active' })
    await retryPendingMechanicSyncs(garageId)
    expect(h.post.mock.calls[0][0]).toBe('/api/sync/mechanic-assignment')
  })

  it('une clé active SANS titulaire n’a rien à annoncer', async () => {
    await cle('mec-6', { status: 'active', mechanicId: null })
    const faits = await retryPendingMechanicSyncs(garageId)
    expect(faits).toBe(0)
    expect(h.post).not.toHaveBeenCalled()
  })
})

describe('l’état poussé est celui de la base, jamais une supposition', () => {
  it('pushMechanicStatus confirme en base ce que le cloud a accepté', async () => {
    await cle('mec-7', { status: 'suspended' })
    const r = await pushMechanicStatus('mec-7', 'suspended')
    expect(r.synced).toBe(true)
    const apres = await prisma.licenseKey.findUnique({ where: { licenseId: 'mec-7' }, select: { cloudSyncedAt: true } })
    expect(apres.cloudSyncedAt).not.toBeNull()
  })
})

describe('la ROUTE marque elle-même la clé « à rattraper »', () => {
  // Sans ce test, la remise à zéro de `cloudSyncedAt` dans la route pouvait
  // disparaître sans qu'aucun test ne rougisse : les cas ci-dessus créent les
  // clés directement en base, déjà en attente. C'est pourtant la route qui
  // déclenche tout — c'est le geste de l'exploitant qui doit être rattrapé.
  const revoquer = (lid: string, status = 'revoked') =>
    statutPOST(new Request('http://localhost/x', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    }), { params: { lid } })

  it('révoquer une clé DÉJÀ synchronisée la remet en attente', async () => {
    // État de départ : le cloud connaît cette clé (attribution confirmée).
    await cle('mec-route', { status: 'active', cloudSyncedAt: new Date('2026-08-01') })
    h.post.mockResolvedValue({ ok: false, code: 'NETWORK' }) // poste hors ligne

    const r = await revoquer('mec-route')
    expect(r.status).toBe(200)

    const apres = await prisma.licenseKey.findUnique({
      where: { licenseId: 'mec-route' }, select: { status: true, cloudSyncedAt: true },
    })
    expect(apres.status).toBe('revoked')
    expect(apres.cloudSyncedAt, 'sans cette remise à zéro, la révocation n’est JAMAIS rejouée').toBeNull()

    // Et le rattrapage la voit maintenant.
    h.post.mockResolvedValue({ ok: true, status: 200, data: { ok: true } })
    expect(await retryPendingMechanicSyncs(garageId)).toBe(1)
  })
})
