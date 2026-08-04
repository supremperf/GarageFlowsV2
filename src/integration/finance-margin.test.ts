/**
 * Integration test — /api/finance « Marge pièces » : cohérence des populations.
 *
 * Exécute le VRAI handler contre une base SQLite réelle (auth simulée). Prouve
 * que le coût des pièces est calculé sur EXACTEMENT les factures payées qui
 * composent le CA, et pas sur une population incohérente :
 *   • une facture PAYÉE (pièce 200/coût 50 + MO 100) → caHT=300, partsCost=50 ;
 *   • une facture NON payée (brouillon) est exclue du CA ET du coût ;
 *   • le coût de la MAIN-D'ŒUVRE n'est jamais compté dans partsCost ;
 *   • des pièces CONSOMMÉES (jobPart) non facturées n'affectent PAS partsCost
 *     (c'était le bug : coût de pièces d'un job non facturé gonflait la marge).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-finance.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({
  withAuth: (fn: unknown) => fn,
  requireSession: async () => h.session,
}))

let GET: (req: Request) => Promise<Response>
let prisma: any
let garageA = ''

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` },
    stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET } = await import('@/app/api/finance/route') as any)

  const a = await prisma.garage.create({ data: { name: 'A', slug: 'a', hourlyRate: 60, taxRate: 20 } })
  garageA = a.id

  // Facture PAYÉE : ligne pièce (PV 200 / coût 50) + ligne MO (PV 100 / coût 999 → ignoré).
  await prisma.invoice.create({ data: {
    number: 'FAC-2026-001', garageId: a.id, clientName: 'C', status: 'paid',
    issueDate: '2026-08-04', taxRate: 20,
    lines: { create: [
      { description: 'Filtre', quantity: 1, unitPrice: 200, unitCost: 50, isLabor: false, sortOrder: 0 },
      { description: 'Main d\'œuvre', quantity: 1, unitPrice: 100, unitCost: 999, isLabor: true, sortOrder: 1 },
    ] },
  } })

  // Facture NON payée (brouillon) : doit être EXCLUE du CA et du coût.
  await prisma.invoice.create({ data: {
    number: 'FAC-2026-002', garageId: a.id, clientName: 'C2', status: 'draft',
    issueDate: '2026-08-04', taxRate: 20,
    lines: { create: [
      { description: 'Pièce chère non payée', quantity: 1, unitPrice: 500, unitCost: 400, isLabor: false, sortOrder: 0 },
    ] },
  } })

  // Pièces CONSOMMÉES sur un job NON facturé : ne doivent PAS entrer dans partsCost.
  const mech = await prisma.mechanic.create({ data: { name: 'M', avatar: '', color: '#000', garageId: a.id } })
  const part = await prisma.part.create({ data: { name: 'P', reference: 'R', unitPrice: 1, unitCost: 1, garageId: a.id } })
  const job = await prisma.job.create({ data: {
    customerName: 'X', vehicleModel: 'Y', repairType: 'Z', estimatedDuration: 60,
    startTime: '09:00', date: '2026-08-04', mechanicId: mech.id, garageId: a.id,
  } })
  await prisma.jobPart.create({ data: { jobId: job.id, partId: part.id, quantity: 10, unitPrice: 1, unitCost: 9999 } })

  h.session = { user: { id: 'u', name: 'A', role: 'OWNER', garageId: a.id } }
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('GET /api/finance — Marge pièces cohérente', () => {
  it('coût des pièces = pièces des factures PAYÉES uniquement (MO, brouillons et consommations exclus)', async () => {
    const req = new Request('http://localhost/api/finance?months=1')
    const res = await GET(req)
    const json = await res.json()
    const m = json.months[json.months.length - 1] // mois courant

    expect(m.caHT).toBe(300)       // 200 (pièce) + 100 (MO) de la facture payée
    expect(m.partsCost).toBe(50)   // seule la ligne pièce payée — pas 999, 400, ni 9999
    expect(m.margin).toBe(83)      // round((300-50)/300*100)
  })
})
