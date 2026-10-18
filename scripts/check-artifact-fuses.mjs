#!/usr/bin/env node
/**
 * check-artifact-fuses.mjs — vérifie les Electron Fuses SUR LE BINAIRE PRODUIT.
 *
 * POURQUOI CE SCRIPT EXISTE
 * `scripts/afterPack.js` DEMANDE l'application des fuses, et le build affiche
 * « ✓ Electron Fuses appliqués ». Mais lire le code qui demande n'est pas
 * vérifier le résultat : une montée de version d'`@electron/fuses`, un
 * `afterPack` qui échoue silencieusement, ou un artefact reconstruit à la main
 * produiraient exactement le même message. §115 l'écrit sans ambiguïté :
 * « Vérifier sur artefact réel que les fuses attendus sont effectivement
 * appliqués. Ne pas se contenter du code afterPack. »
 *
 * Ce contrôle relit donc le fil de fusibles DANS l'exécutable empaqueté et le
 * compare au plan de `scripts/fuse-config.js` — une seule source de vérité, pas
 * une liste recopiée qui divergerait.
 *
 * Usage :
 *   node scripts/check-artifact-fuses.mjs [dossier-win-unpacked]
 *
 * Sortie 0 si le binaire porte exactement le plan attendu, 1 sinon.
 * Sortie 0 également si AUCUN artefact n'existe : le contrôle est alors
 * annoncé NON EXÉCUTÉ (jamais compté vert en silence, jamais bloquant hors
 * d'une machine de build).
 */
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require_ = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const { getCurrentFuseWire, FuseV1Options } = require_('@electron/fuses')
const { fusePlan: plan } = require_(path.join(ROOT, 'scripts', 'fuse-config.js'))

const dossier = process.argv[2] ?? path.join(ROOT, 'dist', 'win-unpacked')
if (!existsSync(dossier)) {
  console.log(`⏭️  check:artifact-fuses — NON EXÉCUTÉ : aucun artefact (${path.relative(ROOT, dossier)} absent).`)
  console.log('   Lancez `npm run dist` sur une machine de build, puis rejouez ce contrôle.')
  process.exit(0)
}

const exe = readdirSync(dossier).find((f) => f.toLowerCase().endsWith('.exe') && !/^elevate/i.test(f))
if (!exe) {
  console.error(`❌ check:artifact-fuses — aucun exécutable dans ${path.relative(ROOT, dossier)}.`)
  process.exit(1)
}
const chemin = path.join(dossier, exe)

/**
 * Le fil rendu par `getCurrentFuseWire` porte des CODES D'OCTET :
 * 48 = '0' (désactivé), 49 = '1' (activé), 114 = 'r' (fusible retiré de cette
 * version d'Electron). Les comparer à des booléens sans les décoder faisait lire
 * « désactivé » partout — l'erreur exacte que ce commentaire existe pour éviter.
 */
function decoder(valeur) {
  if (valeur === undefined) return undefined
  const c = typeof valeur === 'number' ? String.fromCharCode(valeur) : String(valeur)
  if (c === 'r') return 'retiré'
  return c === '1'
}

const attendus = Object.entries(plan)
  .filter(([cle]) => /^\d+$/.test(cle))
  .map(([cle, v]) => [Number(cle), v])

const wire = await getCurrentFuseWire(chemin)
const nomDe = Object.fromEntries(
  Object.entries(FuseV1Options).filter(([, v]) => typeof v === 'number').map(([n, v]) => [v, n]),
)

const ecarts = []
const conformes = []
for (const [idx, attendu] of attendus) {
  const lu = decoder(wire[idx])
  const nom = nomDe[idx] ?? `fusible#${idx}`
  if (lu === attendu) conformes.push(`${nom}=${attendu}`)
  else ecarts.push(`${nom} : attendu ${attendu}, lu ${lu}`)
}

console.log(`🔎 check:artifact-fuses — ${path.relative(ROOT, chemin)}`)
if (ecarts.length > 0) {
  console.error(`❌ ${ecarts.length} fusible(s) NON conforme(s) au plan :`)
  for (const e of ecarts) console.error(`   • ${e}`)
  console.error('   Le binaire ne porte PAS le durcissement annoncé — artefact non distribuable.')
  process.exit(1)
}
console.log(`✅ ${conformes.length} fusible(s) conformes au plan : ${conformes.join(', ')}`)
