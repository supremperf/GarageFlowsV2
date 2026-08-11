/**
 * PWA MÉCANICIEN — périmètre serveur et propagation des affectations.
 *
 * Base SQLite RÉELLE + VRAIS handlers d'API. Seule la validation de la session
 * est simulée (`validateMechanicSession`) : c'est précisément le point où
 * l'identité du mécanicien doit provenir de la SESSION SIGNÉE. Tout le reste —
 * scoping, refus, réaffectation — passe par le vrai code.
 *
 * Prouve :
 *  • un mécanicien ne voit QUE ses interventions ;
 *  • `?mechanicId=` / `mechanicId` dans le corps sont IGNORÉS (anti-spoof) ;
 *  • aucune donnée d'un autre garage n'est accessible ;
 *  • une intervention nouvellement affectée apparaît au rafraîchissement suivant
 *    (c'est ce que la boucle de synchronisation de la PWA déclenche toutes les 3 s) ;
 *  • une RÉAFFECTATION retire l'accès à l'ancien mécanicien et l'ouvre au nouveau ;
 *  • aucune donnée financière ne fuit vers le mécanicien.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-mechanic-scope.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

const h = vi.hoisted(() => ({
  ctx: null as null | { licenseId: string; deviceId: string | null; garageId: string; mechanicId: string },
}))

// La session mécanicien est la SEULE source d'identité. En la simulant ici, on
// vérifie que les routes n'utilisent QUE ce contexte.
vi.mock('@/lib/license/mechanic-session', () => ({
  validateMechanicSession: async () =>
    h.ctx ? { ok: true, ctx: h.ctx } : { ok: false, status: 401, code: 'MECHANIC_SESSION_MISSING', reason: 'Accès mécanicien requis.' },
}))
// Les cookies ne sont pas disponibles hors requête Next : `requireMechanic` lit
// un cookie vide, ce qui est sans effet puisque la validation est simulée.
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }))

/* eslint-disable  */
let prisma: any
const api: Record<string, any> = {}
const ids = {
  garageA: '', garageB: '',
  mechA1: '', mechA2: '', mechB1: '',
  licA1: '', licA2: '', licB1: '',
  jobA1: '', jobA2: '', jobB1: '',
}
const TODAY = '2026-08-11'

const req = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

function loginAs(mechanicId: string, garageId: string, licenseId: string) {
  h.ctx = { licenseId, deviceId: null, garageId, mechanicId }
}

