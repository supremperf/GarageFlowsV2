/**
 * Persistance facturation électronique — test d'intégration sur SQLite temporaire.
 * Vérifie : création + empreinte SHA-256, idempotence (garageId, idempotencyKey),
 * événements de cycle de vie, et ISOLATION multi-tenant (garage B ne voit/altère
 * jamais les transmissions du garage A).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-einvoice.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

let prisma: any
let store: typeof import('@/lib/einvoicing/store')
let garageA: string
let garageB: string
let invoiceA: string

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` }, stdio: 'ignore' })
  ;({ prisma } = await import('@/lib/db'))
  store = await import('@/lib/einvoicing/store')

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a', siret: '73282932000074' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id
  invoiceA = (await prisma.invoice.create({
    data: { number: 'FAC-2026-100', garageId: garageA, clientName: 'Client A', issueDate: '2026-05-01', taxRate: 20 },
  })).id
}, 30_000)

afterAll(() => { try { fs.rmSync(DB_PATH) } catch { /* ignore */ } })

const baseInput = () => ({
  invoiceId: invoiceA, garageId: garageA, idempotencyKey: 'FAC-2026-100:CII',
  format: 'CII' as const, xml: '<rsm:CrossIndustryInvoice/>', status: 'SUBMITTED' as const,
})

describe('persistSubmission — création & idempotence', () => {
  it('crée une transmission avec empreinte SHA-256 et un événement', async () => {
    const { submission, created } = await store.persistSubmission(baseInput())
    expect(created).toBe(true)
    expect(submission.documentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(submission.status).toBe('SUBMITTED')
    expect(submission.events).toHaveLength(1)
    expect(submission.events[0].type).toBe('submit')
  })
  it('est idempotent (même clé → même transmission, pas de doublon)', async () => {
    const first = await store.persistSubmission(baseInput())
    const second = await store.persistSubmission(baseInput())
    expect(second.created).toBe(false)
    expect(second.submission.id).toBe(first.submission.id)
    const all = await store.listSubmissionsByInvoice(garageA, invoiceA)
    expect(all).toHaveLength(1)
  })
})

describe('recordStatusEvent — cycle de vie & isolation', () => {
  it('met à jour le statut et ajoute des événements', async () => {
    const { submission } = await store.persistSubmission(baseInput())
    const r1 = await store.recordStatusEvent(garageA, submission.id, 'RECEIVED')
    expect(r1?.status).toBe('RECEIVED')
    const r2 = await store.recordStatusEvent(garageA, submission.id, 'ACCEPTED')
    expect(r2?.status).toBe('ACCEPTED')
    expect(r2?.acceptedAt).toBeTruthy()
    expect(r2!.events.length).toBeGreaterThanOrEqual(3) // submit + received + accepted
  })
  it('REFUSE une mise à jour depuis un autre garage (isolation)', async () => {
    const { submission } = await store.persistSubmission(baseInput())
    const cross = await store.recordStatusEvent(garageB, submission.id, 'ACCEPTED')
    expect(cross).toBeNull()
  })
})

describe('isolation multi-tenant des lectures', () => {
  it('garage B ne voit pas les transmissions du garage A', async () => {
    await store.persistSubmission(baseInput())
    const { submission } = await store.persistSubmission(baseInput())
    expect(await store.listSubmissionsByInvoice(garageB, invoiceA)).toHaveLength(0)
    expect(await store.getSubmission(garageB, submission.id)).toBeNull()
    expect(await store.getSubmission(garageA, submission.id)).not.toBeNull()
  })
})
