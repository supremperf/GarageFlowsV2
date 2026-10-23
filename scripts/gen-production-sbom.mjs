#!/usr/bin/env node
'use strict'

/**
 * Builds a production CycloneDX SBOM without losing devOptional packages.
 *
 * npm sbom --omit=dev omits installed devOptional packages even when they are
 * in the production closure. We therefore ask npm for its complete metadata,
 * then filter it with the production tree reported by npm ls. No package,
 * version or license is authored by this script.
 *
 * Usage:
 *   node scripts/gen-production-sbom.mjs [--out docs/sbom/sbom-garageflowsv2.cdx.json]
 *   node scripts/gen-production-sbom.mjs --check [--out …] [--notices THIRD_PARTY_NOTICES.md]
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { filterProductionSbom } from './lib/production-sbom.mjs'

const args = process.argv.slice(2)
const check = args.includes('--check')
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const root = process.cwd()
const outPath = path.resolve(root, option('--out', 'docs/sbom/sbom-garageflowsv2.cdx.json'))
const noticesPath = path.resolve(root, option('--notices', 'THIRD_PARTY_NOTICES.md'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const pinnedNpm = packageJson.packageManager?.startsWith('npm@') ? packageJson.packageManager : null
const npmCommand = pinnedNpm ? 'npx' : 'npm'
const npmPrefix = pinnedNpm ? ['--yes', pinnedNpm] : []

/**
 * Chemin du script JS de npm/npx livré AVEC l'interpréteur courant.
 *
 * Sous Windows, `npm`/`npx` ne sont pas des exécutables : ce sont `npm.cmd` /
 * `npx.cmd`. `spawnSync('npx', …)` y échoue donc en `ENOENT`, et passer
 * `shell: true` pour contourner le problème ferait traverser une ligne de
 * commande cmd.exe à des arguments (ici `--omit=dev`, `npm@<version>`) —
 * inutile et risqué. On invoque directement le script JS avec `process.execPath` :
 * même binaire npm que celui livré avec ce Node, aucun shell, et le même chemin
 * de code sur Linux, macOS et Windows.
 */
function npmCliScript(command) {
  const candidate = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', `${command}-cli.js`)
  return fs.existsSync(candidate) ? candidate : null
}

function npmJson(npmArgs) {
  const printable = [npmCommand, ...npmPrefix, ...npmArgs].join(' ')
  const script = npmCliScript(npmCommand)
  const [executable, baseArgs] = script
    ? [process.execPath, [script]]
    : [process.platform === 'win32' ? `${npmCommand}.cmd` : npmCommand, []]
  const result = spawnSync(executable, [...baseArgs, ...npmPrefix, ...npmArgs], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
    // Sans script JS résolvable, seul le wrapper .cmd reste disponible sous
    // Windows, et Node refuse de lancer un .cmd hors shell depuis la correction
    // de CVE-2024-27980. Le shell est alors le seul recours, et uniquement là.
    shell: !script && process.platform === 'win32',
  })
  if (result.error) throw new Error(`${printable}: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`${printable} exited ${result.status}: ${(result.stderr || '').trim()}`)
  }
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`${printable} did not return JSON: ${error.message}`)
  }
}

/**
 * Fixe l'identité de la RACINE sur le package, jamais sur le chemin de travail.
 *
 * `npm sbom` renseigne `metadata.component.name` avec le nom du RÉPERTOIRE de
 * la racine, pas avec le `name` de package.json. La SBOM versionnée portait donc
 * « GarageFlowsV2 » — le dossier de la machine qui l'avait produite — tandis que
 * `bom-ref` et `purl` portaient bien « garageflow@1.1.0 ».
 *
 * Conséquence mesurée : `npm run sbom:verify` ne pouvait réussir que dans un
 * dossier nommé EXACTEMENT « GarageFlowsV2 ». Dans toute autre copie de travail
 * — `GarageFlowsV2-arena-…` sur le poste de build, `/app` dans un conteneur de
 * vérification — le contrôle s'arrêtait sur « SBOM root component does not match
 * package metadata », sans qu'aucune dépendance n'ait changé. Un contrôle de
 * chaîne d'approvisionnement ne doit pas dépendre d'un chemin de fichier.
 *
 * On aligne donc `name` sur `purl`/`bom-ref` (le nom npm du paquet), ce qui rend
 * la SBOM reproductible partout et strictement vérifiable.
 */
function normalizeRootIdentity(sbom) {
  const component = sbom.metadata?.component
  if (!component) throw new Error('The root CycloneDX metadata component is required')
  component.name = packageJson.name
}

function validateInstalledPackages(sbom) {
  const modulesRoot = fs.realpathSync(path.join(root, 'node_modules'))
  for (const component of sbom.components) {
    const declared = component.properties?.find(
      (property) => property.name === 'cdx:npm:package:path',
    )?.value
    const directory = path.resolve(root, declared || path.join('node_modules', component.name))
    const relative = path.relative(path.join(root, 'node_modules'), directory)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Package path escapes node_modules: ${component.name}`)
    }
    const realDirectory = fs.realpathSync(directory)
    const realRelative = path.relative(modulesRoot, realDirectory)
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new Error(`Resolved package path escapes node_modules: ${component.name}`)
    }
    const installed = JSON.parse(fs.readFileSync(path.join(realDirectory, 'package.json'), 'utf8'))
    if (installed.name !== component.name || installed.version !== component.version) {
      throw new Error(`Installed package identity mismatch: ${component.name}@${component.version}`)
    }
  }
}

