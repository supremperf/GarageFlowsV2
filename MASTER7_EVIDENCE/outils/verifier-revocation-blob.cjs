#!/usr/bin/env node
/**
 * MASTER 7 — verifie si le jeton Vercel Blob expose dans l'historique PUBLIC du
 * depot est encore actif.
 *
 * A executer depuis la racine du depot, apres la suppression du store
 * `store_4TyemjFvecVTkX2W` :
 *
 *     node MASTER7_EVIDENCE/outils/verifier-revocation-blob.cjs
 *
 * Attendu apres revocation : HTTP 401 ou 403. Tant que la reponse est 200, le
 * jeton public fonctionne toujours.
 *
 * Le jeton est relu depuis l'historique git et n'est jamais affiche : seul son
 * SHA-256 tronque est imprime, pour corroborer qu'il s'agit bien du meme jeton.
 * Aucune ecriture, aucune suppression : un simple listing.
 *
 * Code de sortie 0 = revoque, 1 = encore actif, 2 = indetermine.
 */
'use strict'
const cr = require('node:crypto')
const { execFileSync } = require('node:child_process')

const COMMIT = '290d290db'
const CHEMIN = '.env.storage.local'
const STORE_ATTENDU = '4TyemjFvecVTkX2W'

let jeton
try {
  const env = execFileSync('git', ['cat-file', 'blob', `${COMMIT}:${CHEMIN}`], { maxBuffer: 1 << 28 }).toString('utf8')
  jeton = (/^BLOB_READ_WRITE_TOKEN=(.*)$/m.exec(env) || [])[1]?.trim().replace(/^["']|["']$/g, '')
} catch {
  console.error("❌ impossible de relire le jeton depuis l'historique git — exécuter depuis la racine du dépôt")
  process.exit(2)
}
if (!jeton) {
  console.error('❌ BLOB_READ_WRITE_TOKEN absent de cette version du fichier')
  process.exit(2)
}

const empreinte = cr.createHash('sha256').update(jeton, 'utf8').digest('hex').slice(0, 12)
const store = (/^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(jeton) || [])[1] || '(forme inattendue)'

console.log('Jeton Vercel Blob exposé dans l’historique public')
console.log(`  empreinte : sha256:${empreinte}…`)
console.log(`  store visé : store_${store}${store === STORE_ATTENDU ? '' : '  ⚠ différent de celui attendu'}`)
console.log('')

;(async () => {
  const ctrl = new AbortController()
  const minuteur = setTimeout(() => ctrl.abort(), 15000)
  let statut
  try {
    const r = await fetch('https://blob.vercel-storage.com?limit=1', {
      headers: { Authorization: `Bearer ${jeton}` },
      signal: ctrl.signal,
    })
    statut = r.status
  } catch (e) {
    console.log(`⚠ requête impossible : ${e.message}`)
    console.log('  Résultat indéterminé — vérifier la connectivité réseau.')
    process.exit(2)
  } finally {
    clearTimeout(minuteur)
  }

  if (statut === 401 || statut === 403) {
    console.log(`✅ RÉVOQUÉ — HTTP ${statut}. Le jeton public ne donne plus accès.`)
    process.exit(0)
  }
  if (statut === 404) {
    console.log('✅ RÉVOQUÉ — HTTP 404 : le store n’existe plus.')
    process.exit(0)
  }
  if (statut === 200) {
    console.log('❌ ENCORE ACTIF — HTTP 200. Le jeton public fonctionne toujours.')
    console.log('')
    console.log('   À exécuter depuis un terminal interactif :')
    console.log(`     vercel blob delete-store store_${STORE_ATTENDU}`)
    console.log('     vercel blob create-store garageflows-update')
    process.exit(1)
  }
  console.log(`⚠ INDÉTERMINÉ — HTTP ${statut}.`)
  process.exit(2)
})()
