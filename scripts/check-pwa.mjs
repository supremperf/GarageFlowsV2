#!/usr/bin/env node
/**
 * check-pwa.mjs — garde-fou PWA (CI).
 *
 * Vérifie, pour CHAQUE manifeste :
 *   - JSON valide ;
 *   - name / short_name = « GarageFlows » ;
 *   - chaque icône référencée EXISTE sur le disque ;
 *   - ses DIMENSIONS RÉELLES (lues dans l'entête PNG IHDR) correspondent aux
 *     dimensions déclarées dans `sizes` — c'est le contrôle qui manquait (les
 *     maskable étaient 238×238 / 636×636 alors qu'elles se déclaraient 192/512) ;
 *   - le type MIME déclaré correspond à l'extension.
 * Vérifie aussi la cohérence des manifestes entre eux (name/short_name).
 *
 * Échoue (exit 1) à la moindre incohérence. Usage : node scripts/check-pwa.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const MANIFESTS = ['public/manifest.webmanifest', 'public/manifest-mecanicien.webmanifest', 'public/manifest-client.webmanifest']

/** Lit les dimensions réelles d'un PNG (entête IHDR : largeur/hauteur en BE). */
function pngSize(absPath) {
  const b = readFileSync(absPath)
  // Signature PNG (8 octets) + longueur (4) + "IHDR" (4) → largeur@16, hauteur@20.
  if (b.length < 24 || b.toString('ascii', 12, 16) !== 'IHDR') return null
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

const errors = []
const names = []

for (const mf of MANIFESTS) {
  const abs = join(ROOT, mf)
  if (!existsSync(abs)) continue
  let json
  try {
    json = JSON.parse(readFileSync(abs, 'utf8'))
  } catch (e) {
    errors.push(`${mf} : JSON invalide (${e.message})`)
    continue
  }

  if (!json.name || !String(json.name).includes('GarageFlows')) errors.push(`${mf} : name="${json.name}" ne contient pas « GarageFlows »`)
  if (json.short_name !== 'GarageFlows') errors.push(`${mf} : short_name="${json.short_name}" ≠ « GarageFlows »`)
  names.push({ mf, name: json.name, short: json.short_name })

  for (const ic of json.icons ?? []) {
    const src = String(ic.src ?? '')
    const iconAbs = join(ROOT, 'public', src.replace(/^\//, ''))
    if (!existsSync(iconAbs)) { errors.push(`${mf} : icône absente → ${src}`); continue }
    // Type MIME cohérent avec l'extension.
    if (ic.type === 'image/png' && !src.toLowerCase().endsWith('.png')) errors.push(`${mf} : type image/png mais extension ≠ .png (${src})`)
    // Dimensions déclarées vs réelles (PNG uniquement).
    if (src.toLowerCase().endsWith('.png') && ic.sizes && ic.sizes !== 'any') {
      const declared = String(ic.sizes).split('x').map((n) => parseInt(n, 10))
      const real = pngSize(iconAbs)
      if (!real) { errors.push(`${mf} : PNG illisible → ${src}`); continue }
      if (declared[0] !== real.w || declared[1] !== real.h) {
        errors.push(`${mf} : ${src} déclare ${ic.sizes} mais mesure ${real.w}x${real.h}`)
      }
    }
  }
}

// Cohérence inter-manifestes : même short_name.
const shorts = [...new Set(names.map((n) => n.short))]
if (shorts.length > 1) errors.push(`Manifestes incohérents entre eux : short_name = ${shorts.join(' / ')}`)

if (errors.length) {
  console.error(`\n❌ PWA : ${errors.length} problème(s) :`)
  for (const e of errors) console.error(`   ${e}`)
  console.error('')
  process.exit(1)
}
console.log(`✅ PWA : manifestes valides, marque GarageFlows, icônes présentes aux dimensions exactes déclarées.`)
