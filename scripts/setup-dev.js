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

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const root      = path.resolve(__dirname, '..')
const envSrc    = path.join(root, '.env.example')
const envDst    = path.join(root, '.env')
const prismaDir = path.join(root, 'prisma')
const devDb     = path.join(prismaDir, 'dev.db')
const template  = path.join(prismaDir, 'garageflow-template.db')

const CORRECT_DB_URL = 'file:./dev.db'
// Any of these historical/wrong values must be rewritten to CORRECT_DB_URL.
const WRONG_DB_URLS  = ['file:./prisma/dev.db', 'file:prisma/dev.db']

let createdEnv = false

// ── 1. Create / patch .env ────────────────────────────────────────────────────
try {
  if (fs.existsSync(envDst)) {
    let content = fs.readFileSync(envDst, 'utf8')
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
  } else if (fs.existsSync(envSrc)) {
    fs.copyFileSync(envSrc, envDst)
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
        `NEXTAUTH_SECRET="${crypto.randomBytes(32).toString('base64')}"`,
        '',
      ].join('\n'),
      'utf8'
    )
    createdEnv = true
    console.log('✅  .env minimal créé (aucun .env.example trouvé).')
  }
} catch (err) {
  // Non-fatal — prisma generate does not need DATABASE_URL
  console.error('⚠️  Impossible de créer .env :', err.message)
}

// ── 1b. Guarantee a strong NEXTAUTH_SECRET ────────────────────────────────────
// The app refuses to start without a strong secret (see src/lib/env.ts). Rather
// than ship a committed default, generate a unique one on first setup and replace
// any known placeholder / weak value that may have been copied from .env.example.
try {
  const WEAK = new Set([
    'CHANGE_ME_run_openssl_rand_base64_32',
    'CHANGE_ME_openssl_rand_base64_32',
    'gf-electron-local-secret-2026-xK9mP3qR',
    'fallback-dev-secret-change-in-production',
    '3jvKZFYUKLjGTI/mneyeY0fUN/FNp9d1XzOgnOij7+I=',
    'changeme', 'secret', 'password', 'default',
  ])
  if (fs.existsSync(envDst)) {
    let content = fs.readFileSync(envDst, 'utf8')
    const match = content.match(/^NEXTAUTH_SECRET\s*=\s*["']?([^"'\r\n]*)["']?\s*$/m)
    const current = match ? match[1].trim() : ''
    const needsSecret = !match || current.length < 16 || WEAK.has(current)
    if (needsSecret) {
      const generated = crypto.randomBytes(32).toString('base64')
      if (match) {
        content = content.replace(match[0], `NEXTAUTH_SECRET="${generated}"`)
      } else {
        content += `${content.endsWith('\n') ? '' : '\n'}NEXTAUTH_SECRET="${generated}"\n`
      }
      fs.writeFileSync(envDst, content, 'utf8')
      console.log('🔐  NEXTAUTH_SECRET fort généré dans .env.')
    }
  }
} catch (err) {
  console.error('⚠️  Impossible de garantir NEXTAUTH_SECRET :', err.message)
}

// ── 2. Ensure prisma/ directory ───────────────────────────────────────────────
try {
  if (!fs.existsSync(prismaDir)) {
    fs.mkdirSync(prismaDir, { recursive: true })
    console.log('✅  Dossier prisma/ créé.')
  }
} catch (err) {
  console.error('⚠️  Impossible de créer prisma/ :', err.message)
}

// ── 3. Clean up a wrongly-nested prisma/prisma/dev.db from older setups ────────
try {
  const nested = path.join(prismaDir, 'prisma', 'dev.db')
  if (fs.existsSync(nested)) {
    // If the real dev.db doesn't exist yet, promote the nested one; else drop it.
    if (!fs.existsSync(devDb)) {
      fs.copyFileSync(nested, devDb)
      console.log('✅  Base déplacée depuis prisma/prisma/dev.db → prisma/dev.db.')
    }
    try { fs.rmSync(path.join(prismaDir, 'prisma'), { recursive: true, force: true }) } catch (_) {}
  }
} catch (err) {
  console.error('⚠️  Nettoyage prisma/prisma/ ignoré :', err.message)
}

// ── 4. Ensure prisma/dev.db exists ────────────────────────────────────────────
try {
  if (fs.existsSync(devDb) && fs.statSync(devDb).size > 0) {
    console.log('✅  Base de données prisma/dev.db présente.')
  } else if (fs.existsSync(template) && fs.statSync(template).size > 0) {
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
  }
} catch (err) {
  console.error('⚠️  Impossible de créer la base de données :', err.message)
  console.error('    Lancez manuellement :  npx prisma db push')
}

// ── 5. Next-step hint (only when .env was just created) ───────────────────────
if (createdEnv) {
  console.log('')
  console.log('  ⚠️  Éditez .env et remplacez NEXTAUTH_SECRET par une vraie valeur :')
  console.log('       openssl rand -base64 32')
  console.log('')
  console.log('  Ensuite :  npm run dev')
  console.log('')
}