function verifyNotices(sbom) {
  const markdown = fs.readFileSync(noticesPath, 'utf8')
  const inventory = markdown.split('## Inventaire')[1]?.split('## Répartition des licences')[0]
  if (!inventory) throw new Error('THIRD_PARTY_NOTICES.md has no bounded inventory section')
  const actualRows = inventory
    .split('\n')
    .filter((line) => /^\| .* \| .* \| .* \|$/.test(line))
    .filter((line) => !line.startsWith('| Composant |') && !line.startsWith('|---|'))
  const expectedRows = sbom.components.map(
    (component) => `| ${component.name} | ${component.version || '—'} |`,
  )
  const missing = expectedRows.filter(
    (expected) => !actualRows.some((actual) => actual.startsWith(expected)),
  )
  const expectedNames = new Set(sbom.components.map((component) => component.name))
  const extras = actualRows.filter((row) => !expectedNames.has(row.split(' | ')[0].slice(2)))
  if (missing.length || extras.length || actualRows.length !== expectedRows.length) {
    throw new Error(
      `Notices mismatch: ${missing.length} missing, ${extras.length} extras, ` +
        `${actualRows.length} rows versus ${expectedRows.length} components`,
    )
  }
  const countMarker = `**${sbom.components.length} composants tiers de production.**`
  if (!markdown.includes(countMarker)) throw new Error('Notices component count is stale')
}

console.error(
  `[sbom] Production closure: ${npmCommand} ${[...npmPrefix, 'ls', '--omit=dev', '--all', '--json', '--long'].join(' ')}`,
)
const productionTree = npmJson(['ls', '--omit=dev', '--all', '--json', '--long'])
console.error('[sbom] Reading complete npm metadata, including devOptional packages')
const fullSbom = npmJson([
  'sbom',
  '--include=dev',
  '--include=optional',
  '--sbom-format',
  'cyclonedx',
  '--sbom-type',
  'application',
])
const expected = filterProductionSbom(fullSbom, productionTree)
normalizeRootIdentity(expected)
validateInstalledPackages(expected)

if (!check) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(expected, null, 2) + '\n')
  console.log(`[sbom] ${expected.components.length} production components → ${path.relative(root, outPath)}`)
} else {
  const actual = JSON.parse(fs.readFileSync(outPath, 'utf8'))
  for (const field of ['components', 'dependencies']) {
    if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) {
      throw new Error(`SBOM ${field} does not match the current production tree`)
    }
  }
  if (JSON.stringify(actual.metadata?.component) !== JSON.stringify(expected.metadata?.component)) {
    throw new Error('SBOM root component does not match package metadata')
  }
  validateInstalledPackages(actual)
  verifyNotices(expected)
  console.log(
    `[sbom] PASS: ${expected.components.length} components, installed identities, graph and notices match`,
  )
}
