/**
 * GF31-AUD-012 — la clé de chiffrement SMTP doit exister sur le poste.
 *
 * `/api/email` refuse — à juste titre — d'enregistrer un mot de passe SMTP sans
 * `GF_SMTP_CIPHER_KEY` : « on refuse plutôt que de dégrader », 503. Mais
 * l'application packagée n'embarque aucun `.env`, et le bloc `env` transmis au
 * serveur Next.js interne (`electron/main.js`) ne fournissait pas cette variable.
 * Configurer un envoi d'e-mails était donc **impossible sur le poste**, quelle
 * que soit la manipulation de l'utilisateur.
 *
 * La clé est désormais résolue comme le secret de session : valeur
 * d'environnement forte si elle existe, sinon une clé propre à l'installation
 * conservée dans `userData`. Le point critique est la **stabilité** : une clé
 * régénérée à chaque démarrage rendrait tous les mots de passe déjà enregistrés
 * définitivement indéchiffrables (§105).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const secretMod = require('../../../electron/secret.js')
const { resolveSmtpCipherKey, SMTP_CIPHER_KEY_FILE, SECRET_FILE, isWeakSecret } = secretMod

// Le module de chiffrement RÉEL utilisé par /api/email — aucun simulacre.
import { encryptSecret, decryptSecret, isEncryptedSecret } from '@/lib/security/secret-cipher'

let dirs: string[] = []
const envInitial = process.env.GF_SMTP_CIPHER_KEY

function nouvelleInstallation(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-smtp-key-'))
  dirs.push(d)
  return d
}

beforeEach(() => { dirs = [] })
afterEach(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  if (envInitial === undefined) delete process.env.GF_SMTP_CIPHER_KEY
  else process.env.GF_SMTP_CIPHER_KEY = envInitial
})

describe('GF31-AUD-012 — clé de chiffrement SMTP par installation', () => {
  it('génère une clé forte quand aucune valeur d’environnement n’est fournie', () => {
    const { key, source } = resolveSmtpCipherKey(nouvelleInstallation(), undefined)
    expect(source).toBe('install')
    expect(isWeakSecret(key)).toBe(false)
  })

  it('est STABLE d’un démarrage à l’autre — sinon les mots de passe deviennent illisibles', () => {
    const dir = nouvelleInstallation()
    const a = resolveSmtpCipherKey(dir, undefined).key
    const b = resolveSmtpCipherKey(dir, undefined).key
    expect(b).toBe(a)
  })

  it('deux installations distinctes obtiennent des clés différentes', () => {
    const a = resolveSmtpCipherKey(nouvelleInstallation(), undefined).key
    const b = resolveSmtpCipherKey(nouvelleInstallation(), undefined).key
    expect(a).not.toBe(b)
  })

  it('respecte une valeur d’environnement FORTE (déploiement serveur)', () => {
    const fournie = 'K'.repeat(20) + Buffer.from('cle-serveur-forte-32-octets!!').toString('base64')
    const { key, source } = resolveSmtpCipherKey(nouvelleInstallation(), fournie)
    expect(source).toBe('env')
    expect(key).toBe(fournie)
  })

  it('ignore une valeur d’environnement faible et retombe sur la clé d’installation', () => {
    const { key, source } = resolveSmtpCipherKey(nouvelleInstallation(), 'changeme')
    expect(source).toBe('install')
    expect(key).not.toBe('changeme')
  })

  it('n’écrase PAS le secret de session : deux fichiers distincts', () => {
    const dir = nouvelleInstallation()
    const session = secretMod.loadOrCreateInstallSecret(dir)
    const smtp = resolveSmtpCipherKey(dir, undefined).key

    expect(SMTP_CIPHER_KEY_FILE).not.toBe(SECRET_FILE)
    expect(fs.existsSync(path.join(dir, SECRET_FILE))).toBe(true)
    expect(fs.existsSync(path.join(dir, SMTP_CIPHER_KEY_FILE))).toBe(true)
    // Deux usages distincts ⇒ deux valeurs distinctes : roter l'une ne doit
    // jamais invalider l'autre.
    expect(smtp).not.toBe(session)
  })

  it('la clé produite chiffre et déchiffre RÉELLEMENT un mot de passe SMTP', () => {
    const { key } = resolveSmtpCipherKey(nouvelleInstallation(), undefined)
    process.env.GF_SMTP_CIPHER_KEY = key

    const motDePasse = 'mot-de-passe-smtp-du-garage-2026'
    const chiffre = encryptSecret(motDePasse)

    expect(isEncryptedSecret(chiffre)).toBe(true)
    expect(chiffre).not.toContain(motDePasse)
    expect(decryptSecret(chiffre)).toBe(motDePasse)
  })
})

describe('GF31-AUD-012 — la clé est bien injectée dans le serveur du poste', () => {
  it('electron/main.js transmet GF_SMTP_CIPHER_KEY au serveur Next.js', () => {
    // Contrôle à la SOURCE : c'est l'oubli dans ce bloc `env` qui constituait le
    // défaut. Un test sur `resolveSmtpCipherKey` seul ne l'aurait pas vu.
    const main = fs.readFileSync(path.resolve(__dirname, '../../../electron/main.js'), 'utf8')
    const i = main.indexOf('const env = {')
    expect(i).toBeGreaterThan(-1)
    const bloc = main.slice(i, main.indexOf('}', main.indexOf('NODE_ENV', i)))
    expect(bloc).toContain('GF_SMTP_CIPHER_KEY')
  })
})
