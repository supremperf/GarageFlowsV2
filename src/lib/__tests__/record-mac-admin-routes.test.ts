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
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

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

/**
 * Les écritures sont COLLECTÉES, pas écrasées.
 *
 * Avec un unique champ `ecrit`, un test qui dépasse son budget de temps voit sa
 * requête abandonnée par vitest — mais la promesse, elle, continue et écrit
 * dans l'état partagé pendant que le test SUIVANT s'exécute. Le suivant lisait
 * alors l'écriture du précédent et échouait sur un MAC incohérent, à mille
 * lieues de sa vraie cause ; dans le mauvais cas de figure, il aurait pu passer
 * au VERT sur l'écriture d'un autre. Constaté deux fois le 2026-08-13.
 *
 * En collectant, l'anomalie devient visible et nommée : chaque test exige
 * EXACTEMENT une écriture.
 */
const db = vi.hoisted(() => ({ ligne: null as unknown, ecrits: [] as unknown[], evenements: [] as unknown[] }))

vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findUnique: async () => db.ligne,
      create: async (a: { data: unknown }) => a.data,
      update: async (a: { data: Record<string, unknown> }) => {
        db.ecrits.push(a.data)
        return { ...(db.ligne as Record<string, unknown>), ...a.data }
      },
    },
    // Journal du cycle de vie des licences. Cette table manquait au simulacre :
    // la route l'écrit désormais à chaque transition de statut, et son absence
    // faisait échouer la suspension avec un 500 — un défaut du SIMULACRE, pas de
    // la route. La simuler ici garde le test sur son objet (le recordMac) tout
    // en exerçant le vrai chemin.
    licenseDeviceEvent: {
      create: async (a: { data: unknown }) => {
        db.evenements.push(a.data)
        return a.data
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

/**
 * Les routes sont importées UNE fois, hors du budget d'un test.
 *
 * Chaque `it` faisait son propre `await import(...)`. Le premier payait donc
 * seul la construction du graphe de modules de la route : 520 ms à vide contre
 * 0 à 16 ms pour les six suivants. Sous la charge de la suite complète et avec
 * un cache disque froid — les deux échecs observés sont survenus juste après un
 * `npm ci` —, ce seul test peut dépasser les 5 s de budget par défaut.
 *
 * Relever le budget n'aurait fait que déplacer le seuil (§151) : le coût
 * d'amorçage est le vrai problème, et il n'a rien à faire dans la mesure d'un
 * test. `beforeAll` le paie une fois, sous le délai des hooks.
 */
let PATCH_LICENCE: typeof import('@/app/api/admin/licenses/[id]/route')['PATCH']
let POST_REVOCATION: typeof import('@/app/api/admin/licenses/revoke-by-key/route')['POST']

beforeAll(async () => {
  PATCH_LICENCE = (await import('@/app/api/admin/licenses/[id]/route')).PATCH
  POST_REVOCATION = (await import('@/app/api/admin/licenses/revoke-by-key/route')).POST
})

beforeEach(() => {
  db.ligne = null
  db.ecrits = []
})

/** L'écriture du test COURANT — et la preuve qu'il n'y en a pas d'autre. */
function ecritureUnique(): Record<string, unknown> {
  expect(db.ecrits, 'une écriture et une seule était attendue').toHaveLength(1)
  return db.ecrits[0] as Record<string, unknown>
}

describe('GF31-AUD-006 — PATCH /api/admin/licenses/[id]', () => {
  it('suspendre une clé mécanicien laisse un MAC qui se re-vérifie', async () => {
    const avant = cleMecanicien()
    db.ligne = avant

    const res = await PATCH_LICENCE(
      new Request('http://127.0.0.1/api/admin/licenses/1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'suspended' }),
      }) as never,
      { params: { id: '1' } },
    )
    expect(res.status).toBe(200)

    const ecrit = ecritureUnique()
    expect(typeof ecrit.recordMac).toBe('string')
    // La ligne telle qu'elle sera RELUE : nouveau statut, champs mécanicien intacts.
    expect(macCoherent({ ...avant, status: 'suspended' }, ecrit.recordMac)).toBe(true)
  })

  it('changer le HWID d’une clé mécanicien laisse un MAC qui se re-vérifie', async () => {
    const avant = cleMecanicien()
    db.ligne = avant

    await PATCH_LICENCE(
      new Request('http://127.0.0.1/api/admin/licenses/1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hwid: 'a'.repeat(64) }),
      }) as never,
      { params: { id: '1' } },
    )

    const ecrit = ecritureUnique()
    expect(macCoherent({ ...avant, hwid: 'a'.repeat(64) }, ecrit.recordMac)).toBe(true)
  })

  it('une licence GARAGE (champs mécanicien nuls) reste correctement signée', async () => {
    const avant = cleMecanicien({
      licenseId: 'lid-garage', licenseType: 'premium',
      parentLicenseId: null, mechanicId: null,
    })
    db.ligne = avant

    await PATCH_LICENCE(
      new Request('http://127.0.0.1/api/admin/licenses/1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'revoked' }),
      }) as never,
      { params: { id: '1' } },
    )

    const ecrit = ecritureUnique()
    expect(macCoherent({ ...avant, status: 'revoked' }, ecrit.recordMac)).toBe(true)
  })
})

describe('GF31-AUD-006 — POST /api/admin/licenses/revoke-by-key', () => {
  it('révoquer une clé mécanicien laisse un MAC qui se re-vérifie', async () => {
    const avant = cleMecanicien()
    db.ligne = avant

    const res = await POST_REVOCATION(
      new Request('http://127.0.0.1/api/admin/licenses/revoke-by-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-gf-key': process.env.GARAGEFLOW_API_KEY! },
        body: JSON.stringify({ licenseId: 'lid-mecanicien', status: 'revoked' }),
      }) as never,
    )
    expect(res.status).toBe(200)

    const ecrit = ecritureUnique()
    expect(typeof ecrit.recordMac).toBe('string')
    expect(macCoherent({ ...avant, status: 'revoked' }, ecrit.recordMac)).toBe(true)
  })

  it('réactiver ensuite la même clé produit encore un MAC cohérent', async () => {
    const avant = cleMecanicien({ status: 'revoked' })
    db.ligne = avant

    // Le sujet de ce test est la COHÉRENCE DU MAC après réactivation, pas la
    // politique de transition. Il empruntait un `{status:'active'}` nu parce que
    // la route l'acceptait alors — c'était précisément le défaut GF-DUR-048 :
    // `revoked` est terminal, on n'en sort que par un geste dédié avec motif.
    // L'intention du test est conservée, la voie empruntée est la bonne.
    await POST_REVOCATION(
      new Request('http://127.0.0.1/api/admin/licenses/revoke-by-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-gf-key': process.env.GARAGEFLOW_API_KEY! },
        body: JSON.stringify({
          licenseId: 'lid-mecanicien',
          status: 'active',
          confirmReactivation: true,
          reason: 'Rétablissement après révocation par erreur (test de cohérence MAC)',
        }),
      }) as never,
    )

    const ecrit = ecritureUnique()
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