async function schedule(query = `?date=${TODAY}`) {
  const res = await api.schedule.GET(req('GET', `/api/mechanic/schedule${query}`))
  return { status: res.status, body: await res.json() }
}
async function jobDetail(jobId: string) {
  const res = await api.jobDetail.GET(req('GET', `/api/mechanic/jobs/${jobId}`), { params: { id: jobId } })
  return { status: res.status, body: await res.json() }
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  api.schedule = await import('@/app/api/mechanic/schedule/route')
  api.jobDetail = await import('@/app/api/mechanic/jobs/[id]/route')
  api.notes = await import('@/app/api/mechanic/jobs/[id]/notes/route')
  api.me = await import('@/app/api/mechanic/me/route')
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  await prisma.jobMechanicNote.deleteMany({})
  await prisma.job.deleteMany({})
  await prisma.licenseKey.deleteMany({})
  await prisma.mechanic.deleteMany({})
  await prisma.garage.deleteMany({})

  const gA = await prisma.garage.create({ data: { name: 'Garage A', slug: 'ga-scope' } })
  const gB = await prisma.garage.create({ data: { name: 'Garage B', slug: 'gb-scope' } })
  ids.garageA = gA.id
  ids.garageB = gB.id

  const mA1 = await prisma.mechanic.create({ data: { name: 'Mécanicien A', avatar: '🔧', color: '#3b82f6', garageId: gA.id } })
  const mA2 = await prisma.mechanic.create({ data: { name: 'Mécanicien B', avatar: '🔩', color: '#10b981', garageId: gA.id } })
  const mB1 = await prisma.mechanic.create({ data: { name: 'Mécanicien C', avatar: '⚙️', color: '#f59e0b', garageId: gB.id } })
  ids.mechA1 = mA1.id; ids.mechA2 = mA2.id; ids.mechB1 = mB1.id

  // Clés mécanicien RÉELLES : `JobMechanicNote.licenseId` référence LicenseKey.
  ids.licA1 = 'lic-a1'; ids.licA2 = 'lic-a2'; ids.licB1 = 'lic-b1'
  const expiryAt = new Date(Date.now() + 365 * 24 * 3600 * 1000)
  for (const [licenseId, mechanicId, garageId] of [
    [ids.licA1, mA1.id, gA.id], [ids.licA2, mA2.id, gA.id], [ids.licB1, mB1.id, gB.id],
  ] as const) {
    await prisma.licenseKey.create({
      data: {
        licenseId, token: `GF2.${licenseId}`, customerId: 'test',
        licenseType: 'mechanic', expiryAt, garageId, mechanicId,
      },
    })
  }

  const mkJob = (garageId: string, mechanicId: string, repairType: string) => prisma.job.create({
    data: {
      customerName: 'Pauline', vehicleModel: 'Renault Twingo', licensePlate: 'FZ-319-BZ',
      repairType, estimatedDuration: 60, startTime: '09:00', date: TODAY,
      garageId, mechanicId,
    },
  })
  ids.jobA1 = (await mkJob(gA.id, mA1.id, 'Vidange')).id
  ids.jobA2 = (await mkJob(gA.id, mA2.id, 'Freins')).id
  ids.jobB1 = (await mkJob(gB.id, mB1.id, 'Embrayage')).id

  loginAs(ids.mechA1, ids.garageA, ids.licA1)
})

// ─────────────────────────────────────────────────────────────────────────────

describe('périmètre : un mécanicien ne voit QUE ses interventions', () => {
  it('le planning ne contient que les interventions attribuées', async () => {
    const r = await schedule()
    expect(r.status).toBe(200)
    expect(r.body.data.map((j: any) => j.id)).toEqual([ids.jobA1])
  })

  it('l’intervention d’un COLLÈGUE du même garage est inaccessible (404)', async () => {
    expect((await jobDetail(ids.jobA2)).status).toBe(404)
  })

  it('l’intervention d’un AUTRE GARAGE est inaccessible (404)', async () => {
    expect((await jobDetail(ids.jobB1)).status).toBe(404)
  })

  it('sans session → 401 et aucune donnée', async () => {
    h.ctx = null
    const r = await schedule()
    expect(r.status).toBe(401)
    expect(r.body.data).toBeUndefined()
  })
})

describe('anti-spoof : l’identité vient de la SESSION, jamais du client', () => {
  it('?mechanicId= d’un collègue est IGNORÉ', async () => {
    const r = await schedule(`?date=${TODAY}&mechanicId=${ids.mechA2}`)
    expect(r.status).toBe(200)
    expect(r.body.data.map((j: any) => j.id)).toEqual([ids.jobA1])
  })

  it('?garageId= d’un autre garage est IGNORÉ', async () => {
    const r = await schedule(`?date=${TODAY}&garageId=${ids.garageB}`)
    expect(r.body.data.map((j: any) => j.id)).toEqual([ids.jobA1])
  })

  it('un mechanicId injecté dans le CORPS n’ouvre aucun accès', async () => {
    const res = await api.notes.POST(
      req('POST', `/api/mechanic/jobs/${ids.jobA2}/notes`, {
        type: 'comment', body: 'tentative', mechanicId: ids.mechA2, garageId: ids.garageA,
      }),
      { params: { id: ids.jobA2 } },
    )
    expect(res.status).toBe(404)
    expect(await prisma.jobMechanicNote.count()).toBe(0)
  })

  it('une note écrite sur SON intervention porte l’identité de la SESSION', async () => {
    const res = await api.notes.POST(
      req('POST', `/api/mechanic/jobs/${ids.jobA1}/notes`, { type: 'comment', body: 'RAS', mechanicId: ids.mechA2 }),
      { params: { id: ids.jobA1 } },
    )
    expect(res.status).toBe(201)
    const note = await prisma.jobMechanicNote.findFirst({})
    expect(note.mechanicId).toBe(ids.mechA1) // PAS celui envoyé par le client
    expect(note.garageId).toBe(ids.garageA)
  })
})

