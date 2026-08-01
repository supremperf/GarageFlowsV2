#!/usr/bin/env node
/**
 * apply-brand — propage la marque blanche vers les métadonnées de PACKAGING
 * (lues au build par electron-builder, hors de portée de src/config/brand.ts).
 *
 * Source de marque (priorité) : variables `GF_BRAND_*` > `brand.config.json` à la
 * racine > défauts GarageFlow. Patche :
 *   - package.json : name (slug), productName, author, build.appId,
 *     build.productName, build.copyright, build.nsis.shortcutName ;
 *   - electron/main.js : app.setAppUserModelId('<appId>').
 *
 * Usage :
 *   node scripts/apply-brand.js            # applique
 *   node scripts/apply-brand.js --check    # dry-run ; exit 1 si des changements sont requis
 *
 * Idempotent. Les fonctions pures ci-dessous sont testées (scripts/__tests__).
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

/** Défauts de packaging — DOIVENT correspondre à src/config/brand.defaults.ts (packaging + identité). */
const DEFAULTS = {
  productName: 'GarageFlow',
  appId: 'com.garageflow.app',
  companyName: 'GarageFlow',
}

/** Transforme un nom d'affichage en identifiant npm valide (minuscules, tirets). */
function slugifyName(name) {
  const s = String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // enlève les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'app'
}

/** Extrait l'année d'un copyright existant, sinon renvoie `fallback`. */
function extractYear(copyright, fallback) {
  const m = /(\d{4})/.exec(String(copyright || ''))
  return m ? m[1] : String(fallback)
}

/**
 * Résout les valeurs de packaging depuis un JSON de marque (partiel) et l'env.
 * `env` doit être process.env ou équivalent. Retourne un objet plat déterministe.
 */
function resolveBrandForPackaging(jsonConfig, env, existingCopyright) {
  const j = jsonConfig || {}
  const jp = j.packaging || {}
  const e = env || {}
  const pick = (...vals) => {
    for (const v of vals) if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
    return undefined
  }
  const productName = pick(e.GF_BRAND_EXE_PRODUCT_NAME, jp.productName, e.GF_BRAND_PRODUCT_NAME, j.productName, DEFAULTS.productName)
  const appId = pick(e.GF_BRAND_APP_ID, jp.appId, DEFAULTS.appId)
  const companyName = pick(e.GF_BRAND_COMPANY, j.companyName, j.companyLegalName, DEFAULTS.companyName)
  const year = extractYear(existingCopyright, 2026)
  return {
    productName,
    appId,
    companyName,
    npmName: slugifyName(productName),
    author: companyName,
    copyright: `Copyright © ${year} ${companyName}`,
    shortcutName: productName,
  }
}

/** Applique les valeurs résolues à un objet package.json (retourne une COPIE patchée). */
function applyToPackageJson(pkg, r) {
  const next = JSON.parse(JSON.stringify(pkg))
  next.name = r.npmName
  next.productName = r.productName
  next.author = r.author
  next.build = next.build || {}
  next.build.appId = r.appId
  next.build.productName = r.productName
  next.build.copyright = r.copyright
  if (next.build.nsis && typeof next.build.nsis === 'object') {
    next.build.nsis.shortcutName = r.shortcutName
  }
  return next
}

/** Remplace l'appId dans app.setAppUserModelId('...') de electron/main.js. */
function applyToMainJs(source, appId) {
  return String(source).replace(
    /app\.setAppUserModelId\((['"])[^'"]*\1\)/,
    `app.setAppUserModelId('${appId}')`,
  )
}

// ── CLI ────────────────────────────────────────────────────────────────────
function readJsonConfig() {
  const envPath = (process.env.GF_BRAND_CONFIG || '').trim()
  const candidate = envPath && !envPath.startsWith('{') ? envPath : path.join(ROOT, 'brand.config.json')
  try {
    if (envPath && envPath.startsWith('{')) return JSON.parse(envPath)
    if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, 'utf8'))
  } catch (err) {
    console.warn('[apply-brand] brand.config.json ignoré (invalide):', err.message)
  }
  return {}
}

function main() {
  const check = process.argv.includes('--check')
  const pkgPath = path.join(ROOT, 'package.json')
  const mainPath = path.join(ROOT, 'electron', 'main.js')

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const resolved = resolveBrandForPackaging(readJsonConfig(), process.env, pkg.build && pkg.build.copyright)

  const nextPkg = applyToPackageJson(pkg, resolved)
  const pkgStr = JSON.stringify(pkg, null, 2) + '\n'
  const nextPkgStr = JSON.stringify(nextPkg, null, 2) + '\n'

  const mainSrc = fs.readFileSync(mainPath, 'utf8')
  const nextMain = applyToMainJs(mainSrc, resolved.appId)

  const pkgChanged = pkgStr !== nextPkgStr
  const mainChanged = mainSrc !== nextMain

  if (check) {
    if (pkgChanged || mainChanged) {
      console.error('[apply-brand --check] La marque de packaging n\'est PAS à jour :',
        [pkgChanged && 'package.json', mainChanged && 'electron/main.js'].filter(Boolean).join(', '))
      process.exit(1)
    }
    console.log('[apply-brand --check] Packaging à jour ✓')
    return
  }

  if (pkgChanged) fs.writeFileSync(pkgPath, nextPkgStr)
  if (mainChanged) fs.writeFileSync(mainPath, nextMain)
  console.log(`[apply-brand] Marque appliquée → productName="${resolved.productName}", appId="${resolved.appId}", author="${resolved.author}"`,
    (pkgChanged || mainChanged) ? '(fichiers mis à jour)' : '(déjà à jour)')
}

module.exports = { slugifyName, extractYear, resolveBrandForPackaging, applyToPackageJson, applyToMainJs, DEFAULTS }

if (require.main === module) main()
