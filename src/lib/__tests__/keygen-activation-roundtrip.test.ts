import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({ pem: '', db: vi.fn(), warn: vi.fn() }))
vi.mock('@/lib/license/public-key', () => ({ getPublicKeyPem: () => state.pem }))
vi.mock('@/lib/db', () => ({ prisma: { licenseKey: { findUnique: (...args: unknown[]) => state.db(...args) } }, isPostgresDatabase: () => false }))
vi.mock('@/lib/security/rate-limit', () => ({
  enforceRateLimit: async () => ({ ok: true }), clientIpFrom: () => 'fixture', rateLimitResponse: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ logger: { warn: (...args: unknown[]) => state.warn(...args), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/license/record-mac', () => ({ computeRecordMac: vi.fn(), verifyRecordMac: vi.fn(), recordIntegrityUsable: vi.fn() }))
vi.mock('@/lib/license/devices', () => ({
  activateDevice: vi.fn(), recordDeviceDenial: vi.fn(), isValidInstallId: vi.fn(),
  DeviceLimitError: class extends Error {}, DeviceRevokedError: class extends Error {}, InvalidHwidError: class extends Error {},
}))
import { POST } from '@/app/api/license/activate/route'
import { verifyLicenseToken } from '@/lib/license/verify'

const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const mint = (key = pair.privateKey) => {
  const head = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'GF-LIC', v: 2 })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ lid: 'fixture-license', cid: 'SENSITIVE-FIXTURE-CUSTOMER', typ: 'premium', iss: 1700000000, exp: 4102444800, seats: 1, wm: 'fixture', ver: '2.0' })).toString('base64url')
  return `GF2.${head}.${body}.${crypto.sign('sha256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`
}
function request(token: string) {
  return new NextRequest('https://fixture.invalid/api/license/activate', { method: 'POST', body: JSON.stringify({ license: token }), headers: { 'content-type': 'application/json' } })
}
// Build the external Python/TypeScript fixture once under the existing hook budget.
// Assertions keep Vitest's normal timeout; no retry, skip or relaxed test deadline.
let reproduction: { report: { ok: boolean; steps: { passed: boolean }[] }; fixture: { token: string; publicKeyPem: string } }
beforeAll(async () => {
  const code = "import {reproduce} from './scripts/reproduce-keygen-roundtrip.mjs'; let fixture; const report=reproduce(f=>{fixture=f}); console.log(JSON.stringify({report,fixture}))"
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30000 })
  reproduction = JSON.parse(stdout)
})
beforeEach(() => {
  vi.stubEnv('NEXTAUTH_SECRET', 's'.repeat(48))
  state.pem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  state.warn.mockReset()
  state.db.mockReset().mockRejectedValue(Object.assign(new Error('fixture DB unavailable'), { code: 'P1001' }))
})
afterEach(() => vi.unstubAllEnvs())

