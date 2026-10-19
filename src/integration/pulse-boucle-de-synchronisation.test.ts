/**
 * GF-012 — le battement du poste était fermé sur lui-même : l'action du
 * mécanicien ne pouvait PAS le réveiller.
 *
 * ─── La dépendance circulaire ───────────────────────────────────────────────
 * `/api/jobs/pulse` calcule une empreinte sur la base LOCALE (SQLite du poste).
 * L'action du mécanicien vit dans la base du CLOUD. La voie de retour
 * cloud → poste n'était déclenchée que par `pollJobSync`, appelée uniquement
 * depuis `GET /api/jobs` — que le poste n'émet QUE si l'empreinte a changé :
 *
 *   empreinte inchangée → pas de GET /api/jobs → pas de pollJobSync
 *   → pas de synchronisation → base locale inchangée → empreinte inchangée
 *
 * Le mécanicien appuyait sur « Terminer », et l'écran du comptoir affichait
 * « Prévu » indéfiniment tant que personne ne touchait au poste. La route qui
 * prétendait corriger précisément ce défaut (GF-DUR-041) en était structurellement
 * incapable.
 *
 * ─── Second défaut, plus discret ────────────────────────────────────────────
 * Les COMMENTAIRES et les PHOTOS du mécanicien vivent dans leurs propres tables.
 * Rapatriés par la voie de retour, ils ne touchent pas `Job.updatedAt` : même une
 * synchronisation réussie ne faisait alors pas bouger l'empreinte, et l'écran ne
 * se rechargeait pas.
 */
type OriginalModule1 = typeof import('@/lib/api-helpers')

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-pulse-boucle.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({
  session: null as any,
  appels: [] as (string | null | undefined)[],
  etatCloud: null as 'ok' | 'attente' | null,
}))

vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const reel = await importOriginal<OriginalModule1>()
  return { ...reel, withAuth: (fn: any) => fn, requireSession: async () => h.session }
})
// On observe le DÉCLENCHEMENT de la voie de retour ; la remontée réseau
// elle-même est couverte ailleurs et n'a rien à faire dans un test local.
vi.mock('@/lib/sync/job-sync', () => ({
  pollJobSync: (garageId: string | null | undefined) => { h.appels.push(garageId) },
  scheduleJobSync: () => {},
  // État de la dernière remontée, remonté à l'écran depuis GF-039. `null` =
  // aucune remontée n'a encore eu lieu, ce qui est le cas dans ce test.
  etatSyncCloud: () => h.etatCloud,
}))

let prisma: any
let pulseGET: (req: Request) => Promise<Response>
const ids = { garage: '', job: '', mecano: '' }
const JOUR = '2026-08-21'

const battre = async () =>
  (await pulseGET(new Request(`http://localhost/api/jobs/pulse?date=${JOUR}`))).json()

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET: pulseGET } = (await import('@/app/api/jobs/pulse/route')) as any)

  const garage = await prisma.garage.create({ data: { name: 'Garage Battement', slug: 'garage-battement' } })
  const mecano = await prisma.mechanic.create({ data: { name: 'Alice', avatar: 'AL', color: '#000', garageId: garage.id } })
  const job = await prisma.job.create({
    data: {
      customerName: 'Jean', vehicleModel: 'Clio', repairType: 'oil_change',
      estimatedDuration: 60, startTime: '09:00', date: JOUR,
      garageId: garage.id, mechanicId: mecano.id,
    },
  })
  ids.garage = garage.id; ids.job = job.id; ids.mecano = mecano.id
  h.session = { user: { id: 'u1', garageId: garage.id, role: 'OWNER' } }
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

describe('battement du planning — la boucle est ouverte (GF-012)', () => {
  it('le battement DÉCLENCHE la voie de retour cloud → poste', async () => {
    h.appels = []
    await battre()
    expect(h.appels, 'sans cela, rien ne réveille jamais la synchronisation').toEqual([ids.garage])
  })

  it('l’empreinte est stable quand rien ne change', async () => {
    const a = await battre()
    const b = await battre()
    expect(a.v).toBe(b.v)
    expect(typeof a.v).toBe('string')
  })

  it('un changement de STATUT d’intervention change l’empreinte', async () => {
    const avant = (await battre()).v
    await prisma.job.update({ where: { id: ids.job }, data: { status: 'completed' } })
    expect((await battre()).v).not.toBe(avant)
  })

  it('un COMMENTAIRE de mécanicien change l’empreinte', async () => {
    // Rapatrié par la voie de retour, il ne touche pas `Job.updatedAt` :
    // l'empreinte ne bougeait pas et l'écran ne se rechargeait pas.
    const avant = (await battre()).v
    await prisma.jobMechanicNote.create({
      data: { jobId: ids.job, garageId: ids.garage, mechanicId: ids.mecano, type: 'comment', body: 'Frein arrière à revoir' },
    })
    expect((await battre()).v).not.toBe(avant)
  })

  it('une PHOTO de mécanicien change l’empreinte', async () => {
    const avant = (await battre()).v
    await prisma.jobPhoto.create({
      data: { jobId: ids.job, garageId: ids.garage, phase: 'during', base64: '', mechanicId: ids.mecano },
    })
    expect((await battre()).v).not.toBe(avant)
  })

  it('l’empreinte ne divulgue ni volumétrie ni horodatage', async () => {
    const { v } = await battre()
    expect(v).toMatch(/^[0-9a-f]{16}$/)
  })
})
