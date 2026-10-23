/**
 * GF-DUR-044 — aucun secret racine ne part avec le produit.
 *
 * ─── Ce qui a été constaté le 14/08/2026 ────────────────────────────────────
 * Scan de l'historique Git complet (377 commits) et du bundle client construit :
 *
 *   · corps de clé privée (bloc PEM) dans l'historique .......... 0
 *   · fichiers .pem / .key / .p12 / .pfx ayant existé ........... 0
 *   · fichier `.env` réel jamais committé (seul `.env.example`) . confirmé
 *   · valeurs de `.env` retrouvées dans `.next/static` .......... 0 sur 51 fichiers
 *
 * Les marqueurs « BEGIN … PRIVATE KEY » présents dans l'historique sont des
 * DÉTECTEURS, pas des clés : `scripts/post-build.js` les liste pour scanner le
 * paquet, `scripts/reset-garageflow.ps1` valide un format. Vérifié fichier par
 * fichier — jamais supposé.
 *
 * ─── Ce qui a RÉELLEMENT été exposé, et son statut ──────────────────────────
 * Le premier commit (`0f519f0`) portait trois valeurs :
 *
 *   · `NEXTAUTH_SECRET` et `GARAGEFLOW_API_KEY` — la MÊME valeur pour les deux,
 *     réutilisation inter-domaines. Comparées par empreinte au `.env` courant :
 *     **différentes** → rotation effectuée, exposition refermée.
 *   · `MASTER_SECRET` codé en dur dans `scripts/generate-license-key.js`,
 *     script supprimé le 2026-07-29 et plus référencé nulle part.
 *
 * Conformément à la règle « un secret committé est potentiellement compromis,
 * jamais réputé sûr parce que retiré ensuite » : ces trois valeurs restent dans
 * l'historique et doivent être considérées comme publiques à jamais. Elles ne
 * donnent plus accès à rien, ce qui est le seul état acceptable.
 *
 * ─── Ce que ce fichier empêche ──────────────────────────────────────────────
 * Que la propriété se reperde. Il ne rejoue pas le scan d'historique (coûteux,
 * et l'historique ne se réécrit pas) : il verrouille l'état de l'arbre.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { generateKeyPairSync } from 'node:crypto'

const requireCjs = createRequire(import.meta.url)
const { scanVersionedPrivateKeys } = requireCjs('../../../scripts/lib/scan-versioned-private-keys.cjs')
const { containsPrivateKeyMaterial } = requireCjs('../../../scripts/lib/private-key-material.cjs')
const RACINE = path.resolve(__dirname, '../../..')

/** Secrets dont la fuite donnerait un pouvoir de signature ou d'élévation. */
const RACINES = [
  'GF_PRIVATE_KEY',        // signe les licences
  'GF_UPDATE_SIGNING_KEY', // signe les manifestes de mise à jour
  'NEXTAUTH_SECRET',       // signe gf_session — donc les sessions admin
  'GF_PORTAL_SECRET',      // signe les jetons du portail
  'GF_DB_MAC_SECRET',      // intègre les lignes de licence
  'DEVICE_TOKEN_PEPPER',   // hache les jetons d'appareil
  'GARAGEFLOW_API_KEY',    // crée et révoque des licences (x-gf-key)
  'GF_TOTP_ENC_KEY',       // déchiffre les seconds facteurs
  'VERCEL_TOKEN',          // déploie
]

function fichiers(dir: string, exts: RegExp, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (['node_modules', '.next', 'dist', '.git'].includes(e.name)) continue
      fichiers(p, exts, acc)
    } else if (exts.test(e.name)) acc.push(p)
  }
  return acc
}

