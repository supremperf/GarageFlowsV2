/**
 * Le battement de 10 s ne doit pas republier tout le planning six fois par minute.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * `/api/jobs/pulse` appelle `pollJobSync` à CHAQUE battement, et sa garde de
 * cadence vaut exactement la période du battement (10 s) : chaque battement
 * déclenchait donc un cycle complet. Or `syncGarageJobs` ne remontait pas un
 * delta — il relisait TOUTE la fenêtre [J−7, J+30] (jusqu'à 500 interventions)
 * et la renvoyait entière, qu'elle ait changé ou non.
 *
 * Le cloud réécrivait alors chaque ligne (`resolveMirrorWrite` rend toujours au
 * moins les champs de planification), ce qui remettait leur `updatedAt` à
 * l'heure du serveur ; la fenêtre entière redescendait par la voie de retour, et
 * bougeait à son tour l'empreinte du battement. Résultat : le comptoir
 * rechargeait son planning en permanence, atelier vide compris, et le seul
 * détecteur de changement du produit ne détectait plus rien.
 *
 * ─── Ce que ces tests protègent ─────────────────────────────────────────────
 * La passe en LECTURE SEULE, et surtout ses deux garde-fous : elle ne doit ni
 * faire conclure à une suppression (charge utile vide ≠ interventions
 * disparues), ni couper la voie de retour, qui est sa raison d'être.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../.tmp-lecture-seule.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const cloud = vi.hoisted(() => ({ corps: [] as Record<string, unknown>[] }))
vi.mock('@/lib/sync/cloud-client', () => ({
  isDesktopInstance: () => true,
  garageLicenseToken: async () => 'GF2.jeton-licence-test',
  cloudPost: async (chemin: string, corps: Record<string, unknown>) => {
    cloud.corps.push({ chemin, ...corps })
    return { ok: true, status: 200, data: { deletedApplied: [], changes: null, syncedAt: new Date().toISOString() } }
  },
}))

let prisma: any
let syncGarageJobs: any
let resetJobSyncState: any
let garageId = ''
let mechanicId = ''

/** Remontées vers /api/sync/jobs uniquement. */
const remontees = () => cloud.corps.filter((c) => c.chemin === '/api/sync/jobs')

async function intervention(id: string, over: Record<string, unknown> = {}) {
  const aujourdhui = new Date().toISOString().slice(0, 10)
  return prisma.job.create({
    data: {
      id, garageId, mechanicId, customerName: 'Client', vehicleModel: 'Clio',
      repairType: 'revision', estimatedDuration: 60, startTime: '09:00',
      date: aujourdhui, status: 'scheduled', ...over,
    },
  })
}

beforeAll(async () => {
  const { prepareTestDb } = await import('../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  const mod = (await import('@/lib/sync/job-sync')) as any
  syncGarageJobs = mod.syncGarageJobs
  resetJobSyncState = mod.resetJobSyncState

  garageId = (await prisma.garage.create({ data: { name: 'G', slug: 'lecture-seule' } })).id
  mechanicId = (await prisma.mechanic.create({
    data: { name: 'Meca', avatar: 'a', color: '#111', garageId },
  })).id
  await prisma.licenseKey.create({
    data: {
      licenseId: 'garage-1', token: 'GF2.garage', customerId: 'c', licenseType: 'premium',
      expiryAt: new Date('2027-01-01'), status: 'active', garageId,
    },
  })
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  cloud.corps = []
  resetJobSyncState?.()
  await prisma.jobTombstone.deleteMany({})
  await prisma.job.deleteMany({})
})

describe('une fenêtre inchangée n’est pas republiée', () => {
  it('la première remontée pousse, la seconde passe en LECTURE SEULE', async () => {
    await intervention('job-1')

    await syncGarageJobs(garageId)
    const premiere = remontees()[0]
    expect(premiere.pullOnly, 'la première passe ne sait pas ce que le cloud détient').toBeFalsy()
    expect((premiere.jobs as unknown[]).length).toBe(1)

    await syncGarageJobs(garageId)
    const seconde = remontees()[1]
    expect(seconde.pullOnly, 'rien n’a changé : rien à annoncer').toBe(true)
    expect(seconde.jobs, 'republier la fenêtre entière était le coût dominant du produit').toEqual([])
  })

  it('une MODIFICATION locale fait repartir une vraie poussée', async () => {
    await intervention('job-1')
    await syncGarageJobs(garageId)
    await syncGarageJobs(garageId)

    await prisma.job.update({ where: { id: 'job-1' }, data: { status: 'in_progress' } })
    await syncGarageJobs(garageId)

    const derniere = remontees()[2]
    expect(derniere.pullOnly).toBeFalsy()
    expect((derniere.jobs as unknown[]).length).toBe(1)
  })

  it('une intervention AJOUTÉE fait repartir une vraie poussée', async () => {
    await intervention('job-1')
    await syncGarageJobs(garageId)
    await intervention('job-2')
    await syncGarageJobs(garageId)

    const derniere = remontees()[1]
    expect(derniere.pullOnly, 'le nombre a changé').toBeFalsy()
    expect((derniere.jobs as unknown[]).length).toBe(2)
  })

  it('une suppression en attente interdit la lecture seule', async () => {
    await intervention('job-1')
    await syncGarageJobs(garageId)
    await syncGarageJobs(garageId) // devient lecture seule

    await prisma.jobTombstone.create({ data: { garageId, jobId: 'job-supprime' } })
    await syncGarageJobs(garageId)

    const derniere = remontees()[2]
    expect(derniere.pullOnly, 'une suppression doit ATTEINDRE le cloud').toBeFalsy()
    expect(derniere.deletedIds).toEqual(['job-supprime'])
  })

  it('la voie de retour continue d’être demandée en lecture seule', async () => {
    await intervention('job-1')
    await syncGarageJobs(garageId)
    await syncGarageJobs(garageId)

    const seconde = remontees()[1]
    // C'est la raison d'être de la passe : rapatrier le travail du mécanicien.
    // Sans curseurs, elle ne demanderait rien et ne servirait à rien.
    expect(seconde).toHaveProperty('sinceJobs')
    expect(seconde).toHaveProperty('sinceNotes')
    expect(seconde).toHaveProperty('sincePhotos')
    expect(seconde.window, 'le cloud doit savoir de quelle fenêtre on parle').toBeTruthy()
  })
})