it('reproducible script exercises actual checked Python signing and actual TypeScript verification (19 positive/negative steps)', () => {
  const { report } = reproduction
  expect(report.ok).toBe(true)
  expect(report.steps.length).toBe(19)
  expect(report.steps.every((s: { passed: boolean }) => s.passed)).toBe(true)
})
it('every real GUI issuance branch uses the checked loader before signing/persistence', () => {
  const gui = fs.readFileSync('scripts/keygen_ui.py', 'utf8')
  // Régénérer une paire est irréversible (toutes les licences signées avec
  // l'autorité précédente cessent d'être valides) : l'IHM doit demander
  // confirmation, jamais écraser silencieusement.
  expect(gui).toMatch(/def _init_keys\(self\):[\s\S]{0,900}askyesno/)
  expect(gui).toMatch(/def _init_keys\(self\):[\s\S]{0,1600}core\.generate_keys\(/)

  const python = fs.existsSync('.venv/bin/python') ? path.resolve('.venv/bin/python') : 'python3'
  // L'IHM refondue regroupe garage et mécanicien dans une même méthode
  // `_generate` (avec une closure `_work` asynchrone) : plutôt que de figer des
  // noms de fonctions, on éprouve TOUTE fonction du GUI qui appelle
  // `core.make_license` / `core.make_mechanic_license`. L'invariant, lui, ne
  // change pas : le chargeur CONTRÔLÉ est appelé avant la signature, et
  // `core.load_private_key` (non contrôlé) n'est appelé nulle part.
  const script = [
    "import ast,json",
    "t=ast.parse(open('scripts/keygen_ui.py',encoding='utf-8').read())",
    "def core_calls(n):",
    "    return [x for x in ast.walk(n) if isinstance(x,ast.Call) and isinstance(x.func,ast.Attribute) and isinstance(x.func.value,ast.Name) and x.func.value.id=='core']",
    "r={}",
    "mint_fns=set()",
    "unchecked_fns=set()",
    "for n in ast.walk(t):",
    "    if not isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)): continue",
    "    c=core_calls(n)",
    "    if any(x.func.attr in ['make_license','make_mechanic_license'] for x in c): mint_fns.add(f'{n.name}:{n.lineno}')",
    "    if any(x.func.attr=='load_private_key' for x in c): unchecked_fns.add(f'{n.name}:{n.lineno}')",
    "for n in ast.walk(t):",
    "    if not isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)): continue",
    "    c=core_calls(n)",
    "    mint=[x.lineno for x in c if x.func.attr in ['make_license','make_mechanic_license']]",
    "    if not mint: continue",
    "    checked=[x.lineno for x in c if x.func.attr=='load_checked_private_key']",
    "    r[f'{n.name}:{n.lineno}']=bool(checked) and max(checked)<min(mint) and not any(x.func.attr=='load_private_key' for x in c)",
    "module_level=[x.lineno for x in t.body if isinstance(x,ast.Expr)]",
    "print(json.dumps({'branches':r,'mint_fns':sorted(mint_fns),'unchecked_fns':sorted(unchecked_fns)}))",
  ].join('\n')
  const out = JSON.parse(execFileSync(python, ['-c', script], { encoding: 'utf8' }))
  // Au moins une branche d'émission doit exister : un résultat vide rendrait
  // l'assertion suivante vraie pour rien.
  expect(Object.keys(out.branches).length).toBeGreaterThan(0)
  expect(Object.values(out.branches).every(Boolean)).toBe(true)
  // `core.load_private_key` (chargeur NON contrôlé) reste autorisé pour le
  // DIAGNOSTIC de correspondance — il ne fait que lire la clé pour comparer
  // des empreintes publiques. Ce qui est interdit, c'est de s'en servir pour
  // SIGNER : aucune fonction qui émet ne doit y toucher.
  expect(out.unchecked_fns.filter((n: string) => out.mint_fns.includes(n))).toEqual([])
})
it.each(['production', 'development'])('activation logs signature stage with correlation but no token/payload in %s', async (environment) => {
  vi.stubEnv('NODE_ENV', environment)
  const token = mint(other.privateKey)
  const response = await POST(request(token))
  const body = await response.json()
  expect(body).toMatchObject({ ok: false, code: 'LICENSE_INVALID', reason: 'Licence invalide ou modifiée' })
  expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/)
  expect(response.headers.get('X-Request-ID')).toBe(body.requestId)
  expect(body.diagnosticCode).toBe(environment === 'production' ? undefined : 'SIGNATURE_INVALID')
  expect(state.warn).toHaveBeenCalledWith('[license-verification]', { stage: 'SIGNATURE_INVALID', requestId: body.requestId })
  const log = JSON.stringify(state.warn.mock.calls)
  expect(log).not.toContain(token)
  expect(log).not.toContain('SENSITIVE-FIXTURE-CUSTOMER')
  expect(log).not.toContain('PRIVATE KEY')
  expect(state.db).not.toHaveBeenCalled()
  expect(response.headers.has('set-cookie')).toBe(false)
})
it.each(['FORMAT_INVALID', 'HEADER_UNSUPPORTED', 'SIGNATURE_INVALID'])('production keeps %s internal rather than exposing a verification oracle', async (stage) => {
  vi.stubEnv('NODE_ENV', 'production')
  let token = stage === 'FORMAT_INVALID' ? 'unrecognized' : mint(other.privateKey)
  if (stage === 'HEADER_UNSUPPORTED') {
    const parts = token.split('.'); parts[1] = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'); token = parts.join('.')
  }
  const response = await POST(request(token)), body = await response.json()
  expect(body.reason).toBe('Licence invalide ou modifiée')
  expect(body.diagnosticCode).toBeUndefined()
  expect(JSON.stringify(body)).not.toContain(stage)
  expect(state.warn).toHaveBeenCalledWith('[license-verification]', { stage, requestId: body.requestId })
  expect(state.db).not.toHaveBeenCalled()
})
it('development distinguishes unrecognized format without returning the input', async () => {
  vi.stubEnv('NODE_ENV', 'development')
  const body = await (await POST(request('unrecognized-sensitive-input'))).json()
  expect(body.diagnosticCode).toBe('FORMAT_INVALID')
  expect(body.reason).toBe('Format de licence invalide')
  expect(JSON.stringify(body)).not.toContain('unrecognized-sensitive-input')
})
it('a real checked Python token crosses the actual activation crypto barrier and reaches DB, without pretending DB activation succeeded', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  const { fixture } = reproduction
  const token = fixture.token
  state.pem = fixture.publicKeyPem
  expect(verifyLicenseToken(token).valid).toBe(true)
  const response = await POST(request(token))
  expect(state.db).toHaveBeenCalled()
  expect((await response.json()).code).toBe('DB_UNAVAILABLE')
  expect(response.status).toBe(503)
  expect(state.warn).not.toHaveBeenCalled()
})
it('unusable trust anchor stays a technical configuration failure, not an invalid license', async () => {
  vi.stubEnv('NODE_ENV', 'production'); state.pem = 'invalid anchor'
  const response = await POST(request(mint()))
  expect(response.status).toBe(500)
  expect((await response.json()).code).toBe('SERVER_MISCONFIGURED')
  expect(state.db).not.toHaveBeenCalled()
})
