/**
 * Prise de contrôle de compte portail — correction V15 (base SQLite réelle).
 *
 * Menace : un attaquant s'inscrit au portail avec l'email d'un CLIENT EXISTANT
 * du garage. Avant correctif, l'inscription liait immédiatement le nouveau
 * compte au Client (register:47 `clientId: client?.id`), sans aucune preuve de
 * possession de l'email → le dashboard exposait véhicules/factures/devis/garanties
 * de la victime.
 *
 * Après correctif :
 *  1. À l'inscription, `clientId` reste NULL même si un Client du même email existe.
 *  2. Le rattachement au Client n'a lieu qu'à la vérification de l'email
 *     (verify-email), seul moment où la possession de l'adresse est prouvée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-portal-takeover-v15.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

let prisma: any
let register: (req: Request) => Promise<Response>
let verifyEmail: (req: Request) => Promise<Response>
const ctx = { garageId: '', victimClientId: '' }
const VICTIM_EMAIL = 'victim@example.com'

const jreq = (url: string, method: string, body?: unknown) =>
  new Request(url, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: register } = (await import('@/app/api/portal/auth/register/route')) as any)
  ;({ GET: verifyEmail } = (await import('@/app/api/portal/auth/verify-email/route')) as any)

  const g = await prisma.garage.create({ data: { name: 'PT', slug: 'portal-takeover-v15' } })
  ctx.garageId = g.id
  const victim = await prisma.client.create({ data: { name: 'Victime', email: VICTIM_EMAIL, garageId: g.id } })
  ctx.victimClientId = victim.id
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('Portail — anti-prise de contrôle de compte (V15 P1)', () => {
  it("l'inscription avec l'email d'un client existant NE lie PAS le compte au Client", async () => {
    const res = await register(jreq('http://localhost/api/portal/auth/register', 'POST', {
      email: VICTIM_EMAIL, password: 'attacker-password', name: 'Attaquant',
    }))
    expect(res.status).toBe(201)

    // Invariant de sécurité : compte créé mais clientId NULL — aucun accès au
    // dossier de la victime malgré l'email identique.
    const account = await prisma.portalUser.findUnique({ where: { garageId_email: { garageId: ctx.garageId, email: VICTIM_EMAIL } } })
    expect(account).not.toBeNull()
    expect(account.clientId).toBeNull()
    expect(account.emailVerified).toBe(false)
  })

  it('le rattachement au Client n’a lieu qu’APRÈS vérification de l’email (possession prouvée)', async () => {
    const account = await prisma.portalUser.findUnique({ where: { garageId_email: { garageId: ctx.garageId, email: VICTIM_EMAIL } } })
    expect(account.clientId).toBeNull() // toujours non lié avant la vérif
    const token = account.emailVerifyToken
    expect(typeof token).toBe('string')

    const res = await verifyEmail(new NextRequest(`http://localhost/api/portal/auth/verify-email?token=${token}`))
    expect(res.status).toBe(200)

    const linked = await prisma.portalUser.findUnique({ where: { id: account.id } })
    expect(linked.emailVerified).toBe(true)
    expect(linked.emailVerifyToken).toBeNull()
    // Rattachement légitime effectué au moment où la possession de l'email est prouvée.
    expect(linked.clientId).toBe(ctx.victimClientId)
  })
})
