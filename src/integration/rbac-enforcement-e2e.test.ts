/**
 * RBAC — enforcement PAR LES VRAIS HANDLERS (V15, lot 18/108).
 *
 * `authz-full-matrix.test.ts` prouve la logique `can()` (128 cellules) ; ce test
 * prouve que les ROUTES l'APPLIQUENT réellement de bout en bout : un compte
 * staff de faible privilège (RECEPTIONIST) est refusé (403) par les handlers sur
 * les actions réservées, un OWNER réussit. La restriction est serveur-side —
 * jamais « bouton caché ».
 *
 * Rappel d'architecture : MECHANIC n'est pas un rôle NextAuth (il vit dans la
 * session de licence `gf_session`, routes `/api/mechanic/*` dédiées) ; les
 * routes staff passent par `requireSession()` (OWNER/MANAGER/RECEPTIONIST).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-rbac-e2e.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return {
    ...actual,
    withAuth: (fn: unknown) => fn,
    requireSession: async () => h.session,
    isAdminSession: async () => (h.session as { user?: { role?: string } })?.user?.role === 'OWNER',
  }
})

let prisma: any
const api: Record<string, any> = {}
const ids = { garageId: '', ownerId: '', receptionistId: '' }

const req = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method, headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const asOwner = () => { h.session = { user: { id: ids.ownerId, role: 'OWNER', garageId: ids.garageId } } }
const asReceptionist = () => { h.session = { user: { id: ids.receptionistId, role: 'RECEPTIONIST', garageId: ids.garageId } } }

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  api.users = await import('@/app/api/users/route')
  api.garages = await import('@/app/api/garages/route')
  api.mechLicenses = await import('@/app/api/mechanic-licenses/route')

  const g = await prisma.garage.create({ data: { name: 'RBAC', slug: 'rbac-e2e', email: 'c@rbac.fr' } })
  ids.garageId = g.id
  const owner = await prisma.user.create({ data: { email: 'owner@rbac.fr', password: 'x', name: 'O', role: 'OWNER', garageId: g.id } })
  const recep = await prisma.user.create({ data: { email: 'recep@rbac.fr', password: 'x', name: 'R', role: 'RECEPTIONIST', garageId: g.id } })
  ids.ownerId = owner.id; ids.receptionistId = recep.id
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('RBAC — un RECEPTIONIST est REFUSÉ par les handlers sur les actions OWNER/gérant', () => {
  it('users POST (créer un compte, potentiellement admin) → 403', async () => {
    asReceptionist()
    const res = await api.users.POST(req('POST', '/api/users', { name: 'X', email: 'x@rbac.fr', password: 'secret12', role: 'OWNER' }))
    expect(res.status).toBe(403)
    // Aucune création : la base ne contient toujours que owner + receptionist.
    expect(await prisma.user.count({ where: { garageId: ids.garageId } })).toBe(2)
  })

  it('garages PATCH (modifier les paramètres du garage) → 403', async () => {
    asReceptionist()
    const res = await api.garages.PATCH(req('PATCH', '/api/garages', { name: 'Renommé par receptionniste' }))
    expect(res.status).toBe(403)
    expect((await prisma.garage.findUnique({ where: { id: ids.garageId } })).name).toBe('RBAC')
  })

  it('mechanic-licenses register (gérer les licences mécanicien) → 403', async () => {
    asReceptionist()
    const res = await api.mechLicenses.POST(req('POST', '/api/mechanic-licenses', { token: 'GF2.whatever' }))
    expect(res.status).toBe(403)
  })
})

describe('RBAC — un OWNER est AUTORISÉ sur les mêmes actions', () => {
  it('users POST → succès + persistance', async () => {
    asOwner()
    const res = await api.users.POST(req('POST', '/api/users', { name: 'Nouveau', email: 'new@rbac.fr', password: 'secret12', role: 'RECEPTIONIST' }))
    expect(res.status).toBeLessThan(300)
    expect(await prisma.user.count({ where: { garageId: ids.garageId } })).toBe(3)
  })

  it('garages PATCH → succès + persistance', async () => {
    asOwner()
    const res = await api.garages.PATCH(req('PATCH', '/api/garages', { name: 'Renommé par OWNER' }))
    expect(res.status).toBeLessThan(300)
    expect((await prisma.garage.findUnique({ where: { id: ids.garageId } })).name).toBe('Renommé par OWNER')
  })
})
