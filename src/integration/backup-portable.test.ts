/**
 * Sauvegarde portable — test d'intégration SQLite.
 * Prouve : manifeste auto-descriptif (version schéma/app, comptes), couverture
 * des tables e-invoicing, et RESTAURATION SUR UNE MACHINE VIERGE (garage +
 * données recréés à partir du seul blob chiffré + passphrase), avec rejet en cas
 * d'altération d'intégrité ou de garage non concordant.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-backup.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-backupdir-'))

let prisma: any
let svc: typeof import('@/lib/backup/service')
const PASS = 'passphrase-de-sauvegarde-forte'
let garageId: string

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  svc = await import('@/lib/backup/service')

  garageId = (await prisma.garage.create({ data: { name: 'Garage Test', slug: 'gtest', siret: '73282932000074' } })).id
  const client = await prisma.client.create({ data: { name: 'Client X', garageId } })
  await prisma.vehicle.create({ data: { licensePlate: 'AA-123-BB', make: 'Peugeot', model: '308', clientId: client.id, garageId } })
  const invoice = await prisma.invoice.create({
    data: { number: 'FAC-2026-1', garageId, clientName: 'Client X', issueDate: '2026-05-01', taxRate: 20 },
  })
  const sub = await prisma.eInvoiceSubmission.create({
    data: { invoiceId: invoice.id, garageId, idempotencyKey: 'FAC-2026-1:CII', documentFormat: 'CII', documentHash: 'a'.repeat(64) },
  })
  await prisma.eInvoiceEvent.create({ data: { submissionId: sub.id, type: 'submit', status: 'SUBMITTED' } })
}, 40_000)

afterAll(() => {
  try { fs.rmSync(DB_PATH) } catch { /* ignore */ }
  try { fs.rmSync(process.env.GF_BACKUP_DIR!, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('manifeste & couverture e-invoicing', () => {
  it('crée une sauvegarde dont le manifeste décrit le schéma et couvre e-invoicing', async () => {
    const record = await svc.createBackup(garageId, { passphrase: PASS })
    const blob = (await svc.readBackupBlob(garageId, record.id))!.blob
    const inspected = svc.inspectBlob(blob, PASS)
    expect(inspected.ok).toBe(true)
    expect(inspected.manifest!.format).toBe('gf-backup')
    expect(inspected.manifest!.schemaVersion).toBeGreaterThan(0)
    expect(inspected.manifest!.counts.eInvoiceSubmissions).toBe(1)
    expect(inspected.manifest!.counts.eInvoiceEvents).toBe(1)
    expect(inspected.manifest!.counts.invoices).toBe(1)
  })

  it('rejette un blob altéré (intégrité)', async () => {
    const record = await svc.createBackup(garageId, { passphrase: PASS })
    const blob = (await svc.readBackupBlob(garageId, record.id))!.blob
    const bad = blob.slice(0, -6) + 'XXXXXX'
    expect(svc.inspectBlob(bad, PASS).ok).toBe(false)
  })
})

describe('restauration sur une machine VIERGE', () => {
  it('recrée le garage et les données à partir du seul blob', async () => {
    const record = await svc.createBackup(garageId, { passphrase: PASS })
    const blob = (await svc.readBackupBlob(garageId, record.id))!.blob

    // Simule une machine vierge : suppression totale du garage (cascade).
    await prisma.garage.delete({ where: { id: garageId } })
    expect(await prisma.garage.findUnique({ where: { id: garageId } })).toBeNull()

    const report = await svc.restoreFromBlob(blob, { passphrase: PASS, confirmGarageId: garageId })
    expect(report.ok).toBe(true)
    expect(report.garageRestored).toBe(true)
    expect(report.restored!.invoices).toBe(1)
    expect(report.restored!.eInvoiceSubmissions).toBe(1)
    expect(report.restored!.eInvoiceEvents).toBe(1)

    // Les données sont réellement de retour.
    expect(await prisma.garage.findUnique({ where: { id: garageId } })).not.toBeNull()
    expect(await prisma.invoice.count({ where: { garageId } })).toBe(1)
    expect(await prisma.eInvoiceSubmission.count({ where: { garageId } })).toBe(1)
  })

  it('refuse une restauration si le garage indiqué ne correspond pas', async () => {
    const record = await svc.createBackup(garageId, { passphrase: PASS })
    const blob = (await svc.readBackupBlob(garageId, record.id))!.blob
    const report = await svc.restoreFromBlob(blob, { passphrase: PASS, confirmGarageId: 'un-autre-garage' })
    expect(report.ok).toBe(false)
  })

  it('refuse une restauration avec une mauvaise passphrase', async () => {
    const record = await svc.createBackup(garageId, { passphrase: PASS })
    const blob = (await svc.readBackupBlob(garageId, record.id))!.blob
    const report = await svc.restoreFromBlob(blob, { passphrase: 'mauvaise', confirmGarageId: garageId })
    expect(report.ok).toBe(false)
  })
})
