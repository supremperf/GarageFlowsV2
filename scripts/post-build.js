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

  // Contexte d'empaquetage Desktop : positionné par `npm run dist`
  // (cross-env GF_PACKAGE_DESKTOP=1). Distingue « on construit un installateur »
  // de « CI/e2e construisent juste la sortie Next.js ».
  const empaquetageDesktop = process.env.GF_PACKAGE_DESKTOP === '1' || process.env.GF_PACKAGE_DESKTOP === 'true'

  // Déploiement cloud : Vercel consomme UNIQUEMENT `.next` (sortie standalone
  // non utilisée) et n'a ni `keys/public.pem` ni le modèle SQLite du dépôt.
  // Sans cette sortie anticipée, le hook `postbuild` ferait échouer chaque
  // déploiement PWA sur un contrôle qui ne le concerne pas. Même logique que
  // `scripts/setup-dev.js` (VERCEL ⇒ profil serveur).
  if (process.env.VERCEL) {
    console.log('  ℹ  Build Vercel détecté — post-build desktop ignoré (sortie standalone non empaquetée).\n')
    return
  }

  // 0. LOCALISER la sortie standalone AVANT toute copie.
  //
  //    Le script écrivait auparavant vers des chemins FIXES sous
  //    `.next/standalone/`, en supposant que Next.js y place `server.js`. Cette
  //    supposition dépend de la racine de workspace inférée par Next.js : un
  //    `package-lock.json` présent dans un dossier PARENT du dépôt (par ex.
  //    C:\Users\<nom>\package-lock.json) faisait écrire l'application dans
  //    `.next/standalone/Desktop/MonProjet/`, d'où le message trompeur
  //    « ❌ server.js NOT found — make sure you ran: npm run build » alors que
  //    `next build` avait réussi. On analyse donc la sortie réelle : racine
  //    normale, ou imbrication à diagnostiquer puis refuser explicitement.
  const { inspectStandaloneLayout } = require('./lib/standalone-layout.cjs')
  const layout = inspectStandaloneLayout(ROOT)
  if (!layout.ok) {
    console.error(`  ❌ ${layout.error}`)
    process.exit(1)
  }
  if (layout.staticCopied) {
    console.log('  ℹ  .next/static déjà présent dans le standalone (build précédent réutilisé) — copie rafraîchie ci-dessous.')
  }
  const APP_DIR = layout.appDir
  const foundServer = layout.serverJs

  // 0 bis. COPIES PÉRIMÉES : un build antérieur, réalisé avec une racine de
  //        workspace mal inférée, laisse une seconde application imbriquée
  //        (par ex. `.next/standalone/Desktop/MonProjet/`). `build.extraResources`
  //        copie `.next/standalone` EN ENTIER : sans purge, chaque installateur
  //        embarquerait ce doublon — avec les ressources et, éventuellement, le
  //        `.env` de l'époque (donc des secrets). On le retire, puis on vérifie.
  {
    const { staleAppDirs } = require('./lib/standalone-layout.cjs')
    const obsolete = staleAppDirs(path.join(ROOT, '.next', 'standalone'), APP_DIR)
    for (const dossier of obsolete) {
      const relatif = path.relative(ROOT, dossier).split(path.sep).join('/')
      try {
        fs.rmSync(dossier, { recursive: true, force: true })
        console.log(`  🧹 sortie imbriquée périmée supprimée : ${relatif}`)
      } catch (err) {
        console.error(`  ❌ suppression impossible de ${relatif} (${err.code || 'erreur'}) — artefact non distribuable.`)
        process.exit(1)
      }
    }
    if (obsolete.length) console.log('  ℹ  ces copies provenaient d’une racine de workspace Next.js mal inférée (lockfile parent) ; outputFileTracingRoot la verrouille désormais.')
  }
  {
    const size = (fs.statSync(foundServer).size / 1024).toFixed(1)
    console.log(`  ✅ server.js found        (${size} KB) → ${path.relative(ROOT, foundServer).split(path.sep).join('/')}`)
  }

  // 1. Copy .next/static → <standalone>/.next/static  (REQUIRED — CSS + JS bundles)
  {
    const src = path.join(ROOT, '.next', 'static')
    const dst = path.join(APP_DIR, '.next', 'static')
    if (!fs.existsSync(src)) {
      console.error('  ❌ .next/static NOT found — run: npm run build first')
      process.exit(1)
    }
    const n = copyDir(src, dst)
    if (n === 0) {
      console.error('  ❌ No files copied from .next/static — build output may be corrupted')
      process.exit(1)
    }
    console.log(`  ✅ static assets copied   (${n} files) → ${path.relative(ROOT, dst).split(path.sep).join('/')}`)
  }

  // 2. Copy public/ → <standalone>/public
  {
    const src = path.join(ROOT, 'public')
    const dst = path.join(APP_DIR, 'public')
    const n   = copyDir(src, dst)
    console.log(`  ✅ public dir copied       (${n} files) → ${path.relative(ROOT, dst).split(path.sep).join('/')}`)
  }

  // 4. Copy Prisma engine binaries into standalone node_modules
  {
    const prismaClientSrc = path.join(ROOT, 'node_modules', '.prisma', 'client')
    const prismaClientDst = path.join(APP_DIR, 'node_modules', '.prisma', 'client')
    if (fs.existsSync(prismaClientSrc)) {
      const n = copyDir(prismaClientSrc, prismaClientDst)
      console.log(`  ✅ Prisma client copied   (${n} files) → standalone node_modules/.prisma`)
    } else {
      console.warn('  ⚠  .prisma/client not found — run: npx prisma generate')
    }
  }

  // 4 bis. Rendre la sortie autonome réellement autonome. Next.js peut recopier
  // des dépendances tracées sous forme de liens symboliques vers le node_modules
  // du dépôt ; on les matérialise pour qu'elles restent portables. Autre piège
  // confirmé dans le filtre interne d'electron-builder : le node_modules placé
  // à la racine d'un FileSet extraResources est EXCLU. package.json le copie
  // donc aussi comme ressource séparée (`from: .next/standalone/node_modules`).
  // Matérialiser les liens AVANT les contrôles et avant electron-builder.
  {
    const { materializeStandaloneLinks } = require('./lib/materialize-standalone-links.cjs')
    const materialises = materializeStandaloneLinks(APP_DIR)
    if (materialises.length) {
      console.log(`  ✅ liens node_modules matérialisés (${materialises.length}) : ${materialises.join(', ')}`)
    } else {
      console.log('  ✅ node_modules standalone sans liens symboliques externes')
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
    const removed = purgerEnvStandalone(APP_DIR)
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
    copyPrismaResources(ROOT, APP_DIR)
    console.log('  ✅ Prisma schema + empty release template copied')
  }

  // 6. Copy public key (if it exists) into standalone
  {
    const pubKey = path.join(ROOT, 'keys', 'public.pem')
    if (fs.existsSync(pubKey)) {
      const dst = path.join(APP_DIR, 'keys')
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
      // Contexte d'EMPAQUETAGE desktop (npm run dist, GF_PACKAGE_DESKTOP=1) :
      // sortie destinée à l'installateur, un fichier critique manquant est
      // BLOQUANT (electron-builder se contenterait d'un avertissement non bloquant
      // et l'artefact partirait sans son ancre → manifeste d'intégrité amputé).
      //
      // Contexte CI/analyse (`npm run build` seul, e2e, budget de bundle) : le
      // dossier `keys/` n'existe pas dans un checkout frais ; le standalone n'est
      // PAS empaqueté. On avertit sans casser le build — `npm run dist` exige de
      // toute façon `keys/public.pem` via scripts/preflight-release.cjs.
      if (empaquetageDesktop) {
        console.error('  ❌ keys/public.pem introuvable — artefact non distribuable.')
        console.error('     package.json (build.extraResources) et electron/integrity.js')
        console.error('     considèrent ce fichier comme critique. Générez la paire avec :')
        console.error('       python scripts/keygen.py --init')
        console.error('     puis synchronisez les ancres du code :  npm run keys:sync')
        process.exit(1)
      }
      console.warn('  ⚠  keys/public.pem absent — sortie NON distribuable en l’état (contexte non-empaquetage).')
      console.warn('     Avant de produire un installateur : npm run keys:sync, puis npm run dist.')
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
    const standalone = APP_DIR
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
        const dst = path.join(APP_DIR, 'release-manifest.json')
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
