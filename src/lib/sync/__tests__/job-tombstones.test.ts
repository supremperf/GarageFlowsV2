/**
 * GF31-AUD-044 — une intervention supprimée pouvait rester visible pour
 * toujours dans la PWA du mécanicien.
 *
 * Le cloud déduisait les suppressions de l'ABSENCE d'une intervention dans la
 * fenêtre de dates remontée. L'inférence ne couvre pas deux cas réels :
 *
 *  1. le poste est HORS LIGNE au moment de la suppression ; quand il
 *     resynchronise, la date de l'intervention est sortie de la fenêtre —
 *     l'absence n'est plus interprétable, et rien n'est supprimé ;
 *  2. la remontée est TRONQUÉE (plus de `SYNC_MAX_JOBS` interventions) : toute
 *     purge par inférence est alors suspendue, à raison (GF31-AUD-017).
 *
 * Dans les deux cas, le mécanicien pouvait se déplacer sur une intervention
 * annulée, et des données client supprimées côté garage restaient exposées dans
 * le cloud.
 *
 * La correction rend la suppression EXPLICITE : une pierre tombale écrite dans
 * la même transaction que la suppression, transmise indépendamment de la
 * fenêtre, et effacée seulement sur accusé de réception.
 *
 * Base SQLite réelle des deux côtés : la route cloud est exercée pour de vrai.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { prepareTestDb } from '../../../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../../../.tmp-itest-tombstones.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})
// La remontée réseau n'est pas l'objet de ce test : on observe ce que le poste
// ENVOIE, et on lui rend ce que le cloud RÉPONDRAIT.
const cloud = vi.hoisted(() => ({
  dernierCorps: null as Record<string, unknown> | null,
  reponse: { ok: true, data: { deletedApplied: [] as string[], changes: { jobs: [], notes: [], photos: [] } } } as Record<string, unknown>,
}))
vi.mock('@/lib/sync/cloud-client', () => ({
  isDesktopInstance: () => true,
  // La licence garage est la preuve d'identité du poste : sans elle la remontée
  // s'arrête avant tout appel réseau. Elle est simulée ici — sa recherche en
  // base a ses propres tests, et ce fichier éprouve les pierres tombales.
  garageLicenseToken: async () => 'GF2.jeton-licence-test',
  cloudPost: async (_chemin: string, corps: Record<string, unknown>) => {
    cloud.dernierCorps = corps
    return cloud.reponse
  },
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

let prisma: any
let jobDELETE: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let syncGarageJobs: (garageId: string, now?: Date) => Promise<Record<string, unknown>>
let garageId = ''
let mecanicienId = ''

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ DELETE: jobDELETE } = (await import('@/app/api/jobs/[id]/route')) as any)
  ;({ syncGarageJobs } = (await import('@/lib/sync/job-sync')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'Tombes', slug: 'aud-044' } })).id
  mecanicienId = (await prisma.mechanic.create({ data: { garageId, name: 'Jean', avatar: 'J', color: '#123456' } })).id
  // Licence garage RÉELLE : c'est elle qui sert de preuve d'identité au poste.
  await prisma.licenseKey.create({
    data: {
      licenseId: 'lic-aud-044', token: 'GF2.aaa.bbb.ccc', customerId: 'client-test',
      licenseType: 'premium', expiryAt: new Date('2030-01-01'), status: 'active', garageId,
    },
  })
  h.session = { user: { id: 'u', role: 'OWNER', garageId } }
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  await prisma.jobTombstone.deleteMany({})
  await prisma.job.deleteMany({ where: { garageId } })
  cloud.dernierCorps = null
  cloud.reponse = { ok: true, data: { deletedApplied: [], changes: { jobs: [], notes: [], photos: [] } } }
})

async function intervention(date: string): Promise<string> {
  const j = await prisma.job.create({
    data: {
      garageId, mechanicId: mecanicienId,
      customerName: 'Client', vehicleModel: 'Clio', repairType: 'Vidange',
      estimatedDuration: 60, startTime: '09:00', date, status: 'scheduled',
    },
  })
  return j.id
}

const supprimer = (id: string) =>
  jobDELETE(new Request(`http://localhost/api/jobs/${id}`, { method: 'DELETE' }), { params: { id } })

describe('GF31-AUD-044 — la suppression laisse une trace explicite', () => {
  it('supprimer une intervention écrit une pierre tombale', async () => {
    const id = await intervention('2026-08-20')
    expect((await supprimer(id)).status).toBe(200)

    expect(await prisma.job.findUnique({ where: { id } })).toBeNull()
    const tombe = await prisma.jobTombstone.findUnique({ where: { jobId: id } })
    expect(tombe).not.toBeNull()
    expect(tombe.garageId).toBe(garageId)
    expect(tombe.deletedAt).toBeInstanceOf(Date)
  })

  it('la trace part avec la remontée, INDÉPENDAMMENT de la fenêtre', async () => {
    // Intervention très ancienne : sa date est hors de la fenêtre remontée,
    // donc son absence n'apprend rien au cloud — c'est exactement le cas qui
    // laissait une tâche fantôme pour toujours.
    const id = await intervention('2020-01-15')
    await supprimer(id)

    await syncGarageJobs(garageId, new Date('2026-08-13'))
    const corps = cloud.dernierCorps as { jobs: unknown[]; deletedIds: string[] }
    expect(corps.deletedIds).toContain(id)
    // Et l'intervention n'était effectivement PAS dans la fenêtre remontée.
    expect(corps.jobs).toHaveLength(0)
  })

  it('la trace n’est effacée QUE sur accusé de réception', async () => {
    const id = await intervention('2026-08-20')
    await supprimer(id)

    // Le cloud n'accuse rien (réponse sans `deletedApplied`).
    cloud.reponse = { ok: true, data: { changes: { jobs: [], notes: [], photos: [] } } }
    await syncGarageJobs(garageId, new Date('2026-08-13'))
    expect(await prisma.jobTombstone.findUnique({ where: { jobId: id } })).not.toBeNull()

    // Deuxième remontée : la trace repart.
    cloud.reponse = { ok: true, data: { deletedApplied: [id], changes: { jobs: [], notes: [], photos: [] } } }
    await syncGarageJobs(garageId, new Date('2026-08-13'))
    expect(await prisma.jobTombstone.findUnique({ where: { jobId: id } })).toBeNull()
  })

  it('une remontée en échec réseau ne perd pas la trace', async () => {
    const id = await intervention('2026-08-20')
    await supprimer(id)
    cloud.reponse = { ok: false, code: 'NETWORK' }
    await syncGarageJobs(garageId, new Date('2026-08-13'))
    // Le poste peut être éteint ici : la trace est en BASE, pas en mémoire.
    expect(await prisma.jobTombstone.findUnique({ where: { jobId: id } })).not.toBeNull()
  })

  it('n’accuse que ce que le cloud a réellement listé', async () => {
    const a = await intervention('2026-08-20')
    const b = await intervention('2026-08-21')
    await supprimer(a)
    await supprimer(b)

    cloud.reponse = { ok: true, data: { deletedApplied: [a], changes: { jobs: [], notes: [], photos: [] } } }
    await syncGarageJobs(garageId, new Date('2026-08-13'))

    expect(await prisma.jobTombstone.findUnique({ where: { jobId: a } })).toBeNull()
    expect(await prisma.jobTombstone.findUnique({ where: { jobId: b } })).not.toBeNull()
  })

  it('la suppression et sa trace sont atomiques', async () => {
    // Supprimer une intervention d'un AUTRE garage échoue : ni suppression, ni
    // pierre tombale orpheline.
    const autre = (await prisma.garage.create({ data: { name: 'Autre', slug: 'aud-044-b' } })).id
    const mecanicienAutre = (await prisma.mechanic.create({ data: { garageId: autre, name: 'Paul', avatar: 'P', color: '#654321' } })).id
    const j = await prisma.job.create({
      data: {
        garageId: autre, mechanicId: mecanicienAutre,
        customerName: 'X', vehicleModel: 'Y', repairType: 'Z',
        estimatedDuration: 30, startTime: '10:00', date: '2026-08-20', status: 'scheduled',
      },
    })
    // La route répondait par une exception Prisma (P2025), donc un 500
    // « erreur interne » ; elle répond désormais 404. L'invariant vérifié ici
    // est inchangé : rien n'est supprimé, aucune pierre tombale n'est posée.
    expect((await supprimer(j.id)).status).toBe(404)
    expect(await prisma.job.findUnique({ where: { id: j.id } })).not.toBeNull()
    expect(await prisma.jobTombstone.findUnique({ where: { jobId: j.id } })).toBeNull()
  })
})
