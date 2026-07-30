import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

// Module CommonJS du process Electron (secret local par installation).
const secretMod = require('../../../electron/secret.js')
const { loadOrCreateInstallSecret, resolveMainSecret, isWeakSecret, looksValid } = secretMod

const HISTORICAL_SECRET = 'gf-electron-local-secret-2026-xK9mP3qR'

function mkTmpUserData(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-secret-'))
}

describe('electron/secret — secret local par installation', () => {
  let dirs: string[] = []

  beforeEach(() => { dirs = [] })
  afterEach(() => {
    for (const d of dirs) {
      try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  })

  function newInstall(): string {
    const d = mkTmpUserData()
    dirs.push(d)
    return d
  }

  it('1. deux installations distinctes génèrent deux secrets différents', () => {
    const a = loadOrCreateInstallSecret(newInstall())
    const b = loadOrCreateInstallSecret(newInstall())
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('2. une même installation conserve le secret après « redémarrage »', () => {
    const dir = newInstall()
    const first = loadOrCreateInstallSecret(dir)
    // Simule un redémarrage : nouvel appel, même dossier userData.
    const second = loadOrCreateInstallSecret(dir)
    expect(second).toBe(first)
  })

  it('3. aucune valeur par défaut / historique n’est jamais utilisée', () => {
    const s = loadOrCreateInstallSecret(newInstall())
    expect(s).not.toBe(HISTORICAL_SECRET)
    expect(isWeakSecret(s)).toBe(false)
    // Le secret historique doit être reconnu comme faible et rejeté.
    expect(isWeakSecret(HISTORICAL_SECRET)).toBe(true)
  })

  it('4. un fichier de secret corrompu/vide entraîne une régénération maîtrisée', () => {
    const dir = newInstall()
    const original = loadOrCreateInstallSecret(dir)
    const file = path.join(dir, secretMod.SECRET_FILE)

    // Corruption : contenu vide.
    fs.writeFileSync(file, '   ', 'utf8')
    const regenEmpty = loadOrCreateInstallSecret(dir)
    expect(regenEmpty).not.toBe('   ')
    expect(looksValid(regenEmpty)).toBe(true)

    // Corruption : caractères invalides.
    fs.writeFileSync(file, 'not a valid secret !!! with spaces', 'utf8')
    const regenBad = loadOrCreateInstallSecret(dir)
    expect(looksValid(regenBad)).toBe(true)
    expect(regenBad).not.toContain(' ')
    // Chaque régénération produit un secret fort (≠ des valeurs corrompues).
    expect(regenBad).not.toBe(original)
  })

  it('5. le fichier de secret reçoit des permissions restrictives (0600) hors Windows', () => {
    const dir = newInstall()
    loadOrCreateInstallSecret(dir)
    const file = path.join(dir, secretMod.SECRET_FILE)
    const mode = fs.statSync(file).mode & 0o777
    if (process.platform !== 'win32') {
      expect(mode).toBe(0o600)
    } else {
      expect(fs.existsSync(file)).toBe(true)
    }
  })

  it('6. resolveMainSecret respecte un NEXTAUTH_SECRET fort fourni (dev/.env)', () => {
    const strong = crypto.randomBytes(32).toString('base64url')
    const { secret, source } = resolveMainSecret(newInstall(), strong)
    expect(secret).toBe(strong)
    expect(source).toBe('env')
  })

  it('7. resolveMainSecret ignore un NEXTAUTH_SECRET faible/historique et bascule sur l’installation', () => {
    const dir = newInstall()
    const { secret, source } = resolveMainSecret(dir, HISTORICAL_SECRET)
    expect(secret).not.toBe(HISTORICAL_SECRET)
    expect(isWeakSecret(secret)).toBe(false)
    expect(source).toBe('install')
  })

  it('8. le secret n’apparaît pas dans les logs applicatifs (par construction)', () => {
    // Le module ne journalise jamais : il expose des fonctions PURES qui
    // retournent la valeur, l’appelant (main.js) journalise seulement la SOURCE.
    // On vérifie ici qu’aucune fonction du module n’écrit sur la console.
    const src = fs.readFileSync(path.join(__dirname, '../../../electron/secret.js'), 'utf8')
    expect(src.includes('console.log')).toBe(false)
    expect(src.includes('console.error')).toBe(false)
  })

  it('9. le secret historique n’est utilisé comme repli nulle part dans le code source', () => {
    // Interdit tout usage RUNTIME du secret historique : il ne doit apparaître
    // que dans des DÉNYLISTES de détection (isWeakSecret / KNOWN_*).
    const root = path.resolve(__dirname, '../../../')
    const runtimeFiles = [
      path.join(root, 'electron/main.js'),
      path.join(root, 'electron/secret.js'),
    ]
    for (const f of runtimeFiles) {
      const src = fs.readFileSync(f, 'utf8')
      // Aucun repli du type `?? 'gf-electron-local-secret...'`
      expect(src.includes(`?? '${HISTORICAL_SECRET}'`)).toBe(false)
      expect(src.includes(`|| '${HISTORICAL_SECRET}'`)).toBe(false)
      expect(src.includes(`?? "${HISTORICAL_SECRET}"`)).toBe(false)
    }
  })
})
