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

  ; ── Durcissement OPTIONNEL des permissions (installation perMachine) ────────
  ; Empêche un utilisateur standard de modifier / remplacer / supprimer les
  ; fichiers du dossier d'installation (DLL, .exe, ressources), tout en laissant
  ; lecture + exécution. L'installateur officiel (élevé) peut toujours mettre à
  ; jour les fichiers. Aucun mot de passe demandé au lancement du logiciel.
  ;
  ; INACTIF par défaut (bloc ignoré à la compilation si GF_HARDEN_ACL n'est pas
  ; défini) — sûr pour le build actuel. Pour l'activer : passer à electron-builder
  ;   --config.nsis.perMachine=true --config.nsis.include=scripts/installer.nsh \
  ;   --config.nsis.defines.GF_HARDEN_ACL=1
  ; (nécessite une installation dans Program Files). SID connus (indépendants de
  ; la langue) : S-1-5-32-544=Administrateurs, S-1-5-18=SYSTEM, S-1-5-32-545=Utilisateurs.
  !ifdef GF_HARDEN_ACL
    DetailPrint "Application de permissions restreintes sur $INSTDIR…"
    nsExec::ExecToLog 'icacls "$INSTDIR" /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" /grant:r "*S-1-5-18:(OI)(CI)F" /grant:r "*S-1-5-32-545:(OI)(CI)RX"'
  !endif
!macroend

!macro customUninstall
  ; Remove registry keys on uninstall
  DeleteRegKey HKCU "Software\GarageFlow"
!macroend
