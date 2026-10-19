#!/usr/bin/env node
/**
 * setup-dev.js — First-time dev environment bootstrap
 *
 * Runs automatically after  npm install  (via postinstall)
 * and before  npm run dev  (via predev).
 * Also callable manually:   node scripts/setup-dev.js
 *
 * What it does:
 *   1. Creates .env from .env.example if .env is absent
 *   2. Patches an existing .env that is missing — or has a wrong — DATABASE_URL
 *   3. Ensures the prisma/ directory exists
 *   4. Creates prisma/dev.db (from the committed template, or via prisma db push)
 *      so `next dev` never fails with "Unable to open the database file".
 *
 * IMPORTANT — SQLite path resolution:
 *   Prisma resolves a relative `file:` URL RELATIVE TO THE prisma/ SCHEMA DIR.
 *   So the correct value is  file:./dev.db  → prisma/dev.db
 *   (file:./prisma/dev.db would wrongly resolve to prisma/prisma/dev.db).
 */

'use strict'

const fs   = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { ensureEnvSecret } = require('./secrets')

const root      = path.resolve(__dirname, '..')
const envSrc    = path.join(root, '.env.example')
const envDst    = path.join(root, '.env')
const prismaDir = path.join(root, 'prisma')
const devDb     = path.join(prismaDir, 'dev.db')
const template  = path.join(prismaDir, 'garageflow-template.db')

const CORRECT_DB_URL = 'file:./dev.db'
// Any of these historical/wrong values must be rewritten to CORRECT_DB_URL.
const WRONG_DB_URLS  = ['file:./prisma/dev.db', 'file:prisma/dev.db']

// ── Déploiement serveur (Vercel) : ne JAMAIS fabriquer un .env SQLite ────────
// Le serveur/PWA utilise PostgreSQL via les variables d'environnement de la
// plateforme (DATABASE_URL/DIRECT_URL). Créer ici un .env file:./dev.db serait
// au mieux inutile (process.env prime), au pire trompeur. On sort immédiatement.
if (process.env.VERCEL) {
  console.log('ℹ️   Build Vercel détecté — setup-dev.js ignoré (PostgreSQL via env vars).')
  process.exit(0)
}

let createdEnv = false

/** Copie .env.example vers .env ; false si la source est absente/illisible. */
function copieExemple() {
  try { fs.copyFileSync(envSrc, envDst); return true } catch (_) { return false }
}

/** Taille d'un fichier via son descripteur (0 si absent) — jamais de test d'existence séparé. */
function tailleDe(p) {
  try {
    const fd = fs.openSync(p, 'r')
    try { return fs.fstatSync(fd).size } finally { fs.closeSync(fd) }
  } catch (_) { return 0 }
}

