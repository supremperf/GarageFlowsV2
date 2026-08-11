/**
 * Test de bout en bout — cohérence de la CLÉ PUBLIQUE de licence (ES256 / P-256).
 *
 * Invariant critique : les DEUX surfaces V2 (PWA `public-key.ts` et Electron
 * `_PK` dans electron/main.js) DOIVENT embarquer EXACTEMENT la clé publique du
 * keygen de référence. La vitrine partage la même clé (test miroir côté
 * garagesite3). Si l'une dérive, TOUTES les licences réelles sont rejetées à
 * l'activation/heartbeat — d'où ce garde‑fou par empreinte cryptographique.
 *
 * Empreinte de référence (DER‑SHA256 de keys/public.pem, fournie par l'opérateur,
 * 2026‑08) : voir REFERENCE_FP. La clé PRIVÉE n'est jamais dans le dépôt.
 *
 * Test de bout en bout POSITIF (optionnel) : si un jeton GF2 de test signé par le
 * keygen est fourni via GF_TEST_LICENSE, on vérifie qu'il est accepté par
 * verifyLicenseToken (le même code sert la PWA et Electron ; même clé + même
 * algorithme ⇒ Electron l'accepte aussi).
 */
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getPublicKeyPem } from '@/lib/license/public-key'
import { verifyLicenseToken } from '@/lib/license/verify'

/** Empreinte DER‑SHA256 (SPKI) de la clé publique de référence du keygen.
 *  (Empreinte d'une clé PUBLIQUE — non sensible ; jamais la clé privée.)
 *
 *  NE PAS MODIFIER À LA MAIN : cette constante est propagée depuis
 *  keys/public.pem par `npm run keys:sync`, en même temps que les deux littéraux
 *  embarqués. La modifier seule réintroduit exactement la panne qu'elle garde.
 *
 *  Historique des rotations (chaque ligne = un verrouillage hors du logiciel
 *  évité ou subi ; empreintes retirées listées dans check-critical-files.js) :
 *    2026‑08‑03  7bed3cb7…  alignée par f6ef4db, périmée dès le 2026‑08‑07
 *    2026‑08‑08  3150baac…  alignée par a6fbff7 (le dépôt refusait alors TOUTES
 *                           les licences en circulation)
 *    2026‑08‑08  1f1be919…  rotation cryptographique totale de l'opérateur
 *                           (22:16) : nouvelle paire, GF_PRIVATE_KEY de
 *                           production régénérée, licences serveur purgées.
 *                           Vérifié : la clé privée déployée en production
 *                           dérive exactement cette empreinte. */
const REFERENCE_FP = '78e2626bbb5d76da7ab4a6eaecc9d8e94726882fbc7c21d400aa3ebcbb0c7924' // gitleaks:allow

/** Empreinte SPKI‑DER SHA‑256 d'une clé publique PEM. */
function fingerprint(pem: string): string {
  const der = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' })
  return crypto.createHash('sha256').update(der).digest('hex')
}

/** Reconstruit un PEM à partir d'un tableau JS de lignes ('...') d'un fichier. */
function pemFromJsArray(fileContent: string, varName: string): string {
  const m = fileContent.match(new RegExp(varName + '\\s*=\\s*\\[([\\s\\S]*?)\\]'))
  if (!m) throw new Error(`Tableau ${varName} introuvable`)
  const lines = Array.from(m[1].matchAll(/'([^']*)'/g), (x) => x[1])
  return lines.join('\n')
}

describe('clé publique de licence — cohérence des 3 consommateurs', () => {
  it('V2 PWA (public-key.ts) embarque la clé de référence', () => {
    expect(fingerprint(getPublicKeyPem())).toBe(REFERENCE_FP)
  })

  it('V2 Electron (_PK dans electron/main.js) embarque la MÊME clé de référence', () => {
    const mainJs = fs.readFileSync(
      path.resolve(__dirname, '../../../../electron/main.js'),
      'utf8',
    )
    const pem = pemFromJsArray(mainJs, '_PK')
    expect(fingerprint(pem)).toBe(REFERENCE_FP)
  })

  it('PWA et Electron embarquent une clé STRICTEMENT identique', () => {
    const mainJs = fs.readFileSync(
      path.resolve(__dirname, '../../../../electron/main.js'),
      'utf8',
    )
    expect(fingerprint(pemFromJsArray(mainJs, '_PK'))).toBe(fingerprint(getPublicKeyPem()))
  })
})

describe('bout en bout — jeton GF2 réel (optionnel : GF_TEST_LICENSE)', () => {
  const token = process.env.GF_TEST_LICENSE?.trim()
  const maybe = token ? it : it.skip

  maybe('un jeton GF2 signé par le keygen est ACCEPTÉ par verifyLicenseToken', () => {
    const res = verifyLicenseToken(token as string)
    expect(res.valid).toBe(true)
    expect(res.payload).toBeTruthy()
  })

  maybe('un jeton dont la signature est altérée est REJETÉ', () => {
    const parts = (token as string).split('.')
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('A') ? 'BB' : 'AA')
    expect(verifyLicenseToken(parts.join('.')).valid).toBe(false)
  })
})
