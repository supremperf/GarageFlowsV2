/**
 * GF31-AUD-003 — NON-RÉGRESSION : un poste ne peut pas s'emparer du garage d'un
 * autre en revendiquant son identifiant.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * `authenticateGarageLicense` ne comparait le garage revendiqué au garage
 * rattaché QUE si ce dernier existait :
 *
 *     if (record.garageId && claimed && record.garageId !== claimed) → refus
 *
 * Or `LicenseKey.garageId` est NUL à l'état nominal pour une licence garage
 * côté cloud : ni `/api/admin/licenses/create` (qui ne pose un garageId que
 * pour les clés MÉCANICIEN), ni `/api/license/activate` ne le renseignent, et
 * `validateLicensedSession` — le seul autre rattacheur — est désactivé sous
 * Electron. La garde était donc inopérante en pratique, et le `garageId` du
 * CORPS de la requête était utilisé tel quel par les routes de synchronisation :
 * lecture, écriture et SUPPRESSION dans le garage d'autrui, sur simple
 * possession d'une licence GarageFlows valide.
 *
 * Pire, `/api/sync/portal` et `/api/sync/mechanic-assignment` RATTACHAIENT
 * ensuite la licence de l'appelant au garage revendiqué : l'usurpation
 * devenait permanente et parfaitement « légitime » pour tous les contrôles
 * ultérieurs.
 *
 * ─── Ce que ces tests prouvent ──────────────────────────────────────────────
 * 1. un garage déjà réservé ne peut plus être revendiqué (GARAGE_ALREADY_CLAIMED) ;
 * 2. les routes qui ne rattachent rien exigent une licence déjà rattachée
 *    (LICENSE_NOT_BOUND) — elles ne peuvent donc plus servir de première prise ;
 * 3. les cas légitimes (première réservation d'un garage libre, licence déjà
 *    rattachée à SON garage) continuent de fonctionner ;
 * 4. les clés MÉCANICIEN, qui partagent volontairement le garageId de leur
 *    parent, ne comptent pas comme réservataires.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

interface Row {
  licenseId: string
  licenseType: string
  status: string
  expiryAt: Date
  garageId: string | null
  revokedAt: Date | null
}

const store = vi.hoisted(() => ({ rows: new Map<string, Row>(), tokens: new Map<string, unknown>() }))

// Cette suite isole l'orchestration/tenant ; intégrité réelle testée dans incident-record-integrity.test.ts.
vi.mock('@/lib/license/record-mac', async (original) => ({
  ...await original<typeof import('@/lib/license/record-mac')>(),
  verifyRecordMac: () => ({ ok: true, tampered: false, missing: false }),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findUnique: async (a: { where: { licenseId: string } }) => store.rows.get(a.where.licenseId) ?? null,
      findFirst: async (a: {
        where: { garageId: string; licenseType: { not: string }; NOT: { licenseId: string } }
      }) => {
        const hit = Array.from(store.rows.values()).find(
          (row) =>
            row.garageId === a.where.garageId &&
            row.licenseType !== a.where.licenseType.not &&
            row.licenseId !== a.where.NOT.licenseId,
        )
        return hit ? { licenseId: hit.licenseId } : null
      },
    },
  },
  isPostgresDatabase: () => true,
}))

vi.mock('@/lib/license/verify', () => ({
  verifyLicenseToken: (token: string) => store.tokens.get(token) ?? { valid: false, reason: 'inconnu' },
}))

// Import différé (pas de `await` de premier niveau : la cible TypeScript du
// dépôt ne l'autorise pas), après la mise en place des simulacres.
let authenticateGarageLicense: typeof import('@/lib/sync/garage-auth').authenticateGarageLicense
let isGarageClaimedByAnotherLicense: typeof import('@/lib/sync/garage-auth').isGarageClaimedByAnotherLicense
let prisma: import('@/lib/sync/garage-auth').LicenseKeyReader

const VICTIME = 'garage-victime'
const LIC_VICTIME = 'lid-victime'
const LIC_ATTAQUANT = 'lid-attaquant'
const JETON_ATTAQUANT = 'GF2.attaquant'
const JETON_VICTIME = 'GF2.victime'

function inscrire(licenseId: string, garageId: string | null, licenseType = 'premium'): void {
  store.rows.set(licenseId, {
    licenseId, licenseType, status: 'active',
    expiryAt: new Date(Date.now() + 365 * 86_400_000),
    garageId, revokedAt: null,
  })
}

function jeton(nom: string, lid: string): void {
  store.tokens.set(nom, {
    valid: true, isMechanic: false,
    payload: { lid, cid: 'c1', typ: 'premium', iss: 0, exp: 9_999_999_999, seats: 3, wm: 'x', ver: '2.1' },
  })
}

beforeAll(async () => {
  ;({ authenticateGarageLicense, isGarageClaimedByAnotherLicense } = await import('@/lib/sync/garage-auth'))
  ;({ prisma } = (await import('@/lib/db')) as unknown as {
    prisma: import('@/lib/sync/garage-auth').LicenseKeyReader
  })
})

beforeEach(() => {
  store.rows.clear()
  store.tokens.clear()
  jeton(JETON_ATTAQUANT, LIC_ATTAQUANT)
  jeton(JETON_VICTIME, LIC_VICTIME)
  // La victime exploite son garage : sa licence y est rattachée.
  inscrire(LIC_VICTIME, VICTIME)
  // L'attaquant est un client normal dont la licence n'est pas encore rattachée.
  inscrire(LIC_ATTAQUANT, null)
})

describe('GF31-AUD-003 — revendication du garage d’autrui', () => {
  it('refuse une licence NON rattachée qui revendique le garage d’un tiers', async () => {
    const res = await authenticateGarageLicense(JETON_ATTAQUANT, VICTIME)
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.code).toBe('GARAGE_ALREADY_CLAIMED')
  })

  it('la licence de l’attaquant reste NON rattachée après la tentative', async () => {
    await authenticateGarageLicense(JETON_ATTAQUANT, VICTIME)
    expect(store.rows.get(LIC_ATTAQUANT)!.garageId).toBeNull()
  })

  it('refuse toute licence non rattachée sur les routes qui ne rattachent pas (requireBound)', async () => {
    // Même sur un garage LIBRE : ces routes ne sont jamais un premier contact.
    const res = await authenticateGarageLicense(JETON_ATTAQUANT, 'garage-encore-libre', { requireBound: true })
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.code).toBe('LICENSE_NOT_BOUND')
  })

  it('accepte la première réservation d’un garage réellement LIBRE', async () => {
    const res = await authenticateGarageLicense(JETON_ATTAQUANT, 'garage-encore-libre')
    expect(res.ok).toBe(true)
    // Pas encore rattachée : c'est la route appelante qui écrit le rattachement.
    expect(res.ok === true && res.garageId).toBeNull()
  })

  it('laisse la victime piloter SON garage (licence déjà rattachée)', async () => {
    const res = await authenticateGarageLicense(JETON_VICTIME, VICTIME, { requireBound: true })
    expect(res.ok).toBe(true)
    expect(res.ok === true && res.garageId).toBe(VICTIME)
  })

  it('refuse toujours une licence rattachée qui revendique un AUTRE garage', async () => {
    const res = await authenticateGarageLicense(JETON_VICTIME, 'un-autre-garage')
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.code).toBe('GARAGE_MISMATCH')
  })
})

describe('GF31-AUD-003 — le verrou de réservation lui-même', () => {
  it('une clé MÉCANICIEN partageant le garageId du parent ne réserve rien', async () => {
    // Cas nominal : les clés mécanicien portent le garageId de leur garage.
    // Les compter comme réservataires bloquerait le rattachement légitime du
    // parent — la garde filtre donc explicitement `licenseType: 'mechanic'`.
    store.rows.clear()
    inscrire('lid-meca', 'garage-neuf', 'mechanic')
    inscrire(LIC_ATTAQUANT, null)
    expect(await isGarageClaimedByAnotherLicense(prisma, 'garage-neuf', LIC_ATTAQUANT)).toBe(false)
  })

  it('une licence ne se considère jamais elle-même comme réservataire', async () => {
    store.rows.clear()
    inscrire(LIC_VICTIME, VICTIME)
    expect(await isGarageClaimedByAnotherLicense(prisma, VICTIME, LIC_VICTIME)).toBe(false)
  })

  it('détecte bien une licence garage tierce déjà réservataire', async () => {
    expect(await isGarageClaimedByAnotherLicense(prisma, VICTIME, LIC_ATTAQUANT)).toBe(true)
  })
})
