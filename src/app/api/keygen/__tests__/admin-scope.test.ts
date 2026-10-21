/**
 * PORTÉE des routes Keygen — pourquoi elles sortent de la matrice « par garage ».
 *
 * ─── Le constat ─────────────────────────────────────────────────────────────
 * La garde `tenant-matrix-completude.test.ts` exige que toute route `[id]` soit
 * couverte par la matrice d'isolation inter-garage, ou inscrite hors matrice
 * AVEC un motif et une preuve. Ces deux routes portent un `[lid]`, donc la garde
 * les a arrêtées — à juste titre : une exemption sans preuve finirait par servir
 * à faire taire un constat.
 *
 * La matrice générique ne peut pas les exprimer, et ce n'est pas un oubli : ce
 * sont des routes D'EXPLOITATION, machine à machine. Elles n'ont pas de session
 * garage à isoler — elles n'ont aucune session du tout. L'isolation y est
 * remplacée par une authentification de machine (clé partagée `x-gf-key`
 * comparée en temps constant) qui, si elle est absente ou fausse, refuse la
 * requête AVANT tout accès à la base.
 *
 * Ce fichier est la PREUVE annoncée dans `HORS_MATRICE` :
 *  · aucun en-tête → 403 et la base n'est jamais touchée ;
 *  · aucune lecture de session, de cookie ou d'identifiant de garage dans le
 *    code des routes (vérifié sur la source, pas sur une intention) ;
 *  · LID inconnu → 404, aucune écriture, aucune création de pierre tombale ;
 *  · la machine à états et le recalcul de `recordMac` y sont bien appliqués ;
 *  · le reset matériel DIT quand le jeton signé reste lié (jamais de faux succès).
 *
 * ─── Ce que ce fichier ne prouve PAS ────────────────────────────────────────
 *  · Aucune écriture réelle en base : `prisma` est mocké (le moteur natif n'est
 *    pas disponible dans cet environnement — cf. EXTERNAL_BLOCKERS.md). Ce qui
 *    est prouvé, c'est l'ORDRE et la NATURE des appels, pas leur effet SQL.
 *  · La vérification cryptographique d'un jeton : elle est mockée ici pour
 *    pouvoir exercer la branche « jeton lié », et elle est éprouvée pour de vrai
 *    dans `src/lib/__tests__/update-verify.test.ts` et côté Python dans
 *    `scripts/test_keygen_v2.py`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  record: null as null | Record<string, unknown>,
  devices: [] as { deviceId: string; status: string }[],
  verify: (_token: string) => ({ valid: false, payload: null as null | Record<string, unknown> }),
  writes: [] as string[],
  events: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/db', () => {
  const tx = {
    licenseKey: {
      findUnique: async ({ where }: { where: { licenseId: string } }) =>
        state.record && state.record.licenseId === where.licenseId ? state.record : null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.writes.push('licenseKey.update')
        // Copie, comme le ferait le moteur : la route tient `record` par
        // référence et lit `previousStatus` APRÈS l'écriture.
        if (state.record) state.record = { ...state.record, ...data }
        return state.record
      },
    },
    licenseDeviceEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.events.push(data)
        return data
      },
    },
  }
  return {
    prisma: {
      licenseKey: {
        findUnique: async ({ where }: { where: { licenseId: string } }) =>
          state.record && state.record.licenseId === where.licenseId ? state.record : null,
      },
      // La transaction est exécutée SANS moteur : on prouve l'ordre des appels.
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
    isPostgresDatabase: () => false,
  }
})

vi.mock('@/lib/security/rate-limit', () => ({
  enforceRateLimit: async () => ({ ok: true }),
  clientIpFrom: () => '203.0.113.7',
  rateLimitResponse: () => new Response('too many', { status: 429 }),
}))

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

vi.mock('@/lib/license/record-mac', () => ({
  computeRecordMac: (input: Record<string, unknown>) => `mac:${String(input.status)}`,
  verifyRecordMac: vi.fn(),
  recordIntegrityUsable: vi.fn(),
}))

vi.mock('@/lib/license/devices', () => ({
  listDevices: async () => state.devices,
  resetDevice: async (_id: string) => true,
  revokeDevice: async (_id: string) => true,
  activateDevice: vi.fn(),
  recordDeviceDenial: vi.fn(),
  isValidHwidFormat: undefined,
}))

vi.mock('@/lib/license/verify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/license/verify')>()
  return { ...actual, verifyLicenseToken: (token: string) => state.verify(token) }
})

import { POST as POST_STATUS } from '@/app/api/keygen/licenses/[lid]/status/route'
import { POST as POST_HWID } from '@/app/api/keygen/licenses/[lid]/hwid/route'

const RACINE = path.resolve(__dirname, '../../../../..')
const CLE = 'k'.repeat(32)

function requete(url: string, body: unknown, avecCle = true) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (avecCle) headers['x-gf-key'] = CLE
  return new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers })
}
const paramsDe = (lid: string) => ({ params: Promise.resolve({ lid }) })

beforeEach(() => {
  vi.stubEnv('GARAGEFLOW_API_KEY', CLE)
  state.record = {
    id: 'rec-1',
    licenseId: 'LID-TEST-0001',
    token: 'GF2.fixture.signature',
    status: 'active',
    expiryAt: new Date('2030-01-01T00:00:00Z'),
    hwid: 'a'.repeat(64),
    parentLicenseId: null,
    mechanicId: null,
  }
  state.devices = [{ deviceId: 'dev-1', status: 'active' }]
  state.writes = []
  state.events = []
  state.verify = () => ({ valid: false, payload: null })
})
afterEach(() => vi.unstubAllEnvs())

// ── 1 · La porte d'entrée est une clé de machine, pas une session garage ──────

describe('authentification machine à machine', () => {
  it.each([
    ['statut', POST_STATUS, { status: 'suspended' }],
    ['hwid', POST_HWID, { action: 'reset' }],
  ])('refuse sans clé API et ne touche jamais à la base (%s)', async (_nom, handler, corps) => {
    const reponse = await handler(
      requete('https://fixture.invalid/api/keygen/licenses/LID-TEST-0001', corps, false) as NextRequest,
      paramsDe('LID-TEST-0001') as never,
    )
    expect(reponse.status).toBe(403)
    expect(await reponse.json()).toMatchObject({ error: expect.stringContaining('Accès refusé') })
    expect(state.writes).toEqual([])
    expect(state.events).toEqual([])
  })

  it.each([
    ['statut', POST_STATUS, { status: 'suspended' }],
    ['hwid', POST_HWID, { action: 'reset' }],
  ])('refuse une clé API erronée (%s)', async (_nom, handler, corps) => {
    const req = requete('https://fixture.invalid/api/keygen/licenses/LID-TEST-0001', corps)
    req.headers.set('x-gf-key', 'x'.repeat(32))
    const reponse = await handler(req as NextRequest, paramsDe('LID-TEST-0001') as never)
    expect(reponse.status).toBe(403)
    expect(state.writes).toEqual([])
  })

  it('refuse quand le serveur n’a aucune clé configurée (pas d’accès ouvert par défaut)', async () => {
    vi.stubEnv('GARAGEFLOW_API_KEY', '')
    const reponse = await POST_STATUS(
      requete('https://fixture.invalid/api/keygen/licenses/LID-TEST-0001', { status: 'suspended' }) as NextRequest,
      paramsDe('LID-TEST-0001') as never,
    )
    expect(reponse.status).toBe(403)
  })
})

// ── 2 · Aucune notion de garage : la preuve est dans la source ────────────────

describe('absence de portée garage', () => {
  const fichiers = [
    'src/app/api/keygen/licenses/[lid]/status/route.ts',
    'src/app/api/keygen/licenses/[lid]/hwid/route.ts',
    'src/app/api/keygen/licenses/route.ts',
  ]
  it.each(fichiers)('%s ne lit aucune session, cookie ou identifiant de garage', (relatif) => {
    const source = fs.readFileSync(path.join(RACINE, relatif), 'utf8')
    for (const interdit of [
      'getServerSession', 'getToken', 'cookies(', 'next/headers',
      'garageId', 'session.user', 'authOptions',
    ]) {
      expect(source, `motif interdit trouvé dans ${relatif} : ${interdit}`).not.toContain(interdit)
    }
    // …et en échange, l'authentification de machine est bien présente.
    expect(source).toContain('x-gf-key')
    expect(source).toContain('timingSafeEqual')
  })
})

// ── 3 · Le LID inconnu ne crée rien ──────────────────────────────────────────

describe('LID inconnu', () => {
  it.each([
    ['statut', POST_STATUS, { status: 'suspended' }],
    ['hwid', POST_HWID, { action: 'reset' }],
  ])('répond 404 sans aucune écriture (%s)', async (_nom, handler, corps) => {
    state.record = null
    const reponse = await handler(
      requete('https://fixture.invalid/api/keygen/licenses/LID-INCONNU', corps) as NextRequest,
      paramsDe('LID-INCONNU') as never,
    )
    expect(reponse.status).toBe(404)
    expect(await reponse.json()).toMatchObject({ code: 'NOT_FOUND' })
    expect(state.writes).toEqual([])
    expect(state.events).toEqual([])
  })
})

// ── 4 · Machine à états et intégrité ────────────────────────────────────────

describe('POST statut', () => {
  it('applique la transition, recalcule le MAC et journalise', async () => {
    const reponse = await POST_STATUS(
      requete('https://fixture.invalid/api/keygen/licenses/LID-TEST-0001', {
        status: 'suspended', reason: 'Impayé constaté',
      }) as NextRequest,
      paramsDe('LID-TEST-0001') as never,
    )
    const corps = await reponse.json()
    expect(reponse.status).toBe(200)
    expect(corps).toMatchObject({ ok: true, status: 'suspended', previousStatus: 'active' })
    // Le MAC est recalculé DANS la transaction, jamais à côté.
    expect(state.writes).toEqual(['licenseKey.update'])
    expect(state.record?.recordMac).toBe('mac:suspended')
    expect(state.events).toHaveLength(1)
    expect(state.events[0]).toMatchObject({ licenseId: 'LID-TEST-0001', action: 'license_suspended' })
    expect(String(state.events[0].detail)).toContain('Impayé constaté')
  })

  it('refuse la réactivation d’une licence révoquée sans confirmation', async () => {
    state.record!.status = 'revoked'
    const reponse = await POST_STATUS(
      requete('https://fixture.invalid/api/keygen/licenses/LID-TEST-0001', { status: 'active' }) as NextRequest,
      paramsDe('LID-TEST-0001') as never,
    )
    expect(reponse.status).toBe(409)
    expect(await reponse.json()).toMatchObject({ code: 'REACTIVATION_REQUIRES_CONFIRMATION' })
    expect(state.writes).toEqual([])
  })

  it('refuse un statut inexistant', async () => {
    const reponse = await POST_STATUS(
      requete('https://fixture.invalid/api/keygen/licenses/LID-TEST-0001', { status: 'super-admin' }) as NextRequest,
      paramsDe('LID-TEST-0001') as never,
    )
    expect(reponse.status).toBe(400)
    expect(state.writes).toEqual([])
  })

  it('un statut déjà atteint n’écrit rien (idempotent)', async () => {
    state.record!.status = 'suspended'
    const reponse = await POST_STATUS(
      requete('https://fixture.invalid/api/keygen/licenses/LID-TEST-0001', { status: 'suspended' }) as NextRequest,
      paramsDe('LID-TEST-0001') as never,
    )
    expect(await reponse.json()).toMatchObject({ ok: true, unchanged: true })
    expect(state.writes).toEqual([])
  })
})

// ── 5 · Reset matériel : la vérité sur le jeton signé ───────────────────────

describe('POST hwid', () => {
  it('refuse une action inconnue', async () => {
    const reponse = await POST_HWID(
      requete('https://fixture.invalid/api/keygen/licenses/LID-TEST-0001', { action: 'effacer' }) as NextRequest,
      paramsDe('LID-TEST-0001') as never,
    )
    expect(reponse.status).toBe(400)
    expect(state.writes).toEqual([])
  })

  it('lève la liaison en base et le dit', async () => {
    const reponse = await POST_HWID(
      requete('https://fixture.invalid/api/keygen/licenses/LID-TEST-0001', { action: 'reset' }) as NextRequest,
      paramsDe('LID-TEST-0001') as never,
    )
    const corps = await reponse.json()
    expect(corps).toMatchObject({ ok: true, action: 'reset', hwidCleared: true, tokenBound: false })
    expect(state.record?.hwid).toBeNull()
    expect(corps.note).toContain('Aucune liaison matérielle dans le jeton signé')
  })

  it('NE PRÉTEND PAS qu’un reset suffit quand le jeton signé porte un HWID', async () => {
    state.verify = () => ({ valid: true, payload: { hwid: 'b'.repeat(64) } })
    const reponse = await POST_HWID(
      requete('https://fixture.invalid/api/keygen/licenses/LID-TEST-0001', { action: 'reset' }) as NextRequest,
      paramsDe('LID-TEST-0001') as never,
    )
    const corps = await reponse.json()
    expect(corps).toMatchObject({
      ok: true, hwidCleared: true, tokenBound: true, tokenHwidValid: true,
    })
    expect(corps.note).toContain('NOUVELLE licence')
    expect(corps.note).toContain('restera lié')
  })

  it('la révocation matérielle ne touche pas au champ hwid de la licence', async () => {
    const reponse = await POST_HWID(
      requete('https://fixture.invalid/api/keygen/licenses/LID-TEST-0001', { action: 'revoke' }) as NextRequest,
      paramsDe('LID-TEST-0001') as never,
    )
    expect(await reponse.json()).toMatchObject({ ok: true, action: 'revoke', hwidCleared: false })
    expect(state.writes).toEqual([])
    expect(state.record?.hwid).toBe('a'.repeat(64))
  })
})
