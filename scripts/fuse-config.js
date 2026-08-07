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
//
//  ⚠️ GrantFileProtocolExtraPrivileges DOIT rester à TRUE : parmi les « privilèges
//  étendus » que ce fuse contrôle figure la résolution des chemins À L'INTÉRIEUR
//  d'une archive asar par le protocole file://. Avec le fuse à false, app.asar
//  redevient un simple FICHIER pour le service réseau : toute URL
//  file://…/app.asar/electron/*.html échoue en ERR_FILE_NOT_FOUND. Or splash.html
//  et license.html sont chargés exactement ainsi (BrowserWindow.loadFile depuis
//  __dirname, qui pointe dans l'asar) → les deux fenêtres restaient VIDES, peintes
//  uniquement par leur backgroundColor : l'« écran noir » au démarrage, sans
//  aucune trace dans le log (aucun handler did-fail-load n'était posé).
//  Vérifié empiriquement (A/B sur le binaire packagé, Electron 31.7.7) :
//    fuse=false → ERR_FILE_NOT_FOUND ; fuse=true → page rendue normalement.
//  Ne repasser ce fuse à false qu'après avoir servi ces pages autrement
//  (protocole applicatif dédié via protocol.handle, ou fichiers déballés hors asar).
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
  // TRUE obligatoire : file:// doit pouvoir lire DANS app.asar (splash + licence).
  // Voir l'avertissement ci-dessus — le mettre à false rend l'app inutilisable.
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
}

module.exports = { fusePlan }