describe('affectation : propagation vers la PWA', () => {
  it('une intervention créée puis affectée apparaît au rafraîchissement suivant', async () => {
    const before = await schedule()
    expect(before.body.data).toHaveLength(1)

    // Le garage crée et affecte (côté Desktop/Admin).
    const created = await prisma.job.create({
      data: {
        customerName: 'Pauline', vehicleModel: 'Renault Twingo', licensePlate: 'FZ-319-BZ',
        repairType: 'Vidange', estimatedDuration: 30, startTime: '14:00', date: TODAY,
        garageId: ids.garageA, mechanicId: ids.mechA1,
      },
    })

    // C'est exactement ce que fait la boucle de synchronisation de la PWA.
    const after = await schedule()
    expect(after.body.data.map((j: any) => j.id)).toContain(created.id)
    expect(after.body.data).toHaveLength(2)
  })

  it('RÉAFFECTATION A → B : A perd l’accès, B le gagne, sans reconnexion', async () => {
    // A voit son intervention.
    expect((await schedule()).body.data.map((j: any) => j.id)).toContain(ids.jobA1)
    expect((await jobDetail(ids.jobA1)).status).toBe(200)

    // L'administrateur réaffecte à B.
    await prisma.job.update({ where: { id: ids.jobA1 }, data: { mechanicId: ids.mechA2 } })

    // A : disparue du planning ET détail refusé — la MÊME session continue.
    expect((await schedule()).body.data.map((j: any) => j.id)).not.toContain(ids.jobA1)
    expect((await jobDetail(ids.jobA1)).status).toBe(404)

    // B : elle apparaît.
    loginAs(ids.mechA2, ids.garageA, ids.licA2)
    expect((await schedule()).body.data.map((j: any) => j.id)).toContain(ids.jobA1)
    expect((await jobDetail(ids.jobA1)).status).toBe(200)
  })

  it('après réaffectation, l’ancien mécanicien ne peut plus écrire', async () => {
    await prisma.job.update({ where: { id: ids.jobA1 }, data: { mechanicId: ids.mechA2 } })
    const res = await api.notes.POST(
      req('POST', `/api/mechanic/jobs/${ids.jobA1}/notes`, { type: 'comment', body: 'trop tard' }),
      { params: { id: ids.jobA1 } },
    )
    expect(res.status).toBe(404)
    expect(await prisma.jobMechanicNote.count()).toBe(0)
  })
})

describe('confidentialité : aucune donnée financière ni interne', () => {
  it('le planning n’expose ni prix, ni coût, ni marge, ni identifiant de mécanicien', async () => {
    const job = (await schedule()).body.data[0]
    for (const forbidden of ['unitPrice', 'unitCost', 'totalHT', 'totalTTC', 'margin', 'mechanicId', 'garageId']) {
      expect(job).not.toHaveProperty(forbidden)
    }
  })

  it('le détail d’intervention n’expose aucun montant', async () => {
    const { body } = await jobDetail(ids.jobA1)
    const serialized = JSON.stringify(body)
    expect(serialized).not.toMatch(/TenThousandths|unitPrice|unitCost|totalH[TC]/)
  })

  it('les réponses mécanicien sont marquées NON CACHABLES (aucune donnée figée)', async () => {
    const res = await api.schedule.GET(req('GET', `/api/mechanic/schedule?date=${TODAY}`))
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/)
  })
})
