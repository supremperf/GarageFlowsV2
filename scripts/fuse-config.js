'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  Plan de durcissement des Electron Fuses (appliqué au binaire packagé par
//  scripts/afterPack.js via @electron/fuses).
//
//  Les « fuses » sont des bits gravés dans le binaire Electron qui désactivent
//  définitivement des capacités dangereuses. On applique le sous-ensemble SÛR :
//    • RunAsNode:false                       → pas de mode Node.js caché (ELECTRON_RUN_AS_NODE)
//    • EnableNodeOptionsEnvironmentVariable:false → NODE_OPTIONS ignoré
//    • EnableNodeCliInspectArguments:false   → --inspect / débogage distant désactivé
//    • OnlyLoadAppFromAsar:true              → l'app ne se charge QUE depuis l'asar
//    • EnableCookieEncryption:true           → cookies chiffrés au repos
//    • GrantFileProtocolExtraPrivileges:false→ pas de privilèges file:// étendus
//
//  ⚠️ EnableEmbeddedAsarIntegrityValidation est laissé à FALSE : ce fuse exige que
//  l'EMPREINTE de l'asar soit embarquée dans le binaire (electron-builder v25, ou
//  une étape manuelle). electron-builder 24.x ne l'embarque pas → activer le fuse
//  briquerait le chargement de l'asar au runtime. En attendant, l'intégrité
//  d'app.asar est déjà vérifiée au démarrage par le manifeste HMAC signé
//  (electron/integrity.js, mode « enforce » en build packagé). Voir
//  docs/SECURITY-HARDENING.md (interventions restantes).
// ─────────────────────────────────────────────────────────────────────────────

const { FuseVersion, FuseV1Options } = require('@electron/fuses')

const fusePlan = {
  version: FuseVersion.V1,
  // macOS uniquement : re-signature ad-hoc après flip. Build Windows → sans effet.
  resetAdHocDarwinSignature: false,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false, // voir avertissement ci-dessus
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
}

module.exports = { fusePlan }
