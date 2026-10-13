/**
 * INTÉGRATION POSTGRESQL RÉELLE — session licenciée de bout en bout.
 *
 * AUCUN mock : base PostgreSQL neuve, migrations réelles, vrai client Prisma.
 * Prouve les critères de sécurité de la mission sur une vraie base :
 *  - une installation PWA (install id) consomme un siège comme un appareil ;
 *  - la session licenciée est validée en base (licence + garage + appareil) ;
 *  - rattachement licence↔garage au 1er usage, puis usage inter-garages REFUSÉ ;
 *  - révocation d'appareil → session invalidée immédiatement ;
 *  - licence expirée → refusée ;
 *  - concurrence : seats=1, N activations PWA simultanées → EXACTEMENT 1 siège.
 *
 * Prérequis : TEST_POSTGRES_URL (rôle autorisé à créer la base). Sinon ignoré.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import path from 'path'
import { SignJWT } from 'jose'

const ADMIN_URL = process.env.TEST_POSTGRES_URL
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

const DB_NAME = `gf_sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`

function withDb(adminUrl: string, db: string): string {
  const u = new URL(adminUrl); u.pathname = `/${db}`; return u.toString()
}

type Devices = typeof import('@/lib/license/devices')
type Session = typeof import('@/lib/license/session')
type Db = typeof import('@/lib/db')

let devices: Devices
let sessionMod: Session
let db: Db
let TEST_URL = ''

async function gfSession(lid: string, did?: string): Promise<string> {
  return new SignJWT({ typ: 'premium', lid, ...(did ? { did } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d')
    .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET))
}

let garageSeq = 0
async function makeGarage(): Promise<string> {
  garageSeq += 1
  const g = await db.prisma.garage.create({
    data: { name: `Garage ${garageSeq}`, slug: `garage-${DB_NAME}-${garageSeq}` },
  })
  return g.id
}

async function makeLicense(licenseId: string, seats: number, opts: { garageId?: string | null; status?: string; expiryAt?: Date } = {}) {
  await db.prisma.licenseKey.create({
    data: {
      licenseId, token: `GF2.sess.${licenseId}`, customerId: 'it', licenseType: 'premium',
      expiryAt: opts.expiryAt ?? new Date(Date.now() + 30 * 864e5), status: opts.status ?? 'active',
      seats, garageId: opts.garageId ?? null,
    },
  })
}

describe.skipIf(!ADMIN_URL)('session licenciée — PostgreSQL réel', () => {
  beforeAll(async () => {
    TEST_URL = withDb(ADMIN_URL as string, DB_NAME)
    const root = path.resolve(__dirname, '../../..')
    // On invoque l'ENTRÉE JS de la CLI avec le Node courant, jamais le lanceur
    // de node_modules/.bin : sous Windows celui-ci est un script sans extension
    // (`prisma`, doublé de `prisma.cmd`) que `execFileSync` ne sait pas lancer —
    // ENOENT — et les `.cmd` exigeraient `shell: true`. Cette forme est portable
    // et n'introduit aucun shell.
    const prismaCli = require.resolve('prisma/build/index.js')
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/server/schema.prisma'],
      { cwd: root, env: { ...process.env, DATABASE_URL: TEST_URL, DIRECT_URL: TEST_URL } })
    process.env.DATABASE_URL = TEST_URL
    db = await import('@/lib/db')
    expect(db.isPostgresDatabase()).toBe(true)
    devices = await import('@/lib/license/devices')
    sessionMod = await import('@/lib/license/session')
  }, 60_000)

  afterAll(async () => { await db?.prisma.$disconnect() })

  it('PWA : install id consomme un siège (appareil « pwa »)', async () => {
    const g = await makeGarage()
    await makeLicense('lid-pwa', 1, { garageId: g })
    const act = await devices.activateDevice({ licenseId: 'lid-pwa', seats: 1, installId: 'P'.repeat(43) })
    const row = await db.prisma.licenseDevice.findUnique({ where: { deviceId: act.deviceId } })
    expect(row?.platform).toBe('pwa')
    expect(await db.prisma.licenseDevice.count({ where: { licenseId: 'lid-pwa', status: 'active' } })).toBe(1)
  })

  it('session valide (licence + appareil PWA + garage) → ok, rattachement au 1er usage', async () => {
    const g = await makeGarage()
    await makeLicense('lid-ok', 1, { garageId: null })
    const act = await devices.activateDevice({ licenseId: 'lid-ok', seats: 1, installId: 'Q'.repeat(43) })
    const raw = await gfSession('lid-ok', act.deviceId)
    const res = await sessionMod.validateLicensedSession({ rawGfSession: raw, garageId: g })
    expect(res.ok).toBe(true)
    // La licence est désormais rattachée au garage g.
    const lic = await db.prisma.licenseKey.findUnique({ where: { licenseId: 'lid-ok' } })
    expect(lic?.garageId).toBe(g)
  })

  it('usage inter-garages REFUSÉ (licence rattachée à un autre garage)', async () => {
    const gA = await makeGarage()
    const gB = await makeGarage()
    await makeLicense('lid-cross', 1, { garageId: null })
    const act = await devices.activateDevice({ licenseId: 'lid-cross', seats: 1, installId: 'R'.repeat(43) })
    const raw = await gfSession('lid-cross', act.deviceId)
    // gA se rattache…
    expect((await sessionMod.validateLicensedSession({ rawGfSession: raw, garageId: gA })).ok).toBe(true)
    // …gB tente la même licence → refus.
    const res = await sessionMod.validateLicensedSession({ rawGfSession: raw, garageId: gB })
    expect(res).toMatchObject({ ok: false, code: 'LICENSE_GARAGE_MISMATCH' })
  })

  it('révocation d\'appareil → session invalidée immédiatement', async () => {
    const g = await makeGarage()
    await makeLicense('lid-rev', 1, { garageId: g })
    const act = await devices.activateDevice({ licenseId: 'lid-rev', seats: 1, installId: 'S'.repeat(43) })
    const raw = await gfSession('lid-rev', act.deviceId)
    expect((await sessionMod.validateLicensedSession({ rawGfSession: raw, garageId: g })).ok).toBe(true)
    await devices.revokeDevice(act.deviceId, 'test')
    const res = await sessionMod.validateLicensedSession({ rawGfSession: raw, garageId: g })
    expect(res).toMatchObject({ ok: false, code: 'DEVICE_REVOKED' })
  })

  it('licence expirée → session refusée', async () => {
    const g = await makeGarage()
    await makeLicense('lid-exp', 1, { garageId: g, expiryAt: new Date(Date.now() + 60_000) })
    const act = await devices.activateDevice({ licenseId: 'lid-exp', seats: 1, installId: 'T'.repeat(43) })
    await db.prisma.licenseKey.update({ where: { licenseId: 'lid-exp' }, data: { expiryAt: new Date(Date.now() - 1000) } })
    const raw = await gfSession('lid-exp', act.deviceId)
    const res = await sessionMod.validateLicensedSession({ rawGfSession: raw, garageId: g })
    expect(res).toMatchObject({ ok: false, code: 'LICENSE_EXPIRED' })
  })

  it('CONCURRENCE PWA seats=1 : 6 install ids simultanés → EXACTEMENT 1 siège', async () => {
    await makeLicense('lid-conc', 1, { garageId: null })
    const ids = ['0', '1', '2', '3', '4', '5'].map((c) => c.repeat(43))
    const results = await Promise.allSettled(
      ids.map((installId) => devices.activateDevice({ licenseId: 'lid-conc', seats: 1, installId })),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await db.prisma.licenseDevice.count({ where: { licenseId: 'lid-conc', status: 'active' } })).toBe(1)
  })
})
