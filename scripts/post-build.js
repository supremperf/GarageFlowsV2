#!/usr/bin/env node
/**
 * GarageFlows post-build script
 * Copies static assets into .next/standalone so electron-builder can package them correctly.
 * Run: node scripts/post-build.js
 */

'use strict'

const fs            = require('fs')
const path          = require('path')
const { execSync }  = require('child_process')

const ROOT = path.join(__dirname, '..')

function copyDir(src, dst) {
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠  Source not found: ${src}`)
    return 0
  }
  fs.mkdirSync(dst, { recursive: true })
  let count = 0
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item)
    const d = path.join(dst, item)
    if (fs.statSync(s).isDirectory()) {
      count += copyDir(s, d)
    } else {
      fs.copyFileSync(s, d)
      count++
    }
  }
  return count
}

function main() {
  console.log('\n🔧 GarageFlows post-build\n')

  // 1. Copy .next/static → .next/standalone/.next/static  (REQUIRED — CSS + JS bundles)
  {
    const src = path.join(ROOT, '.next', 'static')
    const dst = path.join(ROOT, '.next', 'standalone', '.next', 'static')
    if (!fs.existsSync(src)) {
      console.error('  ❌ .next/static NOT found — run: npm run build first')
      process.exit(1)
    }
    const n = copyDir(src, dst)
    if (n === 0) {
      console.error('  ❌ No files copied from .next/static — build output may be corrupted')
      process.exit(1)
    }
    console.log(`  ✅ static assets copied   (${n} files) → .next/standalone/.next/static`)
  }

  // 2. Copy public/ → .next/standalone/public
  {
    const src = path.join(ROOT, 'public')
    const dst = path.join(ROOT, '.next', 'standalone', 'public')
    const n   = copyDir(src, dst)
    console.log(`  ✅ public dir copied       (${n} files) → .next/standalone/public`)
  }

  // 3. Verify server.js exists
  {
    const serverJs = path.join(ROOT, '.next', 'standalone', 'server.js')
    if (fs.existsSync(serverJs)) {
      const size = (fs.statSync(serverJs).size / 1024).toFixed(1)
      console.log(`  ✅ server.js found        (${size} KB)`)
    } else {
      console.error('  ❌ server.js NOT found — make sure you ran: npm run build')
      process.exit(1)
    }
  }

  // 4. Copy Prisma engine binaries into standalone node_modules
  {
    const prismaClientSrc = path.join(ROOT, 'node_modules', '.prisma', 'client')
    const prismaClientDst = path.join(ROOT, '.next', 'standalone', 'node_modules', '.prisma', 'client')
    if (fs.existsSync(prismaClientSrc)) {
      const n = copyDir(prismaClientSrc, prismaClientDst)
      console.log(`  ✅ Prisma client copied   (${n} files) → standalone node_modules/.prisma`)
    } else {
      console.warn('  ⚠  .prisma/client not found — run: npx prisma generate')
    }
  }

  // 5. SÉCURITÉ — retirer TOUT fichier .env du standalone empaqueté.
  //    Next.js (`output: 'standalone'`) TRACE le `.env` du dépôt dans la sortie ;
  //    il contient des secrets de PRODUCTION (DATABASE_URL Neon, NEXTAUTH_SECRET
  //    PWA, GARAGEFLOW_API_KEY) qui seraient alors LIVRÉS EN CLAIR dans chaque
  //    installateur (lisibles dans resources/standalone/.env). L'app desktop n'en
  //    a AUCUN besoin : electron/main.js injecte l'environnement d'exécution
  //    (DATABASE_URL local SQLite, NEXTAUTH_SECRET par-installation, NEXTAUTH_URL
  //    127.0.0.1) au fork du serveur — ces valeurs priment (@next/env n'écrase
  //    jamais une variable déjà définie). On supprime donc tous les .env* ici.
  //    L'implémentation vit dans `scripts/lib/purge-standalone-env.cjs` : la
  //    porte de release doit exécuter EXACTEMENT la même purge après son build,
  //    faute de quoi elle laisse derrière elle ce qu'elle refuse (GF31-AUD-068).
  {
    const { purgerEnvStandalone } = require('./lib/purge-standalone-env.cjs')
    const standaloneDir = path.join(ROOT, '.next', 'standalone')
    const removed = purgerEnvStandalone(standaloneDir)
    if (removed.length) {
      console.log(`  ✅ secrets retirés du package : ${removed.join(', ')} (jamais distribués)`)
    } else {
      console.log('  ✅ aucun .env dans le standalone (rien à retirer)')
    }
  }

  // Only the validated, empty release template may enter the package.
  // NEVER fall back to garageflow.db/dev.db or reset a developer database.
  {
    const { copyPrismaResources } = require('./lib/package-prisma-resources.cjs')
    copyPrismaResources(ROOT, path.join(ROOT, '.next', 'standalone'))
    console.log('  ✅ Prisma schema + empty release template copied')
  }

  // 6. Copy public key (if it exists) into standalone
  {
    const pubKey = path.join(ROOT, 'keys', 'public.pem')
    if (fs.existsSync(pubKey)) {
      const dst = path.join(ROOT, '.next', 'standalone', 'keys')
      fs.mkdirSync(dst, { recursive: true })
      fs.copyFileSync(pubKey, path.join(dst, 'public.pem'))
      console.log('  ✅ public.pem copied      → standalone/keys')
    } else {
      // Échec DUR, et non simple avertissement : sans ce fichier, electron-builder
      // se contente d'un « file source doesn't exist » non bloquant, et
      // electron/integrity.js (criticalFiles) ignore silencieusement l'ancre
      // keys/public.pem. Résultat observé : un installateur d'apparence normale
      // dont le manifeste d'intégrité ne couvre que 10 fichiers critiques au lieu
      // de 11, sans qu'aucune étape de la chaîne n'ait signalé d'erreur.
      console.error('  ❌ keys/public.pem introuvable — artefact non distribuable.')
      console.error('     package.json (build.extraResources) et electron/integrity.js')
      console.error('     considèrent ce fichier comme critique. Générez la paire avec :')
      console.error('       python scripts/keygen.py --init')
      console.error('     puis synchronisez les ancres du code :  npm run keys:sync')
      process.exit(1)
    }
  }

  // 6 bis. AUCUNE CLÉ PRIVÉE NE DOIT QUITTER LE POSTE DE L'ÉDITEUR.
  //
  // `build.extraResources` copie `.next/standalone` EN ENTIER, sans filtre.
  // Or ce dossier n'est pas nettoyé entre deux builds : une copie accidentelle
  // de `keys/` y a laissé `private.pem`, qui s'est retrouvé dans CHAQUE
  // installateur produit ensuite (constaté dans dist/win-unpacked/resources/
  // standalone/keys/private.pem — clé de SIGNATURE DES LICENCES). Quiconque
  // installe l'application peut alors forger des licences valides à volonté.
  //
  // On purge donc, puis on refuse de livrer si la moindre clé privée subsiste.
  {
    const standalone = path.join(ROOT, '.next', 'standalone')
    const PRIVATE_MARKERS = ['BEGIN PRIVATE KEY', 'BEGIN EC PRIVATE KEY', 'BEGIN RSA PRIVATE KEY', 'BEGIN OPENSSH PRIVATE KEY']
    const purged = []
    const leaks = []

    const walk = (dir) => {
      let entries = []
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) { walk(full); continue }
        // Purge par NOM (private.pem, *.key…) : rapide et sans lecture.
        if (/^(private|priv|server|signing)[-_.].*\.(pem|key)$|^private\.pem$|\.key$/i.test(e.name)) {
          try { fs.rmSync(full); purged.push(path.relative(ROOT, full)); continue } catch { /* signalé ci-dessous */ }
        }
        // Puis par CONTENU : attrape une clé inlinée sous n'importe quel nom.
        let head = ''
        try {
          const fd = fs.openSync(full, 'r')
          const buf = Buffer.alloc(4096)
          const n = fs.readSync(fd, buf, 0, 4096, 0)
          fs.closeSync(fd)
          head = buf.subarray(0, n).toString('latin1')
        } catch { continue }
        if (PRIVATE_MARKERS.some((m) => head.includes(m))) leaks.push(path.relative(ROOT, full))
      }
    }
    walk(standalone)

    for (const p of purged) console.log(`  🧹 clé privée retirée du package : ${p}`)
    if (leaks.length > 0) {
      console.error('  ❌ CLÉ PRIVÉE détectée dans .next/standalone — artefact NON distribuable :')
      for (const p of leaks) console.error(`       ${p}`)
      console.error('     Supprimez ces fichiers puis relancez la construction.')
      process.exit(1)
    }
    console.log(`  ✅ aucune clé privée dans standalone (${purged.length} purgée(s))`)
  }

  // 7. Ensure Windows icon exists (warn if not)
  {
    const ico = path.join(ROOT, 'icon.ico')
    if (fs.existsSync(ico)) {
      console.log('  ✅ icon.ico found')
    } else {
      console.warn('  ⚠  icon.ico not found — run: node scripts\\generate-icons.js')
    }
  }

  // 8. RELEASE MANIFEST — génère l'identité de build (commit, versions, toolchain)
  //    et l'INCLUT dans le standalone empaqueté, pour que l'archive distribuée
  //    (sans .git) reste rattachable à son code source et vérifiable via
  //    `npm run release:verify-artifact`. Corrige « manifest absent du ZIP ».
  {
    try {
      execSync('node scripts/generate-release-manifest.mjs', { cwd: ROOT, stdio: 'inherit' })
      const src = path.join(ROOT, 'release-manifest.json')
      if (fs.existsSync(src)) {
        const dst = path.join(ROOT, '.next', 'standalone', 'release-manifest.json')
        fs.copyFileSync(src, dst)
        console.log('  ✅ release-manifest.json généré + inclus → standalone (artefact rattachable)')
      } else {
        throw new Error('release-manifest.json non généré — artefact non rattachable')
      }
    } catch (err) {
      throw new Error('Génération du release-manifest échouée : ' + err.message)
    }
  }

  console.log('\n🎉 Post-build complete — ready for electron-builder\n')
}

main()
