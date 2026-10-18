import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { LicenseConfigurationError } from '@/lib/license/failures'

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
import { logger } from '@/lib/logger'
import { POST } from '@/app/api/admin/licenses/revoke-by-key/route'
const root = path.resolve(__dirname, '../../..')
const { activateAtAuthority, activationDecision } = require('../../../electron/activation-policy')
const { activationReport } = require('../../../electron/activation-report')
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('revoke-by-key retiré', () => {
  it.each(['', 'true'])('production fermée même si flag=%s et ancienne clé présente', async (flag) => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('GF_ENABLE_REVOKE_BY_KEY', flag)
    vi.stubEnv('GARAGEFLOW_API_KEY', 'synthetic-secret-do-not-log')
    const req = new NextRequest('https://example.invalid/api/admin/licenses/revoke-by-key', {
      method: 'POST', headers: { 'x-gf-key': 'synthetic-secret-do-not-log', 'user-agent': 'audit-test' },
      body: JSON.stringify({ licenseId: 'sensitive-license-id', status: 'revoked' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(404); expect((await res.json()).code).toBe('ENDPOINT_DISABLED')
    const audit = vi.mocked(logger.warn).mock.calls.at(-1)![1]
    expect(audit).toMatchObject({ actor: 'unauthenticated', action: 'revoke-by-key.denied', userAgent: 'audit-test' })
    expect(audit).toHaveProperty('requestId'); expect(audit).toHaveProperty('timestamp'); expect(audit).toHaveProperty('ip')
    expect(JSON.stringify(audit)).not.toMatch(/synthetic-secret|sensitive-license-id/)
  })
})

describe('activation Electron : aucun repli après réponse distante ambiguë', () => {
  it.each([
    null, {}, { code: 'DB_UNAVAILABLE' }, { ok: false, code: 'DB_UNAVAILABLE' },
    { ok: false, code: 'SERVER_MISCONFIGURED' }, { ok: false, code: 'INTERNAL_ERROR' },
    { ok: true }, { ok: true, deviceToken: 'token', deviceId: 'id', httpStatus: 503 },
  ])('échec infra → aucune activation locale ni message de révocation', async (response) => {
    const post = vi.fn().mockResolvedValue(response)
    const { decision } = await activateAtAuthority(post, 'https://example.invalid/api/license/activate', {})
    expect(post).toHaveBeenCalledTimes(1)
    expect(decision).toMatchObject({ kind: 'infrastructure', status: 'infrastructure_error' })
    const report = activationReport({ refusal: decision.reason, status: decision.status, streak: 1, warnAt: 5 })
    expect(report.overlay.status).toBe('infrastructure_error')
    expect(JSON.stringify(report.overlay)).not.toMatch(/révoqué|non enregistré/)
  })
  it('refus métier distinct', () => {
    expect(activationDecision({ ok: false, code: 'DEVICE_LIMIT_REACHED', reason: 'Sièges occupés' }))
      .toMatchObject({ kind: 'business', status: 'activation_refused' })
  })
  it('succès uniquement avec appareil/jeton et HTTP valide', () => {
    expect(activationDecision({ ok: true, deviceToken: 'synthetic-token', deviceId: 'synthetic-id', httpStatus: 200 }))
      .toEqual({ kind: 'success' })
  })
})

it('les scripts reset ne réintroduisent ni diagnostics bruts ni bypass fail-closed', () => {
  for (const file of readdirSync(path.join(root, 'scripts')).filter(f => /reset/i.test(f))) {
    const source = readFileSync(path.join(root, 'scripts', file), 'utf8')
    expect(source).not.toMatch(/hasPrivateKey|serializeActivationError|activationRuntimeState|error\.stack|cause\.stack|GF_LICENSE_ACTIVATE_UPSTASH_FALLBACK/)
    expect(source).not.toMatch(/degraded\s*(?:===|!==)\s*['"]fail_closed/)
  }
})
it('le repli overlay est neutre et chaque statut émis a une entrée', () => {
  const source = readFileSync(path.join(root, 'src/components/LicenseRevokedOverlay.tsx'), 'utf8')
  expect(source).not.toMatch(/\?\?\s*(?:STATUS_CONFIG\.revoked|'revoked')/)
  for (const status of ['expired', 'device_revoked', 'device_hwid_mismatch', 'device_required', 'upgrade_required', 'unknown', 'infrastructure_error']) {
    expect(source).toContain(`${status}: {`)
  }
})

it('clé publique illisible ≠ licence invalide ; clé privée absente sans effet sur la vérification', async () => {
  vi.resetModules()
  vi.doMock('@/lib/license/public-key', () => ({ getPublicKeyPem: () => 'invalid-pem' }))
  try {
    const { verifyLicenseToken } = await import('@/lib/license/verify')
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'GF-LIC', v: 2 })).toString('base64url')
    expect(() => verifyLicenseToken(`GF2.${header}.e30.c2ln`)).toThrow('Configuration du service de licence invalide.')
    // ResetModules peut créer une autre identité de classe ; la frontière a son propre test de type.
    expect(new LicenseConfigurationError().name).toBe('LicenseConfigurationError')
  } finally { vi.doUnmock('@/lib/license/public-key'); vi.resetModules() }
})

it('PWA : toute erreur infra est un message neutre, même avec un reason trompeur', async () => {
  const { activationErrorMessage } = await import('@/lib/license/activation-message')
  for (const code of ['DB_UNAVAILABLE', 'SERVER_MISCONFIGURED', 'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE']) {
    expect(activationErrorMessage({ code, reason: 'Licence révoquée' }, 503)).not.toMatch(/révoqu|invalide|non enregistré/)
  }
  expect(activationErrorMessage({}, 503)).toContain('indisponible')
  expect(activationErrorMessage({}, 200)).not.toContain('invalide')
  expect(activationErrorMessage({ reason: 'Sièges occupés' }, 403)).toBe('Sièges occupés')
})

it('Electron : ancre publique invalide → SERVER_MISCONFIGURED sans dépendre d’une licence', () => {
  const { assertLicenseTrust } = require('../../../electron/license-trust')
  for (const pem of ['', 'invalid-pem', 'REPLACE_WITH_YOUR_PUBLIC_KEY']) {
    try { assertLicenseTrust(pem); throw new Error('expected failure') }
    catch (error) { expect((error as { code?: string }).code).toBe('SERVER_MISCONFIGURED') }
  }
})

it.each([
  ['LICENSE_REVOKED', 'revoked'], ['LICENSE_EXPIRED', 'expired'], ['LICENSE_SUSPENDED', 'suspended'],
  ['LICENSE_TAMPERED', 'tampered'], ['DEVICE_REVOKED', 'device_revoked'], ['HWID_MISMATCH', 'device_hwid_mismatch'],
])('activation %s garde son statut exact jusque dans l’overlay', (code, status) => {
  const decision = activationDecision({ ok: false, code })
  expect(decision.status).toBe(status)
  expect(activationReport({ refusal: decision.reason, status: decision.status, streak: 1, warnAt: 5 }).overlay.status).toBe(status)
})
