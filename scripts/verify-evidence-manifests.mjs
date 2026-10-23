#!/usr/bin/env node
/**
 * Vérifie TOUS les manifestes SHA256SUMS de preuves du dépôt, sur deux plans :
 *
 *   1. le fichier présent sur le disque ;
 *   2. le contenu VERSIONNÉ (le blob de l'index) — c'est-à-dire ce qu'obtiendra
 *      quiconque clone le dépôt, indépendamment de sa configuration locale de
 *      fins de ligne.
 *
 * Le second plan est celui qui compte pour un tiers. Avec `core.autocrlf=true`
 * — le défaut sous Windows — git réécrit les fins de ligne à l'indexation et à
 * l'extraction. Une preuve indexée sans l'attribut `-text` voit ses CRLF
 * normalisés : son empreinte ne correspond plus, et la vérification échoue pour
 * celui qui clone, alors que personne n'a rien altéré. Les dossiers de preuves
 * sont donc déclarés `-text` dans `.gitattributes` ; ce script atteste que la
 * protection est effective.
 *
 * Usage : node scripts/verify-evidence-manifests.mjs
 * Sortie : code 1 si une seule empreinte diverge.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const racineDepot = process.cwd()
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: racineDepot, maxBuffer: 1 << 28, ...opts })

let manifestes
try {
  manifestes = git(['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /(^|\/)SHA256SUMS$/.test(l))
    .sort()
} catch {
  console.error('❌ dépôt git introuvable — ce contrôle compare le disque au contenu versionné')
  process.exit(1)
}

if (manifestes.length === 0) {
  console.error('❌ aucun manifeste SHA256SUMS versionné')
  process.exit(1)
}

let totalEntrees = 0
let okDisque = 0
let okVersionne = 0
const anomalies = []

for (const manifeste of manifestes) {
  const racine = path.posix.dirname(manifeste)
  let nD = 0
  let nV = 0
  let n = 0

  for (const ligne of fs.readFileSync(path.join(racineDepot, manifeste), 'utf8').split(/\r?\n/)) {
    const m = /^([a-f0-9]{64}) {2}(.+)$/.exec(ligne.trim())
    if (!m) continue
    const [, empreinte, nom] = m
    n += 1
    const rel = path.posix.join(racine, nom.replace(/^\.\//, ''))
    const abs = path.join(racineDepot, rel)

    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      if (sha256(fs.readFileSync(abs)) === empreinte) nD += 1
      else anomalies.push(`${rel} — le fichier du disque ne correspond pas au manifeste`)
    } else {
      anomalies.push(`${rel} — absent du disque`)
    }

    try {
      if (sha256(git(['cat-file', 'blob', `:${rel}`])) === empreinte) nV += 1
      else anomalies.push(`${rel} — le contenu VERSIONNÉ ne correspond pas au manifeste`)
    } catch {
      anomalies.push(`${rel} — non versionné : un clone ne l'obtiendrait pas`)
    }
  }

  totalEntrees += n
  okDisque += nD
  okVersionne += nV
  const etat = nD === n && nV === n ? '✅' : '❌'
  console.log(
    `${etat} ${racine.padEnd(54)} disque ${String(nD).padStart(3)}/${n}  versionné ${String(nV).padStart(3)}/${n}`,
  )
}

const complet = okDisque === totalEntrees && okVersionne === totalEntrees
console.log('')
if (anomalies.length) {
  for (const a of anomalies) console.log(`   ${a}`)
  console.log('')
}
console.log(
  `${complet ? '✅' : '❌'} preuves : ${okDisque}/${totalEntrees} sur disque, ` +
    `${okVersionne}/${totalEntrees} versionnées — ${manifestes.length} manifestes`,
)
if (!complet) process.exit(1)
