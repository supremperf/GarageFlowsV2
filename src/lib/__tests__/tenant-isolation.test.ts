/**
 * Isolation multi-tenant — tests d'intégration RÉELS avec deux garages A et B
 * sur une base SQLite temporaire (copie du modèle committé).
 *
 * Prouve les deux primitives d'isolation appliquées dans les routes :
 *  1. `relationInGarage` — une FK d'un autre garage est refusée ;
 *  2. écritures atomiques `updateMany/deleteMany({ where: { id, garageId } })`
 *     — impossible de modifier/supprimer l'objet d'un autre garage (anti-TOCTOU).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let relationInGarage: any
let tmpDb = ''

const ids = { garageA: '', garageB: '', mechA: '', mechB: '', jobA: '', jobB: '', clientB: '' }

async function seedGarage(slug: string) {
  const g = await prisma.garage.create({ data: { name: slug, slug } })
  const mech = await prisma.mechanic.create({ data: { name: `mech-${slug}`, avatar: '', color: '#000', garageId: g.id } })
  const client = await prisma.client.create({ data: { name: `client-${slug}`, garageId: g.id } })
  const job = await prisma.job.create({
    data: {
      customerName: 'X', vehicleModel: 'Y', repairType: 'Z', estimatedDuration: 60,
      startTime: '09:00', date: '2026-07-30', mechanicId: mech.id, garageId: g.id,
    },
  })
  return { g, mech, client, job }
}

beforeAll(async () => {
  tmpDb = path.join(os.tmpdir(), `gf-tenant-test-${process.pid}-${Math.floor(Math.random() * 1e6)}.db`)
  fs.copyFileSync(path.resolve('prisma/garageflow-template.db'), tmpDb)
  process.env.DATABASE_URL = `file:${tmpDb}`

  const tenant = await import('@/lib/tenant')
  relationInGarage = tenant.relationInGarage
  const db = await import('@/lib/db')
  prisma = db.prisma

  const A = await seedGarage(`a-${Date.now()}`)
  const B = await seedGarage(`b-${Date.now()}`)
  ids.garageA = A.g.id; ids.mechA = A.mech.id; ids.jobA = A.job.id
  ids.garageB = B.g.id; ids.mechB = B.mech.id; ids.jobB = B.job.id; ids.clientB = B.client.id
})

afterAll(async () => {
  if (prisma) await prisma.$disconnect()
  if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb)
})

describe('isolation multi-tenant (garages A & B)', () => {
  it('relationInGarage accepte une FK du même garage', async () => {
    expect(await relationInGarage(ids.garageA, 'mechanic', ids.mechA)).toBe(true)
    expect(await relationInGarage(ids.garageB, 'client', ids.clientB)).toBe(true)
  })

  it('relationInGarage REFUSE une FK appartenant à un autre garage', async () => {
    // Le mécanicien de B ne doit jamais être assignable depuis A.
    expect(await relationInGarage(ids.garageA, 'mechanic', ids.mechB)).toBe(false)
    // Le client de B invisible depuis A.
    expect(await relationInGarage(ids.garageA, 'client', ids.clientB)).toBe(false)
  })

  it('relationInGarage(null) ne bloque pas (rien à vérifier)', async () => {
    expect(await relationInGarage(ids.garageA, 'mechanic', null)).toBe(true)
  })

  it('lecture scopée : A ne voit pas le job de B', async () => {
    const seenFromA = await prisma.job.findFirst({ where: { id: ids.jobB, garageId: ids.garageA } })
    expect(seenFromA).toBeNull()
    const seenFromB = await prisma.job.findFirst({ where: { id: ids.jobB, garageId: ids.garageB } })
    expect(seenFromB).not.toBeNull()
  })

  it('écriture atomique : A ne peut pas modifier le job de B (updateMany count=0)', async () => {
    const res = await prisma.job.updateMany({
      where: { id: ids.jobB, garageId: ids.garageA },
      data: { status: 'hacked' },
    })
    expect(res.count).toBe(0)
    // L'objet de B est intact.
    const jobB = await prisma.job.findUnique({ where: { id: ids.jobB } })
    expect(jobB.status).not.toBe('hacked')
  })

  it('suppression atomique : A ne peut pas supprimer le job de B (deleteMany count=0)', async () => {
    const res = await prisma.job.deleteMany({ where: { id: ids.jobB, garageId: ids.garageA } })
    expect(res.count).toBe(0)
    const jobB = await prisma.job.findUnique({ where: { id: ids.jobB } })
    expect(jobB).not.toBeNull()
  })

  it('le garage propriétaire, lui, peut modifier son objet', async () => {
    const res = await prisma.job.updateMany({
      where: { id: ids.jobB, garageId: ids.garageB },
      data: { status: 'done' },
    })
    expect(res.count).toBe(1)
  })
})
