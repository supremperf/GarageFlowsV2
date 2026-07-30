#!/usr/bin/env node
'use strict'

/**
 * Vérification de cohérence de version (SemVer) — utilisée en CI.
 *
 * Source unique de vérité : le champ "version" de package.json.
 *  - doit être un SemVer valide MAJOR.MINOR.PATCH ;
 *  - ne doit pas être une valeur placeholder évidente (0.0.0) ;
 *  - doit être identique dans package-lock.json (racine + packages[""]) ;
 *  - électron lit app.getVersion() (donc package.json) : rien à dupliquer.
 *
 * Sort en code 1 (échec CI) en cas d'incohérence.
 */

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/

const errors = []

const pkg = read('package.json')
const version = pkg.version

if (!SEMVER.test(version)) {
  errors.push(`package.json version « ${version} » n'est pas un SemVer valide (MAJOR.MINOR.PATCH).`)
}
if (version === '0.0.0') {
  errors.push('package.json version est un placeholder (0.0.0).')
}

try {
  const lock = read('package-lock.json')
  if (lock.version !== version) {
    errors.push(`package-lock.json (racine) = ${lock.version} ≠ package.json = ${version}.`)
  }
  if (lock.packages && lock.packages[''] && lock.packages[''].version !== version) {
    errors.push(`package-lock.json (packages[""]) = ${lock.packages[''].version} ≠ package.json = ${version}.`)
  }
} catch (e) {
  errors.push(`Lecture de package-lock.json impossible : ${e.message}`)
}

if (errors.length) {
  console.error('✖ Incohérence de version :')
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}

console.log(`✓ Version cohérente : ${version}`)
