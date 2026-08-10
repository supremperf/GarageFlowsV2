#!/usr/bin/env node
/**
 * Garde-fou anti-disparition des fichiers critiques (durcissement + mécanicien).
 *
 * Échoue (code de sortie 1) si l'un des fichiers de sécurité/licence essentiels
 * est absent ou vide. À câbler en CI et dans le pipeline de release pour empêcher
 * qu'une future fusion ne « perde » silencieusement une protection.
 *
 *   node scripts/check-critical-files.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')

// Fichiers dont la disparition est une régression de sécurité inacceptable.
const CRITICAL = [
  // ── Durcissement Electron ──────────────────────────────────────────────
  'electron/license-endpoint.js',
  'electron/signed-state.js',
  'electron/nav-guard.js',
  'electron/integrity.js',
  'electron/activation-report.js',
  'scripts/fuse-config.js',
  // ── Sécurité applicative ───────────────────────────────────────────────
  'src/lib/security/secret-cipher.ts',
  'scripts/encrypt-smtp-secrets.js',
  'src/lib/security/rate-limit.ts',
  'src/lib/auth.ts',
  'src/middleware.ts',
  'src/lib/license/public-key.ts',
  // ── Licences mécanicien ────────────────────────────────────────────────
  'src/lib/license/mechanic-session.ts',
  'src/lib/license/mechanic-admin.ts',
  'src/lib/license/record-mac.ts',
  'src/lib/mechanic-api.ts',
  // ── Tests de non-régression essentiels ─────────────────────────────────
  'src/lib/license/__tests__/public-key-consistency.test.ts',
  'src/__tests__/middleware.test.ts',
  'src/lib/__tests__/auth-authorize.test.ts',
  'src/lib/security/__tests__/secret-cipher.test.ts',
  // ── Scripts / configuration / documentation ────────────────────────────
  'scripts/garageflow-env-manifest.json',
  'docs/RESTAURATION_GARAGEFLOW.md',
  'docs/ROTATION_SECRETS.md',
  '.vercelignore',
]

/**
 * Clés publiques de licence RETIRÉES : plus aucune licence en circulation n'est
 * signée par la privée correspondante. Y revenir — par un retour en arrière, une
 * fusion malheureuse ou un copier-coller depuis une vieille branche — reproduit
 * le verrouillage hors du logiciel corrigé par a6fbff7.
 *
 * Cette liste est tenue automatiquement : `npm run keys:sync` y ajoute
 * l'empreinte sortante à chaque rotation. NE PAS retirer d'entrée.
 * gitleaks:allow — ce sont des empreintes de clés PUBLIQUES, non des secrets.
 */
const RETIRED_FINGERPRINTS = [
  { fp: 'c48e6b3e47a8cf47248ddcccc24964213ae87802f220458b97e65ae5fee9906a', retired: 'avant 2026-08-03' },
  { fp: '7bed3cb736ccc8d422a7663939732faf6eb9a4c59daa590cc826b2f821b6d478', retired: '2026-08-07 (keygen régénéré)' },
  { fp: '3150baaccc36af0120cfffa99dd41ce21c716831e432399791b5a9a9dcd59de6', retired: '2026-08-08 (rotation cryptographique totale)' },
  { fp: '1f1be91993deed4ae92353b035a7e3ccf3a972dae9b52cfe62e39824143e0e08', retired: '2026-08-09 (rotation)' },
  { fp: '1c21d4bb0baa2f52812eef35bd5ebca70818f02086d35d3c30ebf4f4fa77a312', retired: '2026-08-10 (rotation)' },
]

/** Reconstruit le PEM porté par un littéral `const <varName> = [ '…', … ]`. */
function pemFromLiteral(rel, varName) {
  const source = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const block = source.match(new RegExp(`const\\s+${varName}\\s*=\\s*\\[([\\s\\S]*?)\\]`))
  if (!block) return null
  return Array.from(block[1].matchAll(/'([^']*)'/g), (m) => m[1]).join('\n')
}

/** Empreinte canonique : SHA-256 du DER SPKI. */
function fingerprint(pem) {
  return crypto.createHash('sha256')
    .update(crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }))
    .digest('hex')
}

let failures = 0
const fail = (msg) => { console.error('  ✗ ' + msg); failures++ }
const ok = (msg) => console.log('  ✓ ' + msg)

console.log('→ Vérification des fichiers critiques…')
for (const rel of CRITICAL) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) { fail(`MANQUANT : ${rel}`); continue }
  const size = fs.statSync(p).size
  if (size === 0) { fail(`VIDE : ${rel}`); continue }
  ok(rel)
}

// La clé publique EMBARQUÉE est la seule qui compte : on la dérive des deux
// littéraux plutôt que de chercher une empreinte en clair dans des fichiers qui
// n'en contiennent aucune — un contrôle textuel y était structurellement muet.
console.log('→ Vérification de la clé publique embarquée…')
const EMBEDDED = [
  { rel: 'electron/main.js', varName: '_PK' },
  { rel: 'src/lib/license/public-key.ts', varName: '_LINES' },
]
const empreintes = new Map()
for (const { rel, varName } of EMBEDDED) {
  const pem = pemFromLiteral(rel, varName)
  if (!pem) { fail(`littéral \`${varName}\` introuvable dans ${rel}`); continue }
  try { empreintes.set(rel, fingerprint(pem)) } catch (e) {
    fail(`clé publique embarquée illisible dans ${rel} : ${e.message}`)
  }
}
if (new Set(empreintes.values()).size > 1) {
  fail('les deux clés publiques embarquées DIVERGENT — les licences seront refusées :\n' +
    [...empreintes].map(([rel, fp]) => `      ${rel.padEnd(34)} ${fp}`).join('\n'))
} else if (empreintes.size === EMBEDDED.length) {
  const active = [...empreintes.values()][0]
  const retired = RETIRED_FINGERPRINTS.find((r) => r.fp === active)
  if (retired) {
    fail(`la clé publique embarquée est une clé RETIRÉE (${retired.retired}) :\n` +
      `      ${active}\n` +
      '      Aucune licence en circulation n\'est signée par sa privée : tout binaire\n' +
      '      construit ici refusera SILENCIEUSEMENT chaque activation.\n' +
      '      Réparez : npm run keys:sync (depuis la machine porteuse de keys/public.pem).')
  } else {
    ok(`clé publique embarquée cohérente et non retirée (${active.slice(0, 16)}…)`)
  }

  // L'empreinte de référence du test doit suivre la clé réellement embarquée.
  const testRel = 'src/lib/license/__tests__/public-key-consistency.test.ts'
  const testSrc = fs.readFileSync(path.join(ROOT, testRel), 'utf8')
  const ref = testSrc.match(/const\s+REFERENCE_FP\s*=\s*'([0-9a-f]{64})'/)
  if (!ref) fail(`REFERENCE_FP introuvable dans ${testRel}`)
  else if (ref[1] !== active) {
    fail(`REFERENCE_FP (${ref[1].slice(0, 16)}…) ne correspond pas à la clé embarquée ` +
      `(${active.slice(0, 16)}…) — réparez : npm run keys:sync`)
  } else ok('REFERENCE_FP du test de cohérence alignée sur la clé embarquée')
}

if (failures > 0) {
  console.error(`\n✗ ${failures} problème(s) critique(s) détecté(s).`)
  process.exit(1)
}
console.log('\n✓ Tous les fichiers critiques sont présents et cohérents.')
