/**
 * Intégrité — cause racine asar + diagnostics + matrice A–G (mission faux positif).
 *
 * CAUSE RACINE corrigée : dans un build packagé, Electron patche `fs` et
 * présente app.asar comme un répertoire virtuel → `fs.readFileSync(app.asar)`
 * jette EISDIR (non transitoire) → « unreadable » → « installation corrompue »
 * à CHAQUE lancement, installation intacte. Correctif : toutes les E/S
 * d'intégrité passent par `original-fs` (fs non patché) quand il existe.
 *
 * Matrice exigée :
 *   A intact → autorisé ; B app.asar modifié → refusé ; C fichier protégé
 *   supprimé → refusé ; D fichier MUTABLE modifié → autorisé ; D bis code
 *   applicatif de standalone/ modifié → refusé ; E manifeste modifié → refusé ;
 *   F manifeste invalide → refusé ; G build fraîchement généré
 *   (dist/win-unpacked réel, si présent) → aucun échec.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import * as integrity from '../../electron/integrity.js'

const I = integrity as any
let dir: string

function makeResources() {
  dir = mkdtempSync(join(tmpdir(), 'gf-integ-diag-'))
  writeFileSync(join(dir, 'app.asar'), Buffer.from('CODE APPLICATIF EMPAQUETÉ v1'))
  mkdirSync(join(dir, 'keys'), { recursive: true })
  writeFileSync(join(dir, 'keys', 'public.pem'), '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n')
  mkdirSync(join(dir, 'prisma'), { recursive: true })
  writeFileSync(join(dir, 'prisma', 'schema.prisma'), 'datasource db { provider = "sqlite" }')
  mkdirSync(join(dir, 'app.asar.unpacked', 'node_modules'), { recursive: true })
  writeFileSync(join(dir, 'app.asar.unpacked', 'node_modules', 'engine.node'), Buffer.from([1, 2, 3]))
  // Fichiers MUTABLES légitimes présents dans resources — ne doivent JAMAIS être couverts.
  writeFileSync(join(dir, 'prisma', 'template.db'), Buffer.from('sqlite template'))
  writeFileSync(join(dir, 'app-update.yml'), 'provider: generic\n')
  // Le serveur Next empaqueté (extraResources : .next/standalone → standalone/).
  // Son CODE est immuable et doit être couvert ; ce qui l'entoure ne l'est pas.
  mkdirSync(join(dir, 'standalone', '.next', 'server', 'app', 'api'), { recursive: true })
  mkdirSync(join(dir, 'standalone', 'prisma'), { recursive: true })
  mkdirSync(join(dir, 'standalone', 'node_modules', 'dep'), { recursive: true })
  writeFileSync(join(dir, 'standalone', 'server.js'), 'console.log("next")')
  writeFileSync(join(dir, 'standalone', '.next', 'server', 'app', 'api', 'route.js'), 'montants()')
  writeFileSync(join(dir, 'standalone', '.next', 'server', 'app', 'page.html'), '<html>ISR</html>')
  writeFileSync(join(dir, 'standalone', 'prisma', 'garageflow-template.db'), Buffer.from('sqlite template'))
  writeFileSync(join(dir, 'standalone', 'node_modules', 'dep', 'index.js'), 'dep')
  I.writeManifest(dir, '1.0.0')
}

beforeEach(() => makeResources())
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('cause racine — fs patché asar vs original-fs', () => {
  it('resolveRawFs préfère original-fs quand le module existe (Electron)', () => {
    const marker = { readFileSync: () => Buffer.from('raw') }
    expect(I.resolveRawFs((n: string) => { if (n === 'original-fs') return marker; throw new Error('nope') })).toBe(marker)
  })
  it('resolveRawFs retombe sur fs sous Node pur (module absent)', () => {
    const nodeFs = require('node:fs')
    expect(I.resolveRawFs(() => { throw new Error('Cannot find module') })).toBe(nodeFs)
  })
  it('reproduction du symptôme AVANT correctif : un lecteur façon fs-patché (EISDIR sur app.asar) → unreadable → blocage', () => {
    // C'est EXACTEMENT ce que produisait le fs patché d'Electron sur app.asar.
    const io = {
      sleep: () => {}, baseDelayMs: 0,
      readFile: (p: string) => {
        if (String(p).endsWith('app.asar')) { const e: NodeJS.ErrnoException = new Error('EISDIR: illegal operation on a directory, read'); e.code = 'EISDIR'; throw e }
        return readFileSync(p)
      },
    }
    const r = I.verify(dir, { io })
    expect(r.ok).toBe(false)
    expect(r.details.some((d: any) => d.rel === 'app.asar' && d.reason === 'UNREADABLE')).toBe(true)
    // Avec le correctif, le chemin par défaut passe par RAW_FS (original-fs sous
    // Electron) → l'app.asar réel est lu en octets → cas nominal du TEST A.
  })
})

describe('matrice A–G', () => {
  it('A — installation intacte → démarrage autorisé (ok, 0 violation)', () => {
    const r = I.verify(dir)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
    expect(r.checked).toBeGreaterThanOrEqual(4)
  })

  it('B — app.asar modifié → refusé avec diagnostic complet (HASH_MISMATCH, hashes + tailles)', () => {
    writeFileSync(join(dir, 'app.asar'), Buffer.from('CODE APPLICATIF ALTÉRÉ v2')) // même pas la même taille ? forcer même taille :
    // même taille que l'original pour prouver le HASH_MISMATCH (pas seulement SIZE)
    writeFileSync(join(dir, 'app.asar'), Buffer.from('CODE APPLICATIF EMPAQUETÉ v2'))
    const r = I.verify(dir)
    expect(r.ok).toBe(false)
    const d = r.details.find((x: any) => x.rel === 'app.asar')
    expect(d.reason).toBe('HASH_MISMATCH')
    expect(d.expectedSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(d.actualSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(d.actualSha256).not.toBe(d.expectedSha256)
    expect(d.absPath).toContain('app.asar')
  })

  it('B bis — taille différente → SIZE_MISMATCH (tailles attendue/réelle rapportées)', () => {
    writeFileSync(join(dir, 'app.asar'), Buffer.from('COURT'))
    const r = I.verify(dir)
    const d = r.details.find((x: any) => x.rel === 'app.asar')
    expect(d.reason).toBe('SIZE_MISMATCH')
    expect(d.expectedSize).toBeGreaterThan(0)
    expect(d.actualSize).toBe(5)
  })

  it('C — fichier protégé supprimé → refusé (MISSING)', () => {
    rmSync(join(dir, 'keys', 'public.pem'))
    const r = I.verify(dir)
    expect(r.ok).toBe(false)
    const d = r.details.find((x: any) => x.rel === 'keys/public.pem')
    expect(d.reason).toBe('MISSING')
  })

  it('D — fichiers MUTABLES modifiés (db template, app-update.yml, ISR, log) → démarrage AUTORISÉ', () => {
    // La frontière ne passe PAS entre app.asar et standalone/ : elle passe entre
    // ce qui est figé par la construction et ce que l'exécution réécrit. Le code
    // applicatif empaqueté dans standalone/ (routes d'API, règles de facturation,
    // contrôles d'autorisation) est immuable et donc couvert ; la base, le cache
    // ISR et les dépendances tierces ne le sont pas.
    const covered = I.criticalFiles(dir).map((f: any) => f.rel)
    for (const rel of covered) {
      expect(rel).not.toMatch(/\.db$|\.env|app-update\.yml|\.log$/)
      // Dans standalone/, seul le JavaScript produit par le build est couvert :
      // ni la base, ni les node_modules (135 Mo), ni les pages ISR réécrites à
      // chaud sous .next/server (.html, .rsc, .meta).
      if (rel.startsWith('standalone/')) {
        expect(rel).toMatch(/\.js$/)
        expect(rel).not.toMatch(/^standalone\/(node_modules|prisma)\//)
      }
    }
    // …et fonctionnelle : les modifier ne déclenche RIEN.
    writeFileSync(join(dir, 'prisma', 'template.db'), Buffer.from('sqlite template MODIFIÉ'))
    writeFileSync(join(dir, 'app-update.yml'), 'provider: generic\nmodifié: oui\n')
    writeFileSync(join(dir, 'standalone', '.next', 'server', 'app', 'page.html'), '<html>ISR régénéré</html>')
    writeFileSync(join(dir, 'standalone', 'prisma', 'garageflow-template.db'), Buffer.from('sqlite MODIFIÉ'))
    writeFileSync(join(dir, 'standalone', 'node_modules', 'dep', 'index.js'), 'dep patché')
    writeFileSync(join(dir, 'garageflow.log'), 'log runtime\n')
    const r = I.verify(dir)
    expect(r.ok).toBe(true)
  })

  it("D bis — le CODE applicatif de standalone/ est couvert, et le modifier est REFUSÉ", () => {
    const covered = I.criticalFiles(dir).map((f: any) => f.rel)
    expect(covered).toContain('standalone/server.js')
    expect(covered).toContain('standalone/.next/server/app/api/route.js')
    // Un attaquant réécrit la route qui décide des montants : détecté.
    writeFileSync(join(dir, 'standalone', '.next', 'server', 'app', 'api', 'route.js'), 'montants_truques()')
    const r = I.verify(dir)
    expect(r.ok).toBe(false)
    expect(r.violations).toContain('modified:standalone/.next/server/app/api/route.js')
  })

  it('E — manifeste MODIFIÉ (hash falsifié pour couvrir une altération) → refusé (MANIFEST_MAC_INVALID)', () => {
    const mPath = join(dir, I.MANIFEST_NAME)
    const m = JSON.parse(readFileSync(mPath, 'utf8'))
    m.files[0].sha256 = 'a'.repeat(64) // l'attaquant réécrit l'empreinte attendue
    writeFileSync(mPath, JSON.stringify(m, null, 2))
    const r = I.verify(dir)
    expect(r.ok).toBe(false)
    expect(r.details[0].reason).toBe('MANIFEST_MAC_INVALID')
  })

  it('F — manifeste INVALIDE (JSON corrompu) → refusé (MANIFEST_INVALID)', () => {
    writeFileSync(join(dir, I.MANIFEST_NAME), '{corrompu…')
    const r = I.verify(dir)
    expect(r.ok).toBe(false)
    expect(r.details[0].reason).toBe('MANIFEST_INVALID')
  })

  // Hacher le vrai app.asar (~536 Mo) prend plusieurs secondes → timeout élargi.
  it('G — build fraîchement généré (dist/win-unpacked réel) → aucun échec (sauté si absent)', { timeout: 120_000 }, () => {
    const real = resolve(__dirname, '../../dist/win-unpacked/resources')
    if (!existsSync(join(real, I.MANIFEST_NAME))) {
      console.warn('[skip] dist/win-unpacked absent — lancez npm run dist pour ce test')
      return
    }
    const r = I.verify(real)
    expect(r.ok, JSON.stringify(r.details ?? [], null, 1)).toBe(true)
    expect(r.checked).toBeGreaterThanOrEqual(1)
  })
})
