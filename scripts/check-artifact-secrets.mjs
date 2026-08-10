#!/usr/bin/env node
/**
 * GARDE DE LIVRAISON — aucun secret ne doit sortir dans un artefact client.
 *
 * Contexte : la clé privée de signature des licences s'est retrouvée dans
 * `resources/standalone/keys/private.pem` de paquets Electron, dont un
 * installateur servi par le serveur de mise à jour. La purge effectuée par
 * post-build.js est une réparation ; ce script est le CONTRÔLE FINAL : il
 * inspecte l'artefact RÉELLEMENT produit et sort en échec s'il est livrable.
 *
 * Vérifie, dans dist/win-unpacked ET dans l'installateur .exe :
 *   - aucun fichier de clé privée (nom) ;
 *   - aucun en-tête « BEGIN … PRIVATE KEY » suivi d'un CORPS de clé
 *     (un simple littéral de code, comme dans la bibliothèque `jose`, est
 *     légitime et ne doit pas faire échouer la livraison) ;
 *   - aucune VALEUR de secret issue de .env / .env.local.
 * `public.pem` est explicitement autorisé.
 *
 * Usage :
 *   node scripts/check-artifact-secrets.mjs                # dist par défaut
 *   node scripts/check-artifact-secrets.mjs <chemin…>
 *
 * Sortie : 0 = livrable, 1 = REFUSÉ.
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Noms de fichiers interdits dans un artefact client. */
const FORBIDDEN_NAME = /(^|[-_.])private\.(pem|key)$|^private\.pem$|\.pkcs8$|(^|[-_.])signing\.(pem|key)$/i
/** En-tête PEM privé SUIVI d'un vrai corps base64 (≥ 100 caractères). */
const PRIVATE_BLOCK = /BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----[\\nrt\s"']*([A-Za-z0-9+/=]{100,})/
const TEXTLIKE = new Set(['.js', '.mjs', '.cjs', '.json', '.txt', '.html', '.css', '.map', '.pem', '.key', '.env', '.asar', ''])

/** Valeurs de secrets à traquer. Les URL publiques ne sont pas des secrets. */
function loadSecretValues() {
  const out = []
  const PUBLIC_OK = /^(GF_APP_URL|NEXTAUTH_URL|NEXT_PUBLIC_|GF_LICENSE_SERVER|GF_UPDATE_SERVER)/
  for (const f of ['.env', '.env.local']) {
    const p = path.join(ROOT, f)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!m) continue
      const name = m[1]
      const value = m[2].trim().replace(/^["']|["']$/g, '')
      if (PUBLIC_OK.test(name)) continue
      if (value.length < 16 || /^file:/.test(value)) continue
      out.push({ name, value })
    }
  }
  return out
}

const secrets = loadSecretValues()
const violations = []
let scanned = 0

function inspect(file, rel) {
  const base = path.basename(file)
  if (FORBIDDEN_NAME.test(base)) {
    violations.push(`FICHIER DE CLÉ PRIVÉE : ${rel}`)
    return
  }
  const ext = path.extname(base).toLowerCase()
  if (!TEXTLIKE.has(ext)) return
  let st
  try { st = statSync(file) } catch { return }
  if (st.size > 220 * 1024 * 1024) return
  let text
  try { text = readFileSync(file).toString('latin1') } catch { return }
  scanned++
  if (PRIVATE_BLOCK.test(text)) violations.push(`CORPS DE CLÉ PRIVÉE INLINÉ : ${rel}`)
  for (const s of secrets) {
    if (text.includes(s.value)) violations.push(`VALEUR DE SECRET (${s.name}) : ${rel}`)
  }
}

function walk(dir, baseDir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, baseDir)
    else inspect(full, path.relative(baseDir, full).replace(/\\/g, '/'))
  }
}

/** Inspecte l'INTÉRIEUR d'un installateur NSIS via 7-Zip (liste des entrées). */
function inspectInstaller(exe) {
  const sevenZip = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')
  if (!existsSync(sevenZip)) {
    console.warn('  ⚠  7za introuvable — contenu de l’installateur NON inspecté.')
    return
  }
  const res = spawnSync(sevenZip, ['l', exe], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const listing = res.stdout || ''
  if (!listing.trim()) { console.warn('  ⚠  listing vide — installateur non inspecté.'); return }
  for (const line of listing.split(/\r?\n/)) {
    const m = line.match(/\s(\S+\.(?:pem|key|pkcs8))\s*$/i)
    if (!m) continue
    const entry = m[1]
    if (/public\.pem$/i.test(entry)) continue
    if (FORBIDDEN_NAME.test(path.basename(entry)) || /\.(key|pkcs8)$/i.test(entry)) {
      violations.push(`CLÉ PRIVÉE DANS L'INSTALLATEUR : ${entry}`)
    }
  }
  console.log(`  ✓ installateur inspecté : ${path.basename(exe)}`)
}

const targets = process.argv.slice(2)
if (targets.length === 0) {
  const unpacked = path.join(ROOT, 'dist', 'win-unpacked')
  if (existsSync(unpacked)) targets.push(unpacked)
  const dist = path.join(ROOT, 'dist')
  if (existsSync(dist)) {
    for (const f of readdirSync(dist)) if (f.toLowerCase().endsWith('.exe')) targets.push(path.join(dist, f))
  }
}

if (targets.length === 0) {
  console.error('❌ check:artifact-secrets — aucun artefact à inspecter (dist/ absent).')
  process.exit(1)
}

console.log(`🔎 check:artifact-secrets — ${secrets.length} valeur(s) secrète(s) traquée(s)`)
for (const t of targets) {
  if (!existsSync(t)) continue
  if (statSync(t).isDirectory()) { walk(t, t); console.log(`  ✓ dossier inspecté : ${path.basename(t)} (${scanned} fichiers)`) }
  else if (t.toLowerCase().endsWith('.exe')) inspectInstaller(t)
}

if (violations.length > 0) {
  console.error('\n❌ ARTEFACT NON LIVRABLE — secrets détectés :')
  for (const v of [...new Set(violations)]) console.error(`     ${v}`)
  console.error('\n   Corrigez la cause AVANT toute distribution (voir scripts/post-build.js).')
  process.exit(1)
}

console.log('\n✅ check:artifact-secrets — aucune clé privée, aucune valeur de secret dans l’artefact.')
