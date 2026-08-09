/**
 * Non-régression pour les correctifs issus de l'audit adversarial V21 :
 *  - authz : révocation admin effective (adminLicenseAcceptable) ;
 *  - monnaie : TVA via la règle centrale (taxCentsFromBasis), plus aucune formule
 *    flottante Math.round(ht*rate/100) dans les routes work-orders / quote-gen ;
 *  - immutabilité (TOCTOU) : re-contrôle en transaction (devis) et garde
 *    `signedAt: null` (ordre de réparation signé).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { adminLicenseAcceptable } from '@/lib/api-helpers'
import { taxCentsFromBasis } from '@/lib/money'

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// ── authz : révocation admin effective ────────────────────────────────────────
describe('adminLicenseAcceptable — la révocation/suspension/expiration coupe l\'accès admin', () => {
  const FUTURE = new Date(Date.now() + 86_400_000)
  const base = { licenseType: 'admin', isAdmin: true, status: 'active', revokedAt: null as Date | null, expiryAt: FUTURE }

  it('licence admin active → acceptée', () => {
    expect(adminLicenseAcceptable({ ...base })).toBe(true)
  })
  it('RÉGRESSION : licence admin révoquée (status ou revokedAt) → refusée', () => {
    expect(adminLicenseAcceptable({ ...base, status: 'revoked' })).toBe(false)
    expect(adminLicenseAcceptable({ ...base, revokedAt: new Date() })).toBe(false)
  })
  it('licence admin suspendue → refusée', () => {
    expect(adminLicenseAcceptable({ ...base, status: 'suspended' })).toBe(false)
  })
  it('licence admin expirée → refusée', () => {
    expect(adminLicenseAcceptable({ ...base, expiryAt: new Date(Date.now() - 1000) })).toBe(false)
  })
  it('licence NON admin (type/flag) → refusée', () => {
    expect(adminLicenseAcceptable({ ...base, licenseType: 'premium', isAdmin: false })).toBe(false)
  })
  it('licence introuvable (null) → refusée', () => {
    expect(adminLicenseAcceptable(null)).toBe(false)
  })
})

// ── monnaie : TVA centrale exacte + plus de formule flottante ─────────────────
describe('TVA centrale (taxCentsFromBasis) — plus de dérive au centime', () => {
  it('le cas de bug documenté : 55,00 € HT à 0,7 % → 39 c (et non 38 c via flottant)', () => {
    expect(taxCentsFromBasis(5500, 0.7)).toBe(39)
    expect(Math.round((5500 * 0.7) / 100)).toBe(38) // ancienne formule flottante = fausse
  })
  it('taux standard inchangés', () => {
    expect(taxCentsFromBasis(5500, 20)).toBe(1100)
    expect(taxCentsFromBasis(10000, 5.5)).toBe(550)
  })

  const FLOAT_TVA = /Math\.round\(\s*\(\s*\w+\s*\*\s*\w+\s*\)\s*\/\s*100\s*\)/
  for (const rel of [
    'src/app/api/work-orders/route.ts',
    'src/app/api/work-orders/[id]/route.ts',
    'src/lib/quote-gen/generate.ts',
  ]) {
    it(`${rel} : utilise taxCentsFromBasis, plus la formule flottante`, () => {
      const src = read(rel)
      expect(src).toContain('taxCentsFromBasis')
      expect(FLOAT_TVA.test(src)).toBe(false)
    })
  }
})

// ── immutabilité (TOCTOU) : gardes présents ──────────────────────────────────
describe('immutabilité documentaire — gardes anti-TOCTOU présents', () => {
  it('quotes/[id] re-contrôle le verrou DANS la transaction (fresh.status + lockConflict)', () => {
    const src = read('src/app/api/quotes/[id]/route.ts')
    expect(src).toContain('lockConflict')
    expect(src).toMatch(/tx\.quote\.findFirst[\s\S]*?select:\s*\{\s*status:\s*true/)
    expect(src).toMatch(/areAmountsLocked\('quote',\s*fresh\.status\)/)
  })
  it('work-orders/[id] garde signedAt: null lors de l\'écriture des champs scellés', () => {
    const src = read('src/app/api/work-orders/[id]/route.ts')
    expect(src).toContain('signedAt: null')
    expect(src).toContain('writesSealedFields')
  })
})
