/**
 * Contrôle d'accès aux données financières du copilote — correction V15 (P2).
 *
 * Les rapports d'analyse (CA, marge, prévisions) et les intentions financières
 * du copilote conversationnel étaient accessibles à TOUT rôle authentifié
 * (requireSession seul). Après correctif, ils exigent `financial:read`
 * (OWNER/MANAGER), comme l'export FEC — RECEPTIONIST/MECHANIC sont refusés.
 * Les intentions OPÉRATIONNELLES (mécaniciens disponibles…) restent ouvertes.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-copilot-authz-v15.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})

let prisma: any
let reportGET: (req: Request) => Promise<Response>
let copilotPOST: (req: Request) => Promise<Response>
const ctx = { garageId: '' }

const asRole = (role: string) => { h.session = { user: { id: 'u', role, garageId: ctx.garageId, name: 'X', email: 'x@x' } } }
const jreq = (method: string, url: string, body?: unknown) =>
  new Request(url, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET: reportGET } = (await import('@/app/api/copilot/report/route')) as any)
  ;({ POST: copilotPOST } = (await import('@/app/api/copilot/route')) as any)

  const g = await prisma.garage.create({ data: { name: 'CP', slug: 'copilot-authz-v15' } })
  ctx.garageId = g.id
  await prisma.mechanic.create({ data: { name: 'Léa', avatar: '', color: '#000', garageId: g.id } })
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('Copilote — rapport financier (V15 P2)', () => {
  it('RECEPTIONIST → 403 (pas de financial:read)', async () => {
    asRole('RECEPTIONIST')
    const res = await reportGET(jreq('GET', 'http://localhost/api/copilot/report?period=30'))
    expect(res.status).toBe(403)
  })
  it('MECHANIC → 403', async () => {
    asRole('MECHANIC')
    const res = await reportGET(jreq('GET', 'http://localhost/api/copilot/report?period=30'))
    expect(res.status).toBe(403)
  })
  it('OWNER → 200 (accès financier légitime)', async () => {
    asRole('OWNER')
    const res = await reportGET(jreq('GET', 'http://localhost/api/copilot/report?period=30'))
    expect(res.status).toBe(200)
  })
})

describe('Copilote conversationnel — gate par résolveur (V15 P2)', () => {
  it('intention FINANCIÈRE (marge) par RECEPTIONIST → 403', async () => {
    asRole('RECEPTIONIST')
    const res = await copilotPOST(jreq('POST', 'http://localhost/api/copilot', { query: 'Quelle est la marge du mois ?' }))
    expect(res.status).toBe(403)
  })
  it('intention OPÉRATIONNELLE (mécaniciens disponibles) par RECEPTIONIST → autorisée', async () => {
    asRole('RECEPTIONIST')
    const res = await copilotPOST(jreq('POST', 'http://localhost/api/copilot', { query: 'Qui est disponible ?' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    // Le résolveur non financier s'exécute normalement pour un rôle sans financial:read.
    expect(body.error).toBeUndefined()
  })
  it('intention FINANCIÈRE (marge) par OWNER → autorisée', async () => {
    asRole('OWNER')
    const res = await copilotPOST(jreq('POST', 'http://localhost/api/copilot', { query: 'Quelle est la marge du mois ?' }))
    expect(res.status).toBe(200)
  })
})
