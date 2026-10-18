import { describe, it, expect } from 'vitest'

// Modules CommonJS du build Electron.
const { fusePlan } = require('../../../scripts/fuse-config.js')
const { FuseVersion, FuseV1Options } = require('@electron/fuses')

describe('Electron fuse plan — posture de sécurité du binaire packagé', () => {
  it('utilise le schéma de fuses V1', () => {
    expect(fusePlan.version).toBe(FuseVersion.V1)
  })

  it('désactive les capacités dangereuses (Node caché, --inspect, NODE_OPTIONS)', () => {
    expect(fusePlan[FuseV1Options.RunAsNode]).toBe(false)
    expect(fusePlan[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false)
    expect(fusePlan[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false)
  })

  it('GARDE : GrantFileProtocolExtraPrivileges reste true (sinon écran noir au démarrage)', () => {
    // Ce fuse contrôle notamment la résolution des chemins À L'INTÉRIEUR d'une
    // archive asar par le protocole file://. À false, app.asar redevient un
    // simple FICHIER pour le service réseau : toute URL
    // file://…/app.asar/electron/*.html échoue en ERR_FILE_NOT_FOUND. Or
    // splash.html et license.html sont chargés exactement ainsi
    // (BrowserWindow.loadFile depuis __dirname, qui pointe dans l'asar) → les
    // deux fenêtres restaient VIDES, peintes par leur seul backgroundColor :
    // l'« écran noir » au démarrage. Vérifié en A/B sur le binaire packagé
    // (Electron 31.7.7) : false → ERR_FILE_NOT_FOUND, true → page rendue.
    //
    // Ne repasser ce fuse à false qu'APRÈS avoir servi ces pages autrement
    // (protocole applicatif via protocol.handle, ou fichiers déballés hors asar).
    // Voir scripts/fuse-config.js et docs/SECURITY-HARDENING.md.
    expect(fusePlan[FuseV1Options.GrantFileProtocolExtraPrivileges]).toBe(true)
  })

  it('active les protections (chargement asar uniquement, cookies chiffrés)', () => {
    expect(fusePlan[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true)
    expect(fusePlan[FuseV1Options.EnableCookieEncryption]).toBe(true)
  })

  it('laisse EnableEmbeddedAsarIntegrityValidation à false (empreinte asar non embarquée par electron-builder 24 — voir docs)', () => {
    // Activer ce fuse sans empreinte embarquée briquerait le chargement de l'asar.
    // L'intégrité d'app.asar est couverte au runtime par le manifeste HMAC.
    expect(fusePlan[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(false)
  })
})