// ── 1. Create / patch .env ────────────────────────────────────────────────────
try {
  // Lecture directe : un .env absent lève ENOENT et bascule sur la création.
  let contenuExistant = null
  try { contenuExistant = fs.readFileSync(envDst, 'utf8') } catch (_) {}
  if (contenuExistant !== null) {
    let content = contenuExistant
    if (!content.includes('DATABASE_URL')) {
      fs.appendFileSync(envDst, `\nDATABASE_URL="${CORRECT_DB_URL}"\n`)
      console.log('✅  .env patché : DATABASE_URL ajouté.')
    } else if (WRONG_DB_URLS.some(w => content.includes(w))) {
      // Repair an .env that points at the wrong (nested) location.
      for (const w of WRONG_DB_URLS) {
        content = content.split(`"${w}"`).join(`"${CORRECT_DB_URL}"`)
                         .split(`'${w}'`).join(`'${CORRECT_DB_URL}'`)
                         .split(w).join(CORRECT_DB_URL)
      }
      fs.writeFileSync(envDst, content, 'utf8')
      console.log('✅  .env corrigé : DATABASE_URL pointe désormais sur ./dev.db.')
    } else {
      console.log('✅  .env déjà présent.')
    }
  } else if (copieExemple()) {
    createdEnv = true
    console.log('✅  .env créé depuis .env.example')
  } else {
    // Fallback: write a minimal .env so Prisma can run
    fs.writeFileSync(
      envDst,
      [
        '# Généré automatiquement par setup-dev.js',
        `DATABASE_URL="${CORRECT_DB_URL}"`,
        'NEXTAUTH_URL="http://localhost:3000"',
        '',
      ].join('\n'),
      'utf8'
    )
    createdEnv = true
    console.log('✅  .env minimal créé (aucun .env.example trouvé).')
  }

  // ── Garantit un NEXTAUTH_SECRET fort et unique par installation ─────────────
  // Génère un secret aléatoire s'il est absent/placeholder ; n'écrase jamais un
  // secret déjà fort. La valeur n'est jamais affichée.
  try {
    const before = fs.readFileSync(envDst, 'utf8')
    const { content, changed } = ensureEnvSecret(before, 'NEXTAUTH_SECRET')
    if (changed) {
      fs.writeFileSync(envDst, content, 'utf8')
      try { fs.chmodSync(envDst, 0o600) } catch (_) { /* permissions best-effort */ }
      console.log('🔐  NEXTAUTH_SECRET généré (aléatoire, unique à cette installation).')
    }
  } catch (err) {
    console.error('⚠️  Génération du secret impossible :', err.message)
  }
} catch (err) {
  // Non-fatal — prisma generate does not need DATABASE_URL
  console.error('⚠️  Impossible de créer .env :', err.message)
}

// ── 2. Ensure prisma/ directory ───────────────────────────────────────────────
try {
  // mkdir récursif est idempotent : aucun test d'existence préalable.
  fs.mkdirSync(prismaDir, { recursive: true })
  console.log('✅  Dossier prisma/ assuré.')
} catch (err) {
  console.error('⚠️  Impossible de créer prisma/ :', err.message)
}

// ── 3. Preserve any legacy nested database without deleting user data ────────
try {
  const { preserveLegacyDevDb } = require('./lib/preserve-legacy-dev-db.cjs')
  preserveLegacyDevDb(prismaDir)
} catch (err) {
  console.error('⚠️  Copie de la base historique impossible (original conservé) :', err.message)
}

// ── 4. Ensure prisma/dev.db exists ────────────────────────────────────────────
try {
  if (tailleDe(devDb) > 0) {
    console.log('✅  Base de données prisma/dev.db présente.')
  } else if (tailleDe(template) > 0) {
    // Fast, offline path: the schema-complete template is committed to the repo.
    fs.copyFileSync(template, devDb)
    console.log('✅  Base de données créée depuis le modèle (garageflow-template.db).')
  } else {
    // Last resort: build the schema with Prisma (needs the prisma CLI + engines).
    console.log('ℹ️   Aucun modèle trouvé — création via « prisma db push »…')
    const prismaBin = path.join(
      root, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma'
    )
    const bin = fs.existsSync(prismaBin) ? prismaBin : 'prisma'
    execFileSync(bin, ['db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: CORRECT_DB_URL },
    })
    console.log('✅  Base de données créée via prisma db push.')
    // Baseline du registre de migrations (base neuve au schéma final).
    try {
      execFileSync(process.execPath, ['--experimental-strip-types', path.join(root, 'scripts', 'baseline-template.mjs'), devDb], { stdio: 'inherit' })
    } catch (err) {
      console.error('⚠️   Baseline du registre impossible :', err.message)
    }
  }
} catch (err) {
  console.error('⚠️  Impossible de créer la base de données :', err.message)
  console.error('    Lancez manuellement :  npx prisma db push')
}

// ── 5. Next-step hint (only when .env was just created) ───────────────────────
if (createdEnv) {
  console.log('')
  console.log('  ✅  NEXTAUTH_SECRET a été généré automatiquement (aléatoire).')
  console.log('  Ensuite :  npm run dev')
  console.log('')
}
