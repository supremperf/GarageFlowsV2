#!/usr/bin/env node
'use strict'

/**
 * Génère THIRD_PARTY_NOTICES.md à partir de la SBOM CycloneDX (dépendances de
 * PRODUCTION) et des fichiers LICENSE présents dans node_modules.
 *
 * Les licences permissives (MIT, Apache-2.0, ISC, BSD) exigent la reproduction
 * des notices d'attribution dans les produits distribués — obligation non
 * satisfaite tant que ce fichier n'existe pas. La faible copyleft (LGPL) exige
 * en plus la mention et la possibilité de remplacer la bibliothèque.
 *
 * Usage : node scripts/gen-third-party-notices.mjs [--sbom <chemin>] [--out <chemin>] [--product <nom>]
 * Déterministe (tri par nom) ; n'accède qu'au disque local.
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def }
const ROOT = process.cwd()
const sbomPath = opt('--sbom', 'docs/sbom/sbom-garageflowsv2.cdx.json')
const outPath = opt('--out', 'THIRD_PARTY_NOTICES.md')
const product = opt('--product', 'GarageFlows')

const sbom = JSON.parse(fs.readFileSync(path.join(ROOT, sbomPath), 'utf8'))

function licenseOf(c) {
  const ls = c.licenses || []
  const names = ls.map((l) => (l.license && (l.license.id || l.license.name)) || l.expression).filter(Boolean)
  return names.length ? Array.from(new Set(names)).join(' / ') : 'Voir le paquet'
}

function packageDirectory(component) {
  const { name, version } = component
  const declared = component.properties?.find(p => p.name === 'cdx:npm:package:path')?.value
  const dir = path.resolve(ROOT, declared || path.join('node_modules', name))
  const base = path.resolve(ROOT, 'node_modules') + path.sep
  if (!dir.startsWith(base)) throw new Error('Invalid SBOM package location')
  if (!fs.existsSync(dir)) return null
  if (!fs.realpathSync(dir).startsWith(base)) throw new Error('Invalid SBOM package location')
  const installed = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  if (installed.name !== name || installed.version !== version) throw new Error('SBOM package identity/version mismatch')
  return dir
}

function ownLicense(dir) {
  if (!dir) return null
  for (const file of fs.readdirSync(dir)) {
    if (/^licen[cs]e/i.test(file) && fs.statSync(path.join(dir, file)).isFile()) {
      try { return { file, text: fs.readFileSync(path.join(dir, file), 'utf8').trim() } } catch { return null }
    }
  }
  return null
}

function repositoryOf(component) {
  let url = component.externalReferences?.find(reference => reference.type === 'vcs')?.url
  if (!url) {
    const dir = packageDirectory(component)
    if (dir) {
      const installed = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      url = typeof installed.repository === 'string' ? installed.repository : installed.repository?.url
    }
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(url || '')) url = `https://github.com/${url}`
  return url?.replace(/^git\+/, '').replace(/\/$/, '').replace(/\.git$/, '')
}

/** Cherche un texte local, puis une notice amont de même dépôt/version/licence. */
function licenseText(component, components) {
  const dir = packageDirectory(component)
  const own = ownLicense(dir)
  if (own) return own.text

  const readme = dir && ['README.md', 'README.markdown', 'README']
    .find(file => fs.existsSync(path.join(dir, file)) && fs.statSync(path.join(dir, file)).isFile())
  if (readme) {
    const text = fs.readFileSync(path.join(dir, readme), 'utf8').trim()
    if (/^##\s+Licensing\s*$/mi.test(text)) {
      return `Source : ${component.name}@${component.version}/${readme}, section Licensing.\n\n${text}`
    }
  }

  const repository = repositoryOf(component)
  if (!repository || !dir) return null
  const fallbacks = []
  for (const candidate of components) {
    if (candidate.name === component.name || candidate.version !== component.version) continue
    if (repositoryOf(candidate) !== repository || licenseOf(candidate) !== licenseOf(component)) continue
    const source = ownLicense(packageDirectory(candidate))
    if (source) fallbacks.push({ candidate, source })
  }
  const distinctTexts = new Set(fallbacks.map(fallback => fallback.source.text))
  if (fallbacks.length && distinctTexts.size === 1) {
    const { candidate, source } = fallbacks[0]
    return `Source : ${candidate.name}@${candidate.version}/${source.file}, même dépôt amont, version et licence ; le paquet ne contient pas son propre fichier de licence.\n\n${source.text}`
  }
  return null
}

const comps = (sbom.components || [])
  .filter((c) => c.name && c.name !== product.toLowerCase())
  .sort((a, b) => a.name.localeCompare(b.name))

const byLicense = {}
const lines = []
lines.push(`# Notices des composants tiers — ${product}`)
lines.push('')
lines.push('> Généré par `scripts/gen-third-party-notices.mjs` depuis la SBOM CycloneDX')
lines.push('> (dépendances de PRODUCTION). Les licences permissives (MIT/Apache/ISC/BSD)')
lines.push('> exigent la reproduction de ces attributions dans le produit distribué.')
lines.push('')
lines.push(`**${comps.length} composants tiers de production.**`)
lines.push('')
lines.push('## Inventaire')
lines.push('')
lines.push('| Composant | Version | Licence |')
lines.push('|---|---|---|')
for (const c of comps) {
  const lic = licenseOf(c)
  byLicense[lic] = (byLicense[lic] || 0) + 1
  lines.push(`| ${c.name} | ${c.version || '—'} | ${lic} |`)
}
lines.push('')
lines.push('## Répartition des licences')
lines.push('')
for (const [lic, n] of Object.entries(byLicense).sort((a, b) => b[1] - a[1])) {
  lines.push(`- ${n} × ${lic}`)
}
lines.push('')
lines.push('## Textes de licence')
lines.push('')
for (const c of comps) {
  const text = licenseText(c, comps)
  lines.push(`### ${c.name}@${c.version || ''} — ${licenseOf(c)}`)
  lines.push('')
  if (text) {
    lines.push('```')
    lines.push(text.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[ \t]+$/g, '')).join('\n'))
    lines.push('```')
  } else {
    lines.push('_(Texte de licence non trouvé sur disque — se référer au dépôt amont du paquet.)_')
  }
  lines.push('')
}

fs.writeFileSync(path.join(ROOT, outPath), lines.join('\n') + '\n')
console.log(`[notices] ${comps.length} composants → ${outPath}`)
