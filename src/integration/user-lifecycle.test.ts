/**
 * Récupération de compte + cycle de vie employé — test d'intégration SQLite.
 * Prouve, sur une vraie base : réinitialisation de mot de passe (usage unique +
 * révocation de session), invitation/acceptation, suspension/réactivation,
 * changement de rôle, transfert de propriété, protection du dernier
 * propriétaire, et ISOLATION multi-tenant (un propriétaire ne touche jamais un
 * compte d'un autre garage).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-userlc.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

let prisma: any
let svc: typeof import('@/lib/users/service')
let garageA: string
let garageB: string

async function mkUser(garageId: string, role: string, status = 'active', email?: string) {
  const e = email ?? `${role.toLowerCase()}-${Math.round(Math.random() * 1e9)}@a.test`
  return prisma.user.create({
    data: { name: role, email: e, password: await bcrypt.hash('initial-pw', 10), role, status, garageId },
  })
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  svc = await import('@/lib/users/service')
  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id
}, 40_000)

afterAll(() => { try { fs.rmSync(DB_PATH) } catch { /* ignore */ } })

describe('réinitialisation de mot de passe', () => {
  it('émet un jeton, le consomme une seule fois, révoque les sessions', async () => {
    const u = await mkUser(garageA, 'OWNER', 'active', 'reset@a.test')
    const before = await prisma.user.findUnique({ where: { id: u.id } })

    const issued = await svc.issuePasswordReset('reset@a.test')
    expect(issued).not.toBeNull()

    const res = await svc.confirmPasswordReset(issued!.token, 'nouveau-mdp-1')
    expect(res.ok).toBe(true)

    const after = await prisma.user.findUnique({ where: { id: u.id } })
    expect(await bcrypt.compare('nouveau-mdp-1', after.password)).toBe(true)
    // sessionEpoch incrémenté → JWT antérieurs révoqués.
    expect(after.sessionEpoch).toBe(before.sessionEpoch + 1)

    // Usage unique : rejeu refusé.
    const replay = await svc.confirmPasswordReset(issued!.token, 'autre-mdp-2')
    expect(replay.ok).toBe(false)
  })

  it("ne révèle pas l'existence d'un compte inconnu", async () => {
    expect(await svc.issuePasswordReset('inconnu@a.test')).toBeNull()
  })

  it('refuse un jeton expiré', async () => {
    const u = await mkUser(garageA, 'RECEPTIONIST', 'active', 'exp@a.test')
    const past = new Date(Date.now() - 60_000)
    const issued = await svc.issuePasswordReset('exp@a.test', past) // expire ~ 1h avant maintenant + ... en fait TTL depuis past
    // Force l'expiration en réécrivant expiresAt dans le passé.
    await prisma.authToken.updateMany({ where: { userId: u.id }, data: { expiresAt: past } })
    const res = await svc.confirmPasswordReset(issued!.token, 'zzzzzzzz')
    expect(res.ok).toBe(false)
  })
})

describe('invitation employé', () => {
  it('crée un compte invité puis l\'active à l\'acceptation', async () => {
    const owner = await mkUser(garageA, 'OWNER', 'active', 'owner-inv@a.test')
    const actor = { id: owner.id, role: 'OWNER', garageId: garageA }
    const inv = await svc.inviteEmployee(actor, { name: 'Nouveau', email: 'new@a.test', role: 'MECHANIC' })
    expect(inv.ok).toBe(true)

    const created = await prisma.user.findUnique({ where: { email: 'new@a.test' } })
    expect(created.status).toBe('invited')
    expect(created.garageId).toBe(garageA)

    const accepted = await svc.acceptInvite((inv as any).token, 'mon-mot-de-passe')
    expect(accepted.ok).toBe(true)
    const active = await prisma.user.findUnique({ where: { email: 'new@a.test' } })
    expect(active.status).toBe('active')
    expect(active.emailVerified).toBe(true)
    expect(await bcrypt.compare('mon-mot-de-passe', active.password)).toBe(true)
  })

  it('refuse une invitation par un non-propriétaire', async () => {
    const mgr = await mkUser(garageA, 'MANAGER', 'active')
    const res = await svc.inviteEmployee({ id: mgr.id, role: 'MANAGER', garageId: garageA }, { name: 'X', email: 'x@a.test', role: 'RECEPTIONIST' })
    expect(res.ok).toBe(false)
  })
})

describe('suspension / réactivation / rôle', () => {
  it('suspend un employé et révoque ses sessions', async () => {
    const owner = await mkUser(garageA, 'OWNER', 'active', 'owner-susp@a.test')
    const emp = await mkUser(garageA, 'RECEPTIONIST', 'active')
    const before = emp.sessionEpoch
    const res = await svc.suspendEmployee({ id: owner.id, role: 'OWNER', garageId: garageA }, emp.id)
    expect(res.ok).toBe(true)
    const after = await prisma.user.findUnique({ where: { id: emp.id } })
    expect(after.status).toBe('suspended')
    expect(after.sessionEpoch).toBe(before + 1)

    const re = await svc.reactivateEmployee({ id: owner.id, role: 'OWNER', garageId: garageA }, emp.id)
    expect(re.ok).toBe(true)
    expect((await prisma.user.findUnique({ where: { id: emp.id } })).status).toBe('active')
  })

  it('protège le dernier propriétaire (rétrogradation refusée)', async () => {
    const soleOwner = await mkUser(garageB, 'OWNER', 'active', 'sole@b.test')
    const res = await svc.changeRole({ id: soleOwner.id, role: 'OWNER', garageId: garageB }, soleOwner.id, 'MANAGER')
    expect(res.ok).toBe(false)
  })

  it('révoque les sessions (incrémente sessionEpoch)', async () => {
    const owner = await mkUser(garageA, 'OWNER', 'active', 'owner-rev@a.test')
    const emp = await mkUser(garageA, 'MECHANIC', 'active')
    const res = await svc.revokeSessions({ id: owner.id, role: 'OWNER', garageId: garageA }, emp.id)
    expect(res.ok).toBe(true)
    expect((await prisma.user.findUnique({ where: { id: emp.id } })).sessionEpoch).toBe(emp.sessionEpoch + 1)
  })
})

describe('transfert de propriété', () => {
  it('promeut la cible en OWNER et rétrograde l\'acteur en MANAGER', async () => {
    const owner = await mkUser(garageA, 'OWNER', 'active', 'owner-tr@a.test')
    const heir = await mkUser(garageA, 'RECEPTIONIST', 'active', 'heir@a.test')
    const res = await svc.transferOwnership({ id: owner.id, role: 'OWNER', garageId: garageA }, heir.id)
    expect(res.ok).toBe(true)
    expect((await prisma.user.findUnique({ where: { id: heir.id } })).role).toBe('OWNER')
    expect((await prisma.user.findUnique({ where: { id: owner.id } })).role).toBe('MANAGER')
  })
})

describe('ISOLATION multi-tenant', () => {
  it('un propriétaire du garage A ne peut pas suspendre un compte du garage B', async () => {
    const ownerA = await mkUser(garageA, 'OWNER', 'active', 'iso-a@a.test')
    const empB = await mkUser(garageB, 'RECEPTIONIST', 'active', 'iso-b@b.test')
    const res = await svc.suspendEmployee({ id: ownerA.id, role: 'OWNER', garageId: garageA }, empB.id)
    expect(res.ok).toBe(false)
    expect((res as { error?: string }).error).toBe('Employé introuvable')
    // Le compte B reste intact.
    expect((await prisma.user.findUnique({ where: { id: empB.id } })).status).toBe('active')
  })
})
