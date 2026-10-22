import { describe, it, expect } from 'vitest'

// Modules CommonJS du build Electron.
const { fusePlan } = require('../../../scripts/fuse-config.js')
const { FuseVersion, FuseV1Options } = require('@electron/fuses')
const packageJson = require('../../../package.json')

const etatsAttendus: Record<number, boolean> = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  [FuseV1Options.WasmTrapHandlers]: true,
}

describe('Electron fuse plan — posture de sécurité du binaire packagé', () => {
  it('utilise le schéma V1 et échoue si un fuse connu n’est pas explicitement examiné', () => {
    expect(fusePlan.version).toBe(FuseVersion.V1)
    expect(fusePlan.strictlyRequireAllFuses).toBe(true)
    const indices = Object.values(FuseV1Options).filter((value: unknown) => typeof value === 'number')
    expect(indices).toHaveLength(9)
    for (const index of indices as number[]) {
      expect(fusePlan[index], `fuse V1 #${index} doit être explicite`).toBe(etatsAttendus[index])
    }
  })

  it('désactive Node caché, NODE_OPTIONS et les points d’entrée --inspect', () => {
    expect(fusePlan[FuseV1Options.RunAsNode]).toBe(false)
    expect(fusePlan[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false)
    expect(fusePlan[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false)
    // main.js démarre Next via utilityProcess.fork(), pas via ELECTRON_RUN_AS_NODE.
    expect(require('node:fs').readFileSync(require('node:path').join(__dirname, '../../../electron/main.js'), 'utf8'))
      .toContain('utilityProcess.fork(serverJs')
  })

  it('garde les cookies chiffrés et active la validation de l’ASAR réellement embarquée', () => {
    expect(fusePlan[FuseV1Options.EnableCookieEncryption]).toBe(true)
    expect(fusePlan[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(true)
    expect(fusePlan[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true)

    // electron-builder 26.15.3 calcule et embarque ElectronAsarIntegrity sur PE.
    // Une régression de version/config ne doit pas activer le fuse sans son hash.
    expect(packageJson.build.asar).toBe(true)
    expect(packageJson.build.disableAsarIntegrity).not.toBe(true)
    expect(packageJson.devDependencies['electron-builder']).toBe('26.15.3')
    expect(packageJson.devDependencies.electron).toBe('44.9.3')
  })

  it('n’utilise pas l’option de login macOS supprimée dans Electron 44', () => {
    const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../../electron/main.js'), 'utf8')
    expect(main).not.toMatch(/\bopenAsHidden\s*:/)
  })

  it('garde le privilège file:// requis par les pages locales et active WasmTrapHandlers', () => {
    // splash.html et license.html sont chargées depuis app.asar via file://.
    // L’A/B historique sur Electron 31.7.7 a confirmé false → ERR_FILE_NOT_FOUND.
    // Une migration vers un protocole applicatif dédié est nécessaire avant de
    // pouvoir désactiver ce privilège étendu.
    expect(fusePlan[FuseV1Options.GrantFileProtocolExtraPrivileges]).toBe(true)
    expect(fusePlan[FuseV1Options.WasmTrapHandlers]).toBe(true)
  })

  it('laisse le snapshot V8 spécifique au navigateur désactivé faute de ressource dédiée', () => {
    expect(fusePlan[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]).toBe(false)
  })
})
