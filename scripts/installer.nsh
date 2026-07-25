; GarageFlow NSIS installer customisation
; Injected by electron-builder via nsis.include

; ── Avant l'installation : supprime toute version précédente ─────────────────
; Évite que Windows détecte deux fois le logiciel (deux installations).
; L'uninstaller ne touche PAS aux données (%APPDATA%\GarageFlow) → données conservées.
!macro customInit
  ReadRegStr $R0 SHCTX "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ReadRegStr $R1 SHCTX "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $R0 != ""
  ${AndIf} $R1 != ""
    DetailPrint "Suppression de la version précédente de GarageFlow…"
    ; /S = silencieux, _?= rend l'appel synchrone (attend la fin)
    ExecWait '$R0 /S _?=$R1'
  ${EndIf}
!macroend

!macro customInstall
  ; Write install path to registry for future update/uninstall reference
  WriteRegStr HKCU "Software\GarageFlow" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\GarageFlow" "Version"     "${VERSION}"

  ; Create writable data directory in %APPDATA% so the app can write its DB there
  CreateDirectory "$APPDATA\GarageFlow"
!macroend

!macro customUninstall
  ; Remove registry keys on uninstall
  DeleteRegKey HKCU "Software\GarageFlow"
!macroend
