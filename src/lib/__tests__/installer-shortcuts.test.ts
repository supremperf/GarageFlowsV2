/**
 * GARDE — l'installateur Windows doit laisser un raccourci utilisable.
 *
 * ─── Le défaut réel ─────────────────────────────────────────────────────────
 * Après installation de « GarageFlows Setup 1.1.0.exe » sur un poste réel
 * (constat du 2026-08-11), l'application était bien présente dans
 * %LOCALAPPDATA%\Programs\GarageFlows mais il n'existait AUCUN raccourci : ni
 * sur le Bureau, ni au Menu Démarrer.
 *
 * Cause : `customInit` (scripts/installer.nsh) lance l'ancien désinstalleur À LA
 * MAIN, sans le drapeau `--keep-shortcuts` que le chemin de mise à jour
 * d'electron-builder passe normalement. L'ancien désinstalleur supprime donc les
 * raccourcis, puis la logique « keepShortcuts » de l'installateur considère
 * qu'il n'a pas à les recréer.
 *
 * Second défaut trouvé au passage : la macro de désinstallation s'appelait
 * `customUninstall` alors qu'electron-builder insère `customUnInstall`
 * (I majuscule, cf. app-builder-lib/templates/nsis/uninstaller.nsh). Elle
 * n'était donc jamais exécutée et la clé de registre survivait à la
 * désinstallation.
 *
 * Ce test verrouille les deux corrections. Il lit les fichiers RÉELS utilisés
 * par le build — pas une copie.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')

let pkg: { build?: { nsis?: Record<string, unknown>; win?: Record<string, unknown>; productName?: string } }
let nsh: string

beforeAll(() => {
  pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  // Fins de ligne NORMALISEES. Git for Windows convertit en CRLF au checkout
  // (.gitattributes ne couvre pas *.nsh) alors que les assertions ci-dessous
  // raisonnent en LF. En particulier la regex des continuations de ligne NSIS
  // cherche un antislash suivi d'un saut de ligne : en CRLF elle ne reconnait
  // plus la continuation, l'instruction CreateShortCut est tronquee AVANT sa
  // cible, et le test echouait sur TOUT clone Windows standard — un rouge qui
  // dependait de la configuration git locale, pas du contenu du depot.
  nsh = readFileSync(path.join(ROOT, 'scripts/installer.nsh'), 'utf8')
    .replace(/\r\n/g, '\n')
})

describe('configuration electron-builder', () => {
  it('le raccourci Bureau est recréé à CHAQUE installation', () => {
    // `true` ne recrée pas le raccourci lors d'une mise à jour : c'est
    // exactement le cas qui laissait le Bureau vide. `always` définit
    // RECREATE_DESKTOP_SHORTCUT côté NSIS.
    expect(pkg.build?.nsis?.createDesktopShortcut).toBe('always')
  })

  it('le raccourci Menu Démarrer est demandé', () => {
    expect(pkg.build?.nsis?.createStartMenuShortcut).toBe(true)
  })

  it('le nom du raccourci est exactement « GarageFlows »', () => {
    // Jamais GarageFlow, GarageFlowsV2, garagesite5 ni « Electron App ».
    expect(pkg.build?.nsis?.shortcutName).toBe('GarageFlows')
    expect(pkg.build?.productName).toBe('GarageFlows')
  })

  it('le script NSIS maison est bien inclus dans le build', () => {
    expect(pkg.build?.nsis?.include).toBe('scripts/installer.nsh')
  })
})

describe('script NSIS maison', () => {
  it('crée explicitement le raccourci Bureau', () => {
    expect(nsh).toMatch(/CreateShortCut\s+"\$DESKTOP\\\$\{SHORTCUT_NAME\}\.lnk"/)
  })

  it('crée explicitement le raccourci Menu Démarrer', () => {
    expect(nsh).toMatch(/CreateShortCut\s+"\$SMPROGRAMS\\\$\{SHORTCUT_NAME\}\.lnk"/)
  })

  it('les raccourcis pointent vers l’EXÉCUTABLE INSTALLÉ, jamais vers l’installateur', () => {
    // Les commentaires NSIS (« ; … ») sont écartés : seules les instructions
    // réellement exécutées sont jugées.
    const instructions = nsh
      .split('\n')
      .map((l) => l.replace(/^\s*;.*$/, ''))
      .join('\n')
    const creations = instructions.match(/CreateShortCut[^\n]*(?:\\\n[^\n]*)?/g) ?? []
    expect(creations.length).toBeGreaterThanOrEqual(2)
    for (const line of creations) {
      expect(line).toContain('$INSTDIR\\${APP_EXECUTABLE_FILENAME}')
      expect(line).not.toMatch(/Setup|\$EXEPATH/i)
    }
  })

  it('la macro de désinstallation porte le nom réellement inséré par electron-builder', () => {
    expect(nsh).toMatch(/!macro\s+customUnInstall\b/)
    // L'ancien nom ne doit plus traîner : il donnerait l'illusion d'un nettoyage.
    expect(nsh).not.toMatch(/!macro\s+customUninstall\b/)
  })

  it('la désinstallation retire les raccourcis, jamais les données métier', () => {
    const block = nsh.slice(nsh.indexOf('!macro customUnInstall'))
    expect(block).toMatch(/Delete\s+"\$DESKTOP\\\$\{SHORTCUT_NAME\}\.lnk"/)
    expect(block).toMatch(/Delete\s+"\$SMPROGRAMS\\\$\{SHORTCUT_NAME\}\.lnk"/)
    // Les données du garage (base, licence, secrets, photos) vivent sous
    // %APPDATA%. La désinstallation ne doit RIEN y supprimer récursivement,
    // quel que soit le nom du dossier.
    expect(block).not.toMatch(/RMDir\s+\/r\s+"?\$APPDATA/)
  })
})
