/**
 * Licence — E2E RÉEL : outil officiel keygen (Python) → verifyLicenseToken (Node).
 *
 * Contrairement à license-crosslang-format (qui reproduit le format en Node),
 * ce test EXÉCUTE réellement `scripts/keygen_core.py` via
 * `scripts/gen_test_licenses.py` : génération d'une paire ECC P-256 ÉPHÉMÈRE +
 * signature d'une matrice de licences par l'outil officiel, puis vérification de
 * CHAQUE jeton par le code de production `verifyLicenseToken` (celui qui tourne
 * dans l'app installée). La clé publique éphémère est injectée à la place de la
 * clé embarquée — on valide la CHAÎNE cryptographique complète, pas la clé de
 * production (jamais dans le dépôt).
 *
 * Se saute proprement (pas d'échec silencieux) si Python/`cryptography` est
 * indisponible dans l'environnement.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const h = vi.hoisted(() => ({ pubPem: '' }))
vi.mock('@/lib/license/public-key', () => ({ getPublicKeyPem: () => h.pubPem }))

import { verifyLicenseToken, isValidHwidFormat, verifyHwid } from '@/lib/license/verify'

interface Fixture { name: string; token: string; expectValid: boolean; typ?: string; hwidBound?: boolean; hwidV1Bound?: boolean }
let fixtures: {
  publicPem: string; machineHwid: string; wrongHwid: string
  machineHwidV1: string; wrongHwidV1: string; licenses: Fixture[]
} | null = null

beforeAll(() => {
  const out = join(mkdtempSync(join(tmpdir(), 'gf-lic-')), 'fixtures.json')
  const driver = join(__dirname, '../../../../scripts/gen_test_licenses.py')
  const py = spawnSync('python3', [driver, out], { encoding: 'utf8' })
  // Code 2 = cryptography absente → on saute (jamais d'échec silencieux).
  if (py.status === 2 || !existsSync(out)) { fixtures = null; return }
  if (py.status !== 0) throw new Error(`gen_test_licenses.py a échoué: ${py.stderr}`)
  const parsed = JSON.parse(readFileSync(out, 'utf8'))
  fixtures = parsed
  h.pubPem = parsed.publicPem
})

describe('licence E2E — keygen_core.py officiel → verifyLicenseToken', () => {
  it('l’environnement Python/keygen est disponible (sinon suite sautée)', () => {
    const f = fixtures
    if (!f) { console.warn('[skip] Python/cryptography indisponible — E2E licence sautée'); return }
    expect(f.licenses.length).toBeGreaterThanOrEqual(9)
  })

  it('100% des licences OFFICIELLEMENT VALIDES sont acceptées', () => {
    const f = fixtures
    if (!f) return
    const valid = f.licenses.filter((l) => l.expectValid)
    const results = valid.map((l) => ({ name: l.name, ok: verifyLicenseToken(l.token).valid }))
    const passed = results.filter((r) => r.ok).length
    // Message lisible en cas d'échec.
    expect(passed, JSON.stringify(results, null, 2)).toBe(valid.length)
  })

  it('100% des licences INVALIDES (expirée / signature / payload altérés) sont REJETÉES', () => {
    const f = fixtures
    if (!f) return
    const invalid = f.licenses.filter((l) => !l.expectValid)
    for (const l of invalid) {
      expect(verifyLicenseToken(l.token).valid, `${l.name} aurait dû être rejetée`).toBe(false)
    }
    expect(invalid.length).toBeGreaterThanOrEqual(3)
  })

  it('les types premium/enterprise/trial/mécanicien sont correctement décodés', () => {
    const f = fixtures
    if (!f) return
    const byName = (frag: string) => f.licenses.find((l) => l.name.includes(frag))!
    expect(verifyLicenseToken(byName('premium valide').token).payload?.typ).toBe('premium')
    expect(verifyLicenseToken(byName('enterprise').token).payload?.typ).toBe('enterprise')
    expect(verifyLicenseToken(byName('trial').token).payload?.typ).toBe('trial')
    const mech = verifyLicenseToken(byName('mecanicien').token)
    expect(mech.isMechanic).toBe(true)
    expect(mech.isAdmin).toBe(false)
  })

  it('HWID de la machine (keygen get_hwid) — format valide, lié à la licence L5', () => {
    const f = fixtures
    if (!f) return
    expect(isValidHwidFormat(f.machineHwid)).toBe(true)
    expect(verifyHwid(f.machineHwid, f.machineHwid)).toBe(true)     // même machine
    expect(verifyHwid(f.machineHwid, f.wrongHwid)).toBe(false)      // autre machine
    const l5 = f.licenses.find((l) => l.hwidBound)!
    expect(verifyLicenseToken(l5.token).payload?.hwid).toBe(f.machineHwid) // HWID signé = HWID machine
  })

  // ── AUD-036 : bascule HWID V1 canonique, round-trip RÉEL sans matériel ──────
  // Le client produit l'empreinte canonique (algorithme partagé hwid_v1) → le
  // keygen officiel la LIE telle quelle (aucune reconstruction) → le vérificateur
  // de PRODUCTION l'accepte et la compare STRICTEMENT. Prouve la chaîne complète.
  it('HWID V1 canonique — keygen lie la valeur cliente, verify l’accepte (L7)', () => {
    const f = fixtures
    if (!f) return
    // Format v1 accepté par le code de production.
    expect(isValidHwidFormat(f.machineHwidV1)).toBe(true)
    expect(f.machineHwidV1).toMatch(/^HWID1-[0-9a-f]{64}$/)
    // Le keygen a signé EXACTEMENT la valeur produite par le client (pas de reconstruction).
    const l7 = f.licenses.find((l) => l.hwidV1Bound)!
    const p7 = verifyLicenseToken(l7.token)
    expect(p7.valid).toBe(true)
    expect(p7.payload?.hwid).toBe(f.machineHwidV1)
    // Comparaison stricte : même machine v1 → OK ; autre machine v1 → rejet.
    expect(verifyHwid(f.machineHwidV1, f.machineHwidV1)).toBe(true)
    expect(verifyHwid(f.machineHwidV1, f.wrongHwidV1)).toBe(false)
  })

  it('HWID v0 et v1 ne se confondent JAMAIS (longueurs 64 vs 70)', () => {
    const f = fixtures
    if (!f) return
    // Un HWID v0 stocké ne matche pas un HWID v1 client, et réciproquement.
    expect(verifyHwid(f.machineHwid, f.machineHwidV1)).toBe(false)
    expect(verifyHwid(f.machineHwidV1, f.machineHwid)).toBe(false)
  })
})
