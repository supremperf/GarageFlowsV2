/**
 * Portail client — lien tokenisé /api/portal/[token] (AUD-022, isolation).
 *
 * Le portail expose 20 routes sans test de handler. On couvre ici le handler le
 * plus sensible côté sécurité — l'accès public par jeton de capability (JWT
 * signé) — et on prouve son cloisonnement : le jeton porte jobId ET garageId, et
 * la requête est scopée aux deux. Un jeton « deputy confus » (jobId d'un autre
 * garage, garageId de l'attaquant) ne peut atteindre la ressource étrangère.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { SignJWT } from 'jose'

const DB_PATH = path.resolve(__dirname, '../../.tmp-portal-token.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'portal-secret-fort-de-test-0123456789abcd'

let prisma: any
let GET: (req: Request, ctx: { params: { token: string } }) => Promise<Response>
const ids = { gA: '', gB: '', jobA: '', jobB: '' }

async function mintToken(claims: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode(process.env.GF_PORTAL_SECRET)
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('48h').sign(secret)
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET } = (await import('@/app/api/portal/[token]/route')) as any)

  const gA = await prisma.garage.create({ data: { name: 'A', slug: 'a' } })
  const gB = await prisma.garage.create({ data: { name: 'B', slug: 'b' } })
  const mA = await prisma.mechanic.create({ data: { name: 'MA', avatar: '', color: '#000', garageId: gA.id } })
  const mB = await prisma.mechanic.create({ data: { name: 'MB', avatar: '', color: '#000', garageId: gB.id } })
  const jA = await prisma.job.create({ data: { customerName: 'CA', vehicleModel: 'V', repairType: 'R', estimatedDuration: 60, startTime: '09:00', date: '2026-08-07', mechanicId: mA.id, garageId: gA.id } })
  const jB = await prisma.job.create({ data: { customerName: 'CB', vehicleModel: 'V', repairType: 'R', estimatedDuration: 60, startTime: '09:00', date: '2026-08-07', mechanicId: mB.id, garageId: gB.id } })
  ids.gA = gA.id; ids.gB = gB.id; ids.jobA = jA.id; ids.jobB = jB.id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

const call = async (token: string) => GET(new Request('http://localhost/api/portal/x'), { params: { token } })

describe('portal/[token] — accès légitime', () => {
  it('jeton valide (jobId+garageId de A) → 200 sur le job de A', async () => {
    const token = await mintToken({ typ: 'portal', jobId: ids.jobA, garageId: ids.gA })
    const res = await call(token)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.customerName ?? body.job?.customerName ?? JSON.stringify(body)).toContain('CA')
  })
})

describe('portal/[token] — cloisonnement (deputy confus)', () => {
  it('jeton {jobId de B, garageId de A} → 404 (le scope garageId empêche l\'accès croisé)', async () => {
    const token = await mintToken({ typ: 'portal', jobId: ids.jobB, garageId: ids.gA })
    expect((await call(token)).status).toBe(404)
  })
  it('jeton de mauvais type → 403', async () => {
    const token = await mintToken({ typ: 'mechanic', jobId: ids.jobA, garageId: ids.gA })
    expect((await call(token)).status).toBe(403)
  })
  it('jeton signé avec un autre secret → rejeté (403/erreur, jamais 200)', async () => {
    const bad = await new SignJWT({ typ: 'portal', jobId: ids.jobA, garageId: ids.gA })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('48h')
      .sign(new TextEncoder().encode('un-autre-secret-totalement-different-xyz'))
    expect((await call(bad)).status).not.toBe(200)
  })
  it('jeton illisible → rejeté (jamais 200)', async () => {
    expect((await call('pas-un-jwt')).status).not.toBe(200)
  })
})
