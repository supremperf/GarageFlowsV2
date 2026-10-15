/**
 * INTÉGRATION POSTGRESQL RÉELLE — appareils par licence.
 *
 * AUCUN mock : ce test crée une base PostgreSQL NEUVE, applique les VRAIES
 * migrations (prisma migrate deploy --schema prisma/server/schema.prisma),
 * puis exerce le service d'appareils via le client serveur généré.
 *
 * Preuves apportées (critères bloquants de la mission) :
 *  - une base vide s'initialise uniquement avec les migrations ;
 *  - le plafond seats est appliqué ATOMIQUEMENT : activations concurrentes
 *    (Promise.all) de HWID distincts → jamais plus de `seats` appareils actifs ;
 *  - réactivation même HWID = rotation (pas de siège supplémentaire) ;
 *  - révocation d'un appareil → jeton refusé immédiatement + siège libéré ;
 *  - licence révoquée/expirée → tous ses jetons refusés immédiatement ;
 *  - reset admin → la machine peut se réactiver.
 *
 * Prérequis : TEST_POSTGRES_URL (URL PostgreSQL d'un rôle autorisé à créer la
 * base cible, ex. postgresql://garageflow:garageflow_test@127.0.0.1:5432/postgres).
 * Sans cette variable la suite est ignorée — la CI la fournit via un service.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import path from 'path'

const ADMIN_URL = process.env.TEST_POSTGRES_URL

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

// Base neuve, nom unique par exécution.
const DB_NAME = `gf_it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`

function withDb(adminUrl: string, db: string): string {
  const u = new URL(adminUrl)
  u.pathname = `/${db}`
  return u.toString()
}

type Devices = typeof import('@/lib/license/devices')
type Db = typeof import('@/lib/db')

let devices: Devices
let db: Db
let TEST_URL = ''

const HW = (c: string) => c.repeat(64)

async function createLicense(licenseId: string, seats: number, opts: { status?: string; expiryAt?: Date } = {}) {
  await db.prisma.licenseKey.create({
    data: {
      licenseId,
      token:       `GF2.it.${licenseId}`,
      customerId:  'it-customer',
      licenseType: 'premium',
      expiryAt:    opts.expiryAt ?? new Date(Date.now() + 30 * 24 * 3600 * 1000),
      status:      opts.status ?? 'active',
      seats,
    },
  })
}

describe.skipIf(!ADMIN_URL)('appareils par licence — PostgreSQL réel (migrations + concurrence)', () => {
  beforeAll(async () => {
    TEST_URL = withDb(ADMIN_URL as string, DB_NAME)

    // ── Base VIDE + VRAIES migrations (prisma migrate deploy crée la base) ────
    const root = path.resolve(__dirname, '../../..')
    // Entrée JS de la CLI lancée par le Node courant, jamais le lanceur de
    // node_modules/.bin : sous Windows c'est un script sans extension que
    // `execFileSync` ne sait pas exécuter (ENOENT), et sa variante `.cmd`
    // imposerait `shell: true`. Portable, sans shell.
    const prismaCli = require.resolve('prisma/build/index.js')
    const out = execFileSync(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/server/schema.prisma'],
      { cwd: root, env: { ...process.env, DATABASE_URL: TEST_URL, DIRECT_URL: TEST_URL } },
    ).toString()
    expect(out).toMatch(/migrations? (have|has) been successfully applied|No pending migrations/i)

    // Le singleton db.ts choisit le client serveur (URL postgres) à l'import.
    process.env.DATABASE_URL = TEST_URL
    db = await import('@/lib/db')
    expect(db.isPostgresDatabase()).toBe(true)
    devices = await import('@/lib/license/devices')
  }, 60_000)

  afterAll(async () => {
    await db?.prisma.$disconnect()
  })

  it('la base neuve est utilisable sans AUCUNE modification manuelle', async () => {
    const count = await db.prisma.licenseDevice.count()
    expect(count).toBe(0)
  })

  it('activation du premier appareil → deviceToken retourné, haché en base', async () => {
    await createLicense('lic-first', 1)
    const r = await devices.activateDevice({ licenseId: 'lic-first', seats: 1, hwid: HW('a') })
    expect(r.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(r.rotated).toBe(false)

    const row = await db.prisma.licenseDevice.findUnique({ where: { deviceId: r.deviceId } })
    expect(row).toBeTruthy()
    expect(row!.tokenHash).not.toBe(r.deviceToken)     // jamais en clair
    expect(row!.hwidHash).not.toBe(HW('a'))            // HWID haché
    expect(row!.status).toBe('active')
  })

  it('réactivation même HWID → rotation du jeton, toujours UN SEUL appareil', async () => {
    await createLicense('lic-rotate', 1)
    const r1 = await devices.activateDevice({ licenseId: 'lic-rotate', seats: 1, hwid: HW('b') })
    const r2 = await devices.activateDevice({ licenseId: 'lic-rotate', seats: 1, hwid: HW('b') })
    expect(r2.rotated).toBe(true)
    expect(r2.deviceToken).not.toBe(r1.deviceToken)
    expect(await db.prisma.licenseDevice.count({ where: { licenseId: 'lic-rotate' } })).toBe(1)
    // L'ancien jeton est invalidé par la rotation.
    expect((await devices.validateDeviceToken(r1.deviceToken)).ok).toBe(false)
    expect((await devices.validateDeviceToken(r2.deviceToken)).ok).toBe(true)
  })

  it('CONCURRENCE seats=1 : 8 activations simultanées de HWID distincts → EXACTEMENT 1 admise', async () => {
    await createLicense('lic-conc-1', 1)
    const hwids = ['0', '1', '2', '3', '4', '5', '6', '7'].map((c) => HW(c))
    const results = await Promise.allSettled(
      hwids.map((hwid) => devices.activateDevice({ licenseId: 'lic-conc-1', seats: 1, hwid })),
    )
    const ok = results.filter((r) => r.status === 'fulfilled')
    const limited = results.filter(
      (r) => r.status === 'rejected' && (r.reason as Error).name === 'DeviceLimitError',
    )
    expect(ok).toHaveLength(1)
    expect(limited).toHaveLength(7)
    // La base ne contient JAMAIS plus d'appareils actifs que la limite.
    expect(
      await db.prisma.licenseDevice.count({ where: { licenseId: 'lic-conc-1', status: 'active' } }),
    ).toBe(1)
  })

  it('CONCURRENCE seats=2 : 10 activations simultanées → EXACTEMENT 2 admises', async () => {
    await createLicense('lic-conc-2', 2)
    const hwids = Array.from({ length: 10 }, (_, i) => HW(i.toString(16)))
    const results = await Promise.allSettled(
      hwids.map((hwid) => devices.activateDevice({ licenseId: 'lic-conc-2', seats: 2, hwid })),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
    expect(
      await db.prisma.licenseDevice.count({ where: { licenseId: 'lic-conc-2', status: 'active' } }),
    ).toBe(2)
  })

  it('CONCURRENCE même HWID : 6 activations simultanées → un seul appareil, jetons tournés', async () => {
    await createLicense('lic-conc-same', 1)
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        devices.activateDevice({ licenseId: 'lic-conc-same', seats: 1, hwid: HW('e') }),
      ),
    )
    // Toutes réussissent (même machine = jamais un refus de siège)…
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    // …mais UNE SEULE ligne existe.
    expect(await db.prisma.licenseDevice.count({ where: { licenseId: 'lic-conc-same' } })).toBe(1)
  })

  it('refus au-delà du plafond, puis révocation d\'un appareil → le siège se libère', async () => {
    await createLicense('lic-revoke', 1)
    const first = await devices.activateDevice({ licenseId: 'lic-revoke', seats: 1, hwid: HW('a') })
    await expect(
      devices.activateDevice({ licenseId: 'lic-revoke', seats: 1, hwid: HW('b') }),
    ).rejects.toThrow(/appareils/)

    // Révocation administrative du premier appareil.
    expect(await devices.revokeDevice(first.deviceId, 'test')).toBe(true)
    // Son jeton est refusé immédiatement.
    const v = await devices.validateDeviceToken(first.deviceToken)
    expect(v).toEqual({ ok: false, code: 'device_revoked' })
    // Un NOUVEL appareil peut s'activer (siège libéré).
    const second = await devices.activateDevice({ licenseId: 'lic-revoke', seats: 1, hwid: HW('b') })
    expect((await devices.validateDeviceToken(second.deviceToken)).ok).toBe(true)
    // La machine révoquée ne peut PAS se réactiver seule…
    await expect(
      devices.activateDevice({ licenseId: 'lic-revoke', seats: 1, hwid: HW('a') }),
    ).rejects.toThrow(/révoqué/)
  })

  it('reset admin → la machine révoquée peut se réactiver (si un siège est libre)', async () => {
    await createLicense('lic-reset', 2)
    const d = await devices.activateDevice({ licenseId: 'lic-reset', seats: 2, hwid: HW('c') })
    await devices.revokeDevice(d.deviceId)
    expect(await devices.resetDevice(d.deviceId)).toBe(true)
    const again = await devices.activateDevice({ licenseId: 'lic-reset', seats: 2, hwid: HW('c') })
    expect((await devices.validateDeviceToken(again.deviceToken)).ok).toBe(true)
  })

  it('licence RÉVOQUÉE → tous ses jetons d\'appareil refusés immédiatement', async () => {
    await createLicense('lic-kill', 2)
    const d1 = await devices.activateDevice({ licenseId: 'lic-kill', seats: 2, hwid: HW('d') })
    const d2 = await devices.activateDevice({ licenseId: 'lic-kill', seats: 2, hwid: HW('f') })
    expect((await devices.validateDeviceToken(d1.deviceToken)).ok).toBe(true)

    await db.prisma.licenseKey.update({ where: { licenseId: 'lic-kill' }, data: { status: 'revoked' } })

    expect(await devices.validateDeviceToken(d1.deviceToken)).toEqual({ ok: false, code: 'license_revoked' })
    expect(await devices.validateDeviceToken(d2.deviceToken)).toEqual({ ok: false, code: 'license_revoked' })
  })

  it('licence EXPIRÉE → jetons refusés', async () => {
    await createLicense('lic-exp', 1, { expiryAt: new Date(Date.now() + 60_000) })
    const d = await devices.activateDevice({ licenseId: 'lic-exp', seats: 1, hwid: HW('9') })
    await db.prisma.licenseKey.update({
      where: { licenseId: 'lic-exp' },
      data:  { expiryAt: new Date(Date.now() - 1000) },
    })
    expect(await devices.validateDeviceToken(d.deviceToken)).toEqual({ ok: false, code: 'license_expired' })
  })

  it('auto-désactivation (deactivateByToken) libère le siège', async () => {
    await createLicense('lic-deact', 1)
    const d = await devices.activateDevice({ licenseId: 'lic-deact', seats: 1, hwid: HW('a') })
    expect(await devices.deactivateByToken(d.deviceToken)).toBe(true)
    expect((await devices.validateDeviceToken(d.deviceToken)).ok).toBe(false)
    // Un autre appareil prend le siège.
    const other = await devices.activateDevice({ licenseId: 'lic-deact', seats: 1, hwid: HW('b') })
    expect((await devices.validateDeviceToken(other.deviceToken)).ok).toBe(true)
  })

  it('jeton inconnu / HWID d\'une autre machine → refus typés', async () => {
    await createLicense('lic-misc', 1)
    const d = await devices.activateDevice({ licenseId: 'lic-misc', seats: 1, hwid: HW('a') })
    expect(await devices.validateDeviceToken(devices.generateDeviceToken())).toEqual({
      ok: false, code: 'device_unknown',
    })
    expect(await devices.validateDeviceToken(d.deviceToken, { hwid: HW('b') })).toEqual({
      ok: false, code: 'device_hwid_mismatch',
    })
    expect((await devices.validateDeviceToken(d.deviceToken, { hwid: HW('a') })).ok).toBe(true)
  })

  it('fonctionnement après « redémarrage » (nouveau client Prisma, mêmes données)', async () => {
    await createLicense('lic-restart', 1)
    const d = await devices.activateDevice({ licenseId: 'lic-restart', seats: 1, hwid: HW('c') })

    // Nouveau client indépendant sur la même base = nouvelle instance serveur.
    const { PrismaClient } = await import('@/generated/server-client')
    const fresh = new PrismaClient({ datasourceUrl: TEST_URL })
    try {
      const row = await fresh.licenseDevice.findUnique({ where: { deviceId: d.deviceId } })
      expect(row?.status).toBe('active')
      const active = await fresh.licenseDevice.count({
        where: { licenseId: 'lic-restart', status: 'active' },
      })
      expect(active).toBe(1)
    } finally {
      await fresh.$disconnect()
    }
    // Le jeton délivré avant « redémarrage » reste valide.
    expect((await devices.validateDeviceToken(d.deviceToken)).ok).toBe(true)
  })
})
