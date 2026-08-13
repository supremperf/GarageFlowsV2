/**
 * GF31-AUD-005 et GF31-AUD-006 — intégrité des enregistrements de licence.
 *
 * Ces tests exercent les VRAIES routes d'administration avec le VRAI module
 * `record-mac` (aucune simulation de la couche cryptographique) : seule la base
 * est simulée. Ce qui est vérifié est donc l'invariant qui compte réellement —
 * « le MAC écrit par la route se re-vérifie sur la ligne telle qu'elle sera
 * relue » — et non le fait qu'une fonction ait été appelée.
 *
 * ─── GF31-AUD-006 ───────────────────────────────────────────────────────────
 * `computeRecordMac` n'ajoute `parentLicenseId` / `mechanicId` au message signé
 * que s'ils sont non nuls (rétrocompatibilité des licences garage). Les deux
 * routes d'administration recalculaient le MAC SANS ces champs. Pour une clé
 * MÉCANICIEN attribuée — donc avec les deux champs renseignés — le MAC stocké
 * portait alors sur un message plus court que celui reconstruit à la lecture par
 * `verifyRecordMac` (qui, lui, reçoit la ligne complète). Résultat : suspendre
 * puis réactiver une clé mécanicien, ou seulement changer son HWID, la rendait
 * définitivement « altérée » (`MECHANIC_LICENSE_TAMPERED`) — le mécanicien ne
 * pouvait plus se connecter, et le journal accusait une compromission de base
 * qui n'avait pas eu lieu.
 *
 * ─── GF31-AUD-005 ───────────────────────────────────────────────────────────
 * `verifyRecordMac` distingue `tampered` (MAC présent mais faux) de `missing`
 * (MAC absent). Les chemins GARAGE se contentaient d'un avertissement sur
 * `missing`. Or effacer une colonne est bien plus simple que forger un HMAC :
 * qui sait écrire dans la base mettait `recordMac = NULL`, puis repassait
 * `status` de `revoked` à `active` — la protection entière était contournée.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.GF_DB_MAC_SECRET = 'secret-de-test-record-mac-aud-005-006'
process.env.GARAGEFLOW_API_KEY = 'test-api-key-strong-0123456789'

interface Ligne {
  id: number
  licenseId: string
  token: string
  status: string
  expiryAt: Date
  hwid: string | null
  recordMac: string | null
  parentLicenseId: string | null
  mechanicId: string | null
  revokedAt: Date | null
  licenseType: string
}

const db = vi.hoisted(() => ({ ligne: null as unknown, ecrit: null as unknown }))

vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findUnique: async () => db.ligne,
      create: async (a: { data: unknown }) => a.data,
      update: async (a: { data: Record<string, unknown> }) => {
        db.ecrit = a.data
        return { ...(db.ligne as Record<string, unknown>), ...a.data }
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import('@/lib/db')
      return fn(prisma)
    },
    $executeRaw: async () => 0,
  },
  isPostgresDatabase: () => false,
}))

vi.mock('@/lib/security/rate-limit', () => ({
  clientIpFrom: () => 'test-ip',
  enforceRateLimit: async () => ({ ok: true, remaining: 99 }),
  rateLimitResponse: () => new Response('rl', { status: 429 }),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }))
// Session administrateur réputée valide : ce n'est pas l'objet du test.
vi.mock('@/lib/api-helpers', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isAdminSession: async () => true,
}))

import { computeRecordMac, verifyRecordMac, recordIntegrityUsable } from '@/lib/license/record-mac'

/** Clé MÉCANICIEN attribuée : les deux champs sensibles sont renseignés. */
function cleMecanicien(over: Partial<Ligne> = {}): Ligne {
  return {
    id: 1,
    licenseId: 'lid-mecanicien',
    token: 'GF2.jeton.mecanicien',
    status: 'active',
    expiryAt: new Date('2027-01-01T00:00:00.000Z'),
    hwid: null,
    recordMac: null,
    parentLicenseId: 'lid-garage-parent',
    mechanicId: 'mecanicien-42',
    revokedAt: null,
    licenseType: 'mechanic',
    ...over,
  }
}

/** Le MAC écrit se re-vérifie-t-il sur la ligne complète ? */
function macCoherent(ligne: Ligne, macEcrit: unknown): boolean {
  return recordIntegrityUsable(
    verifyRecordMac({
      licenseId: ligne.licenseId,
      token: ligne.token,
      status: ligne.status,
      expiryAt: ligne.expiryAt,
      hwid: ligne.hwid,
      parentLicenseId: ligne.parentLicenseId,
      mechanicId: ligne.mechanicId,
      recordMac: typeof macEcrit === 'string' ? macEcrit : null,
    }),
  )
}

beforeEach(() => {
  db.ligne = null
  db.ecrit = null
})

