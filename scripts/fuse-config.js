'use strict'

// Fuses are an explicit release contract for Electron 44.9.3. Keep every
// current V1 bit assigned and require all known fuses: an Electron/fuses update
// that introduces another bit must stop packaging until it is reviewed.
const { FuseVersion, FuseV1Options } = require('@electron/fuses')

const fusePlan = {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  // macOS-only behavior; this project currently ships Windows x64.
  resetAdHocDarwinSignature: false,

  // Remove alternate Node execution, environment-injected Node options, and
  // remote inspector entry points. The Next server runs through utilityProcess,
  // not ELECTRON_RUN_AS_NODE.
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,

  // Persist cookies encrypted with OS-provided keys. This is already the
  // shipped posture; do not downgrade it because that can invalidate cookies.
  [FuseV1Options.EnableCookieEncryption]: true,

  // electron-builder 26.15.3 embeds the app.asar header SHA-256 in the Windows
  // executable (ElectronAsarIntegrity resource). Electron 44 supports this on
  // Windows; verify the generated binary with check-artifact-fuses after pack.
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,

  // No custom browser_v8_context_snapshot.bin is shipped. Leave the optional
  // snapshot switch explicitly off rather than selecting a missing resource.
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,

  // Required by splash.html and license.html, which BrowserWindow.loadFile()
  // loads from app.asar using file://. Previous A/B testing on Electron 31.7.7
  // showed false -> ERR_FILE_NOT_FOUND and true -> pages rendered. Replacing
  // file:// with a registered application protocol is a separate migration.
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,

  // Electron 42+ enables the Wasm trap-handler fuse by default. Keep the safer,
  // faster guarded-memory behavior explicit instead of relying on that default.
  [FuseV1Options.WasmTrapHandlers]: true,
}

module.exports = { fusePlan }