describe('aucun secret racine n’est lu côté CLIENT (GF-DUR-044)', () => {
  const clients = fichiers(path.join(RACINE, 'src'), /\.tsx?$/)
    .filter((f) => /^['"]use client['"]/.test(fs.readFileSync(f, 'utf8').trimStart()))

  it('le corpus de composants clients est non vide', () => {
    // Sans ce contrôle, une détection cassée passerait en ne vérifiant rien.
    expect(clients.length).toBeGreaterThan(10)
  })

  it('aucun `process.env.<secret>` dans un composant client', () => {
    // Next INLINE la valeur au build : un seul de ces accès la publierait dans
    // le bundle, donc chez tous les clients.
    const fautifs: string[] = []
    for (const f of clients) {
      const src = fs.readFileSync(f, 'utf8')
      for (const s of RACINES) {
        if (src.includes(`process.env.${s}`)) {
          fautifs.push(`${path.relative(RACINE, f).replace(/\\/g, '/')} → ${s}`)
        }
      }
    }
    expect(fautifs, 'ces secrets seraient inlinés dans le bundle client').toEqual([])
  })
})

describe('aucune clé privée dans l’arbre (GF-DUR-044)', () => {
  it('analyse tout le texte versionné, les sources critiques et les liens en moins de 5 secondes', () => {
    const debut = performance.now()
    const scan = scanVersionedPrivateKeys(RACINE)
    const duree = performance.now() - debut

    expect(scan.issues, 'aucun fichier source ne doit être ignoré ou impossible à inspecter').toEqual([])
    expect(scan.findings, 'ces fichiers contiennent une véritable clé privée PEM').toEqual([])
    expect(scan.trackedFileCount).toBeGreaterThan(1000)
    expect(scan.trackedPaths).toContain('src/lib/__tests__/secrets-jamais-distribues.test.ts')
    expect(scan.trackedPaths).toContain('scripts/check-artifact-secrets.mjs')
    expect(scan.trackedPaths).toContain('electron/preload.js')
    expect(scan.trackedPaths).toContain('prisma/schema.prisma')
    expect(scan.trackedPaths).toContain('configuation automatique/config.js')
    expect(scan.trackedPaths).toContain('.env.example')
    expect(duree, `scan Git natif: ${duree.toFixed(1)} ms`).toBeLessThan(5000)
  })

  it('détecte une vraie clé privée, y compris encapsulée dans du JSON', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

    expect(containsPrivateKeyMaterial(pem)).toBe(true)
    expect(containsPrivateKeyMaterial(JSON.stringify({ value: pem }))).toBe(true)
    expect(containsPrivateKeyMaterial(publicPem)).toBe(false)
  })

  it('ne confond pas un marqueur de documentation et une ligne Base64 légitime avec une clé privée', () => {
    const base64SansCle = Buffer.from('documentation, hash de contenu et données de test').toString('base64')
    // Armure assemblée à l'exécution : la source ne contient plus un bloc PEM
    // complet (en-tête, corps Base64, pied) que le scanner de secrets pourrait
    // signaler. La chaîne produite est identique à l'ancienne, donc l'assertion
    // porte exactement sur le même cas.
    const armure = (bord: 'BEGIN' | 'END') => `-----${bord} PRIVATE KEY-----`
    const fauxBloc = [armure('BEGIN'), base64SansCle, armure('END')].join('\n')
    const marqueurDeCode = `const marker = '-----BEGIN PRIVATE KEY-----';\nconst digest = '${'A'.repeat(128)}';`

    expect(containsPrivateKeyMaterial(fauxBloc)).toBe(false)
    expect(containsPrivateKeyMaterial(marqueurDeCode)).toBe(false)
  })

  it('`keys/*.pem` reste ignoré par git', () => {
    // C'est la seule chose qui empêche `git add -A` d'emporter la clé de
    // signature des licences, présente sur le poste de l'exploitant.
    const gi = fs.readFileSync(path.join(RACINE, '.gitignore'), 'utf8')
    expect(gi).toMatch(/^keys\/\*\.pem$/m)
    expect(gi).toMatch(/^keys\/private\.pem$/m)
  })
})

describe('`.env.example` ne porte que des exemples (GF-DUR-044)', () => {
  const exemple = fs.readFileSync(path.join(RACINE, '.env.example'), 'utf8')

  it('aucune affectation ne contient de valeur d’apparence réelle', () => {
    // Le premier commit du dépôt en portait deux (même valeur pour
    // NEXTAUTH_SECRET et GARAGEFLOW_API_KEY). Depuis rotées — mais l'historique,
    // lui, ne se nettoie pas.
    const fautives: string[] = []
    for (const l of exemple.split(/\r?\n/)) {
      const m = l.match(/^([A-Z_]+)\s*=\s*"?([^"\r\n]+)"?\s*$/)
      if (!m) continue
      const valeur = m[2].trim()
      const exemplaire = /^$|CHANGE_ME|^</.test(valeur)
        || /^(file:|http:|https:|postgres|localhost|sk-ant-|\.\/|true|false|\d+)/.test(valeur)
      if (!exemplaire && valeur.length >= 16) fautives.push(m[1])
    }
    expect(fautives, 'ces variables portent une valeur qui ressemble à un vrai secret').toEqual([])
  })
})