describe('GF31-AUD-006 — PATCH /api/admin/licenses/[id]', () => {
  it('suspendre une clé mécanicien laisse un MAC qui se re-vérifie', async () => {
    const { PATCH } = await import('@/app/api/admin/licenses/[id]/route')
    const avant = cleMecanicien()
    db.ligne = avant

    const res = await PATCH(
      new Request('http://127.0.0.1/api/admin/licenses/1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'suspended' }),
      }) as never,
      { params: { id: '1' } },
    )
    expect(res.status).toBe(200)

    const ecrit = db.ecrit as Record<string, unknown>
    expect(typeof ecrit.recordMac).toBe('string')
    // La ligne telle qu'elle sera RELUE : nouveau statut, champs mécanicien intacts.
    expect(macCoherent({ ...avant, status: 'suspended' }, ecrit.recordMac)).toBe(true)
  })

  it('changer le HWID d’une clé mécanicien laisse un MAC qui se re-vérifie', async () => {
    const { PATCH } = await import('@/app/api/admin/licenses/[id]/route')
    const avant = cleMecanicien()
    db.ligne = avant

    await PATCH(
      new Request('http://127.0.0.1/api/admin/licenses/1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hwid: 'a'.repeat(64) }),
      }) as never,
      { params: { id: '1' } },
    )

    const ecrit = db.ecrit as Record<string, unknown>
    expect(macCoherent({ ...avant, hwid: 'a'.repeat(64) }, ecrit.recordMac)).toBe(true)
  })

  it('une licence GARAGE (champs mécanicien nuls) reste correctement signée', async () => {
    const { PATCH } = await import('@/app/api/admin/licenses/[id]/route')
    const avant = cleMecanicien({
      licenseId: 'lid-garage', licenseType: 'premium',
      parentLicenseId: null, mechanicId: null,
    })
    db.ligne = avant

    await PATCH(
      new Request('http://127.0.0.1/api/admin/licenses/1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'revoked' }),
      }) as never,
      { params: { id: '1' } },
    )

    const ecrit = db.ecrit as Record<string, unknown>
    expect(macCoherent({ ...avant, status: 'revoked' }, ecrit.recordMac)).toBe(true)
  })
})

describe('GF31-AUD-006 — POST /api/admin/licenses/revoke-by-key', () => {
  it('révoquer une clé mécanicien laisse un MAC qui se re-vérifie', async () => {
    const { POST } = await import('@/app/api/admin/licenses/revoke-by-key/route')
    const avant = cleMecanicien()
    db.ligne = avant

    const res = await POST(
      new Request('http://127.0.0.1/api/admin/licenses/revoke-by-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-gf-key': process.env.GARAGEFLOW_API_KEY! },
        body: JSON.stringify({ licenseId: 'lid-mecanicien', status: 'revoked' }),
      }) as never,
    )
    expect(res.status).toBe(200)

    const ecrit = db.ecrit as Record<string, unknown>
    expect(typeof ecrit.recordMac).toBe('string')
    expect(macCoherent({ ...avant, status: 'revoked' }, ecrit.recordMac)).toBe(true)
  })

  it('réactiver ensuite la même clé produit encore un MAC cohérent', async () => {
    const { POST } = await import('@/app/api/admin/licenses/revoke-by-key/route')
    const avant = cleMecanicien({ status: 'revoked' })
    db.ligne = avant

    await POST(
      new Request('http://127.0.0.1/api/admin/licenses/revoke-by-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-gf-key': process.env.GARAGEFLOW_API_KEY! },
        body: JSON.stringify({ licenseId: 'lid-mecanicien', status: 'active' }),
      }) as never,
    )

    const ecrit = db.ecrit as Record<string, unknown>
    expect(macCoherent({ ...avant, status: 'active' }, ecrit.recordMac)).toBe(true)
  })
})

describe('GF31-AUD-005 — un MAC ABSENT n’autorise rien', () => {
  it('recordIntegrityUsable refuse un MAC absent comme un MAC faux', () => {
    expect(recordIntegrityUsable({ ok: true, tampered: false, missing: true })).toBe(false)
    expect(recordIntegrityUsable({ ok: false, tampered: true, missing: false })).toBe(false)
    expect(recordIntegrityUsable({ ok: true, tampered: false, missing: false })).toBe(true)
  })

  it('le scénario d’attaque — effacer le MAC puis réactiver — est détecté', () => {
    // 1. Licence légitimement révoquée, correctement signée.
    const revoquee = cleMecanicien({ status: 'revoked' })
    revoquee.recordMac = computeRecordMac(revoquee)
    expect(macCoherent(revoquee, revoquee.recordMac)).toBe(true)

    // 2. L'attaquant repasse `status` à « active » SANS toucher au MAC → détecté.
    const forcee = { ...revoquee, status: 'active' }
    expect(macCoherent(forcee, revoquee.recordMac)).toBe(false)

    // 3. L'attaquant efface le MAC : c'est le geste réellement à sa portée.
    //    Il doit être refusé au même titre — c'était le défaut.
    const sansMac = { ...forcee, recordMac: null }
    expect(macCoherent(sansMac, sansMac.recordMac)).toBe(false)
  })
})
