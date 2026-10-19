'use strict'
// `npm run build` → scripts/next-build.cjs : le traçage Next/nft ne doit jamais
// énumérer le profil Windows (jonctions « Application Data », « Cookies » → EPERM).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { profilHorsTracage, environnementDeConstruction } = require('../scripts/next-build.cjs')
const w = path.win32

test('profile on another drive than the project is detected (nft would glob it)', () => {
  assert.equal(profilHorsTracage('D:\\Projets\\GarageFlowsV2', 'C:\\Users\\Jean', w), false)
  assert.equal(profilHorsTracage('D:\\a\\GarageFlowsV2\\GarageFlowsV2', 'C:\\Users\\runneradmin', w), false)
})

test('profile that is an ancestor on the same drive is already ignored by nft', () => {
  assert.equal(profilHorsTracage('C:\\Users\\Jean\\Desktop\\GarageFlowsV2', 'C:\\Users\\Jean', w), true)
  assert.equal(profilHorsTracage('C:\\Program Files\\Dev\\Garage Flows', 'C:\\Users\\Jean Dupont', w), true)
  assert.equal(profilHorsTracage('/home/ci/project', '/home/ci', path.posix), true)
})

test('cross-drive build gets an empty home under node_modules/.cache, rest of env untouched', () => {
  const { env, isole } = environnementDeConstruction({ PATH: 'P', APPDATA: 'C:\\Users\\Jean\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\Jean' },
    { racine: 'D:\\Mes Projets\\GarageFlowsV2', home: 'C:\\Users\\Jean', chemins: w })
  assert.equal(isole, 'D:\\Mes Projets\\GarageFlowsV2\\node_modules\\.cache\\gf-build-home')
  assert.equal(env.USERPROFILE, isole)
  assert.equal(env.HOMEDRIVE, 'D:')
  assert.equal(env.HOMEPATH, '\\Mes Projets\\GarageFlowsV2\\node_modules\\.cache\\gf-build-home')
  assert.equal(env.APPDATA, 'C:\\Users\\Jean\\AppData\\Roaming', 'npm/Electron caches keep their location')
  assert.equal(env.PATH, 'P')
  // The substitute is excluded from tracing by Next's own `**/node_modules/**` rule.
  assert.match(w.relative('D:\\Mes Projets\\GarageFlowsV2', isole), /^node_modules\\/)
})

test('same-drive build keeps the environment object as is', () => {
  const original = { USERPROFILE: 'C:\\Users\\Jean' }
  const { env, isole } = environnementDeConstruction(original, { racine: 'C:\\Users\\Jean\\GF', home: 'C:\\Users\\Jean', chemins: w })
  assert.equal(isole, null)
  assert.equal(env, original)
})

test('npm run build delegates to the wrapper, which runs `next build` and keeps its exit code', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  assert.match(pkg.scripts.build, /&& node scripts\/next-build\.cjs$/)
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'next-build.cjs'), 'utf8')
  assert.match(source, /\[nextBin, 'build'/)
  assert.match(source, /process\.exit\(code \?\? 1\)/)
  assert.doesNotMatch(source, /shell:\s*true/)
})
