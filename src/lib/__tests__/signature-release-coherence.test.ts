/**
 * GF-013 — le signeur de manifeste acceptait trois identités contradictoires.
 *
 * ─── Le scénario qu'il rendait possible ─────────────────────────────────────
 * Release 1.2.0. L'opérateur signe l'installeur 1.1.0 encore présent dans
 * `dist/` (rebuild oublié, ou dossier non purgé) avec `--version 1.2.0`. Le
 * manifeste produit est cryptographiquement valide et son empreinte correspond
 * bien aux octets servis : CHAQUE poste l'accepte (1.2.0 > 1.1.0), télécharge,
 * vérifie l'empreinte, lance l'installeur et quitte. Au redémarrage,
 * `app.getVersion()` vaut toujours 1.1.0 : la vérification horaire re-propose
 * 1.2.0, tout repasse, l'installeur se relance.
 *
 * Boucle sans fin sur tout le parc, l'application se fermant à chaque tentative,
 * et aucun recours logiciel côté poste. Le script contrôlait pourtant
 * l'existence du fichier, le format SemVer et le domaine de l'URL — mais jamais
 * leur CONCORDANCE, et ne lisait même pas `package.json`.
 *
 * Ce test exécute le VRAI script, en sous-processus, sur des fichiers réels.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const SCRIPT = path.join(RACINE, 'scripts/sign-release-manifest.mjs')
const VERSION = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8')).version as string

let dossier = ''
let clePrivee = ''
let clePublique = ''

/**
 * Lance le script ; renvoie code de sortie et sorties RÉUNIES (les refus
 * s'écrivent sur la sortie d'erreur, les succès sur la sortie standard, et un
 * avertissement d'incohérence acceptée sur la sortie d'erreur d'un succès).
 */
function signer(args: string[]): { code: number; sortie: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: RACINE,
    env: { ...process.env, GF_UPDATE_SIGNING_KEY: clePrivee },
    encoding: 'utf8',
  })
  return { code: r.status ?? 1, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const installeur = (nom: string) => {
  const p = path.join(dossier, nom)
  fs.writeFileSync(p, Buffer.from(`installeur factice ${nom}`))
  return p
}

const URL_OK = (v: string) => `https://api.garageflows.fr/downloads/GarageFlows-Setup-${v}.exe`

beforeAll(() => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-release-'))
  const paire = crypto.generateKeyPairSync('ed25519')
  clePrivee = paire.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  clePublique = paire.publicKey.export({ type: 'spki', format: 'pem' }).toString()
})

afterAll(() => { fs.rmSync(dossier, { recursive: true, force: true }) })

