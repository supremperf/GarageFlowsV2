#!/usr/bin/env node
'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  GarageFlow — Chiffrement des ressources (build)
//
//  Chiffre des ressources sensibles en AES-256-GCM (→ fichiers .enc) avec la clé
//  dérivée du secret fragmenté (electron/secure-key.js). À l'exécution,
//  GarageFlow.exe les déchiffre UNIQUEMENT en mémoire
//  (electron/secure-resources.js → decryptFileToMemory). Aucun fichier sensible
//  ne reste en clair sur le disque.
//
//  Usage :
//    node scripts/protect-resources.js <fichier|dossier> [--out <dest>] [--keep]
//    node scripts/protect-resources.js --decrypt <fichier.enc> [--out <dest>]
//
//  Exemple : chiffrer un dossier de modèles/config avant le packaging :
//    node scripts/protect-resources.js resources/secret-config.json
//    → resources/secret-config.json.enc   (l'original peut être retiré du build)
//
//  ⚠️ N'utilisez PAS ceci sur des fichiers que le runtime lit tels quels sans
//  passer par decryptFileToMemory (ex. schema.prisma lu par Prisma) — vous les
//  rendriez illisibles. Réservé aux ressources chargées par l'app elle-même.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs')
const path = require('path')
const secure = require(path.join(__dirname, '..', 'electron', 'secure-resources.js'))

function encryptPath(target, outArg, keep) {
  const stat = fs.statSync(target)
  if (stat.isDirectory()) {
    let n = 0
    for (const name of fs.readdirSync(target)) {
      const p = path.join(target, name)
      if (fs.statSync(p).isFile() && !p.endsWith('.enc')) {
        secure.encryptFile(p, p + '.enc')
        if (!keep) fs.rmSync(p)
        n++
        console.log(`  🔒 ${path.relative(process.cwd(), p)} → ${name}.enc`)
      }
    }
    console.log(`✓ ${n} fichier(s) chiffré(s) dans ${target}`)
  } else {
    const out = outArg || target + '.enc'
    secure.encryptFile(target, out)
    if (!keep) fs.rmSync(target)
    console.log(`✓ Chiffré : ${path.relative(process.cwd(), out)}`)
  }
}

function decryptPath(target, outArg) {
  const plain = secure.decryptFileToMemory(target)
  const out = outArg || target.replace(/\.enc$/, '') + '.dec'
  fs.writeFileSync(out, plain)
  console.log(`✓ Déchiffré (test) : ${path.relative(process.cwd(), out)}`)
}

function main() {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/protect-resources.js <fichier|dossier> [--out <dest>] [--keep]')
    console.log('       node scripts/protect-resources.js --decrypt <fichier.enc> [--out <dest>]')
    process.exit(args.length === 0 ? 1 : 0)
  }
  const keep = args.includes('--keep')
  const outIdx = args.indexOf('--out')
  const outArg = outIdx !== -1 ? args[outIdx + 1] : null

  if (args[0] === '--decrypt') {
    const target = args[1]
    if (!target || !fs.existsSync(target)) { console.error('Fichier .enc introuvable.'); process.exit(1) }
    decryptPath(target, outArg)
    return
  }

  const target = args[0]
  if (!fs.existsSync(target)) { console.error(`Introuvable : ${target}`); process.exit(1) }
  encryptPath(target, outArg, keep)
}

main()
