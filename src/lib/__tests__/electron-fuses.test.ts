import { describe, it, expect } from 'vitest'

// Modules CommonJS du build Electron.
const { fusePlan } = require('../../../scripts/fuse-config.js')
const { FuseVersion, FuseV1Options } = require('@electron/fuses')

describe('Electron fuse plan — posture de sécurité du binaire packagé', () => {
  it('utilise le schéma de fuses V1', () => {
    expect(fusePlan.version).toBe(FuseVersion.V1)
  })

  it('désactive les capacités dangereuses (Node caché, --inspect, NODE_OPTIONS, file://)', () => {
    expect(fusePlan[FuseV1Options.RunAsNode]).toBe(false)
    expect(fusePlan[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false)
    expect(fusePlan[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false)
    expect(fusePlan[FuseV1Options.GrantFileProtocolExtraPrivileges]).toBe(false)
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