describe('signature de release — cohérence des identités (GF-013)', () => {
  it('`--help` explique l’usage et sort proprement', () => {
    const { code, sortie } = signer(['--help'])
    expect(code).toBe(0)
    expect(sortie).toContain('--file')
    expect(sortie).toContain('--version')
    expect(sortie).toContain('--download-url')
    expect(sortie, 'l’aide doit dire ce que les contrôles évitent').toMatch(/boucle/i)
  })

  it('REFUSE de signer un installeur dont le nom porte une autre version', () => {
    const f = installeur(`GarageFlows Setup ${VERSION}.exe`)
    const { code, sortie } = signer(['--file', f, '--version', '9.9.9', '--download-url', URL_OK('9.9.9')])
    expect(code, 'c’est exactement le scénario qui met le parc en boucle').toBe(1)
    expect(sortie).toMatch(/9\.9\.9/)
    expect(fs.existsSync(f.replace(/\.exe$/, '.manifest.json')), 'aucun manifeste ne doit être écrit').toBe(false)
  })

  it('REFUSE une version qui diverge de package.json', () => {
    const f = installeur('GarageFlows Setup 9.9.9.exe')
    const { code, sortie } = signer(['--file', f, '--version', '9.9.9', '--download-url', URL_OK('9.9.9')])
    expect(code).toBe(1)
    expect(sortie).toMatch(/package\.json/)
  })

  it('REFUSE une URL de téléchargement qui désigne une autre version', () => {
    const f = installeur(`GarageFlows Setup ${VERSION}.exe`)
    const { code, sortie } = signer(['--file', f, '--version', VERSION, '--download-url', URL_OK('2.0.0')])
    expect(code).toBe(1)
    expect(sortie).toMatch(/URL de téléchargement/i)
  })

  it('REFUSE une extension incohérente avec la plateforme', () => {
    const f = installeur(`GarageFlows-${VERSION}.dmg`)
    const { code, sortie } = signer([
      '--file', f, '--version', VERSION, '--platform', 'win32', '--download-url', URL_OK(VERSION),
    ])
    expect(code).toBe(1)
    expect(sortie).toMatch(/extension/i)
  })

  it('REFUSE un domaine hors de la liste blanche des postes', () => {
    const f = installeur(`GarageFlows Setup ${VERSION}.exe`)
    const { code, sortie } = signer([
      '--file', f, '--version', VERSION,
      '--download-url', `https://exemple.test/GarageFlows-Setup-${VERSION}.exe`,
    ])
    expect(code).toBe(1)
    expect(sortie).toMatch(/liste blanche|Domaine/i)
  })

  it('SIGNE une release cohérente, et la signature est vérifiable', () => {
    const f = installeur(`GarageFlows Setup ${VERSION}.exe`)
    const sortieManifeste = path.join(dossier, 'coherent.manifest.json')
    const { code, sortie } = signer([
      '--file', f, '--version', VERSION, '--download-url', URL_OK(VERSION), '--out', sortieManifeste,
    ])
    expect(code, sortie).toBe(0)
    expect(fs.existsSync(sortieManifeste)).toBe(true)

    const signé = JSON.parse(fs.readFileSync(sortieManifeste, 'utf8'))
    expect(signé.manifest.version).toBe(VERSION)
    expect(signé.manifest.fileName).toBe(path.basename(f))
    expect(signé.manifest.sha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'))

    // Sérialisation canonique — la MÊME que celle du poste (tri des clés).
    const trier = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(trier)
        : (v && typeof v === 'object')
          ? Object.keys(v as object).sort().reduce((acc: Record<string, unknown>, k) => {
              acc[k] = trier((v as Record<string, unknown>)[k]); return acc
            }, {})
          : v
    const valide = crypto.verify(
      null,
      Buffer.from(JSON.stringify(trier(signé.manifest)), 'utf8'),
      crypto.createPublicKey(clePublique),
      Buffer.from(signé.signature, 'base64'),
    )
    expect(valide, 'la signature doit être vérifiable par la clé publique correspondante').toBe(true)
  })

  it('`--allow-mismatch` laisse passer, mais le dit bruyamment', () => {
    // Un correctif d'urgence peut légitimement porter un autre nom : la sortie
    // reste possible, jamais silencieuse.
    const f = installeur('correctif-urgent.exe')
    const sortieManifeste = path.join(dossier, 'forcee.manifest.json')
    const { code, sortie } = signer([
      '--file', f, '--version', VERSION, '--download-url', URL_OK(VERSION),
      '--out', sortieManifeste, '--allow-mismatch',
    ])
    expect(code, sortie).toBe(0)
    expect(sortie).toMatch(/INCOHÉRENCE ACCEPTÉE/)
    expect(fs.existsSync(sortieManifeste)).toBe(true)
  })

  it('REFUSE un fichier vide', () => {
    const p = path.join(dossier, `GarageFlows Setup ${VERSION}.exe`)
    fs.writeFileSync(p, Buffer.alloc(0))
    const { code, sortie } = signer(['--file', p, '--version', VERSION, '--download-url', URL_OK(VERSION)])
    expect(code).toBe(1)
    expect(sortie).toMatch(/vide/i)
  })
})
