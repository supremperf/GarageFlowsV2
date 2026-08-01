/**
 * RGPD — droit d'accès (export) et droit à l'effacement (anonymisation) d'un
 * client, sur base SQLite. Prouve : export complet, anonymisation des PII avec
 * CONSERVATION des documents comptables (montants intacts), suppression du
 * compte portail, et ISOLATION multi-tenant.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-rgpd.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

let prisma: any
let rgpd: typeof import('@/lib/rgpd/subject')
let garageA: string
let garageB: string
let clientA: string
let invoiceA: string

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  rgpd = await import('@/lib/rgpd/subject')

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id
  const c = await prisma.client.create({ data: { name: 'Jean Dupont', phone: '0102030405', email: 'jean@x.fr', address: '1 rue X', garageId: garageA } })
  clientA = c.id
  await prisma.vehicle.create({ data: { licensePlate: 'AA-123-BB', vin: 'VF1234567890', make: 'Renault', model: 'Clio', clientId: clientA, garageId: garageA } })
  invoiceA = (await prisma.invoice.create({
    data: { number: 'FAC-1', garageId: garageA, clientId: clientA, clientName: 'Jean Dupont', clientEmail: 'jean@x.fr', issueDate: '2026-01-01', taxRate: 20 },
  })).id
  await prisma.invoiceLine.create({ data: { invoiceId: invoiceA, description: 'Réparation', quantity: 1, unitPrice: 100, unitCost: 40 } })
  await prisma.reminder.create({ data: { garageId: garageA, clientId: clientA, clientName: 'Jean Dupont', phone: '0102030405', type: 'ct', scheduledDate: '2026-06-01' } })
  await prisma.portalUser.create({ data: { garageId: garageA, clientId: clientA, email: 'jean@x.fr', passwordHash: 'x' } })
}, 40_000)

afterAll(() => { try { fs.rmSync(DB_PATH) } catch { /* ignore */ } })

describe('exportSubject (droit d\'accès)', () => {
  it('rassemble toutes les données personnelles du client', async () => {
    const dump = await rgpd.exportSubject(garageA, clientA)
    expect(dump).not.toBeNull()
    expect((dump!.client as any).email).toBe('jean@x.fr')
    expect(dump!.vehicles).toHaveLength(1)
    expect(dump!.invoices).toHaveLength(1)
    expect(dump!.reminders).toHaveLength(1)
    expect(dump!.portalUsers).toHaveLength(1)
    // Jamais de hash exposé.
    expect(JSON.stringify(dump!.portalUsers)).not.toContain('passwordHash')
  })
  it('renvoie null pour un client d\'un autre garage (isolation)', async () => {
    expect(await rgpd.exportSubject(garageB, clientA)).toBeNull()
  })
})

describe('eraseSubject (droit à l\'effacement)', () => {
  it('anonymise les PII, conserve les montants, supprime le portail', async () => {
    const report = await rgpd.eraseSubject(garageA, clientA)
    expect(report.ok).toBe(true)
    expect(report.anonymized.client).toBe(1)
    expect(report.deleted.portalUsers).toBe(1)

    const client = await prisma.client.findUnique({ where: { id: clientA } })
    expect(client.name).toBe(rgpd.ANON_NAME)
    expect(client.email).toBeNull()

    // Facture CONSERVÉE : PII neutralisée, montant intact.
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceA }, include: { lines: true } })
    expect(inv.clientName).toBe(rgpd.ANON_NAME)
    expect(inv.clientEmail).toBeNull()
    expect(inv.lines[0].unitPrice).toBe(100) // montant conservé

    // Compte portail supprimé.
    expect(await prisma.portalUser.count({ where: { clientId: clientA } })).toBe(0)
    // Véhicule anonymisé (plaque/VIN).
    const veh = await prisma.vehicle.findFirst({ where: { clientId: clientA } })
    expect(veh.licensePlate).toBe(rgpd.ANON_PLATE)
    expect(veh.vin).toBeNull()
  })

  it('refuse l\'effacement d\'un client d\'un autre garage (isolation)', async () => {
    const report = await rgpd.eraseSubject(garageB, clientA)
    expect(report.ok).toBe(false)
  })
})
