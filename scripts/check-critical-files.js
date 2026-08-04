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

const ROOT = path.resolve(__dirname, '..')

// Fichiers dont la disparition est une régression de sécurité inacceptable.
const CRITICAL = [
  // ── Durcissement Electron ──────────────────────────────────────────────
  'electron/license-endpoint.js',
  'electron/signed-state.js',
  'electron/nav-guard.js',
  'electron/integrity.js',
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

// Empreintes textuelles qui NE DOIVENT JAMAIS réapparaître (clé publique périmée).
const FORBIDDEN_SUBSTRINGS = [
  {
    label: 'ancienne clé publique DER-SHA256 (périmée)',
    needle: 'c48e6b3e47a8cf47248ddcccc24964213ae87802f220458b97e65ae5fee9906a',
    scan: ['src/lib/license/public-key.ts', 'electron/main.js'],
  },
]

// Empreinte canonique attendue (doit être présente dans le test de cohérence).
const REQUIRED = [
  {
    label: 'clé publique canonique 7bed…478 référencée par le test de cohérence',
    needle: '7bed3cb736ccc8d422a7663939732faf6eb9a4c59daa590cc826b2f821b6d478',
    file: 'src/lib/license/__tests__/public-key-consistency.test.ts',
  },
]

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

console.log('→ Vérification de l\'absence des empreintes interdites…')
for (const rule of FORBIDDEN_SUBSTRINGS) {
  for (const rel of rule.scan) {
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p)) continue
    if (fs.readFileSync(p, 'utf8').includes(rule.needle)) {
      fail(`${rule.label} présente dans ${rel}`)
    }
  }
}
if (failures === 0) ok('aucune empreinte interdite')

console.log('→ Vérification des empreintes requises…')
for (const rule of REQUIRED) {
  const p = path.join(ROOT, rule.file)
  if (!fs.existsSync(p) || !fs.readFileSync(p, 'utf8').includes(rule.needle)) {
    fail(`${rule.label} absente de ${rule.file}`)
  } else {
    ok(rule.label)
  }
}

if (failures > 0) {
  console.error(`\n✗ ${failures} problème(s) critique(s) détecté(s).`)
  process.exit(1)
}
console.log('\n✓ Tous les fichiers critiques sont présents et cohérents.')
