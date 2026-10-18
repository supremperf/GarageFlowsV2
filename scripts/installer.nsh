; GarageFlow NSIS installer customisation
; Injected by electron-builder via nsis.include

; ── Pourquoi il n'y a plus de `customInit` ──────────────────────────────────
;
; Une macro maison y désinstallait l'ancienne version : `ExecWait '$R0 /S _?=$R1'`.
; electron-builder insère `customInit` dans `.onInit`, c'est-à-dire AVANT la
; première page de l'assistant. La version installée disparaissait donc avant
; que l'utilisateur ait confirmé quoi que ce soit : un clic sur « Annuler », un
; antivirus qui interrompt, un disque plein — et le poste de comptoir se
; retrouvait SANS GarageFlows. Plus d'exécutable, plus de raccourci, plus
; d'entrée dans « Applications ». Les données restaient, sans rien pour les
; ouvrir, et l'application ne pouvait plus se réparer puisqu'elle avait quitté.
;
; Or ce travail était DÉJÀ FAIT, et mieux : app-builder-lib/templates/nsis/
; installSection.nsh appelle `uninstallOldVersion` À L'INTÉRIEUR de la section
; d'installation — donc après confirmation —, après avoir copié l'ancien
; désinstalleur dans $PLUGINSDIR, et en lui passant `--updated` ainsi que
; `--keep-shortcuts` quand il le supporte.
;
; La macro maison ne faisait donc que dupliquer cette étape au pire instant et
; sans les drapeaux — et c'est précisément ce qui faisait disparaître les
; raccourcis (voir `customInstall`).

!macro customInstall
  ; Write install path to registry for future update/uninstall reference
  WriteRegStr HKCU "Software\GarageFlow" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\GarageFlow" "Version"     "${VERSION}"

  ; ── Raccourcis Bureau et Menu Démarrer — CRÉÉS EXPLICITEMENT ────────────────
  ; Constat sur poste réel (2026-08-11) : après installation de « GarageFlows
  ; Setup 1.1.0.exe », l'application était bien présente dans
  ; %LOCALAPPDATA%\Programs\GarageFlows, mais il n'existait AUCUN raccourci —
  ; ni sur le Bureau, ni au Menu Démarrer.
  ;
  ; Cause : `customInit` (SUPPRIMÉ le 16/08/2026, voir en tête) lançait l'ancien
  ; désinstalleur À LA MAIN, sans
  ; le drapeau `--keep-shortcuts` que le chemin de mise à jour d'electron-builder
  ; passe normalement. L'ancien désinstalleur supprime donc les raccourcis, et la
  ; logique « keepShortcuts » de l'installateur estime ensuite qu'il n'a pas à
  ; les recréer. Résultat : ils disparaissent à la première mise à jour et ne
  ; reviennent jamais.
  ;
  ; La CAUSE est supprimée depuis le 16/08/2026 : `customInit` n'existe plus, donc
  ; l'heuristique `keepShortcuts` d'electron-builder fonctionne de nouveau. Cette
  ; création explicite est CONSERVÉE malgré tout : la disparition des raccourcis a
  ; été constatée sur un poste réel, et `CreateShortCut` écrase la cible existante
  ; — aucune duplication possible, jamais de « GarageFlows (1).lnk ». Une ceinture
  ; qui ne coûte rien, sur un symptôme qu'un garagiste ne saurait pas réparer.
  ;
  ; Cible = l'exécutable installé (jamais l'installateur), icône prise dans
  ; l'exécutable, répertoire de travail = dossier d'installation.
  SetShellVarContext current
  CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" \
    "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 SW_SHOWNORMAL "" "${APP_DESCRIPTION}"
  CreateShortCut "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" \
    "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 SW_SHOWNORMAL "" "${APP_DESCRIPTION}"
  ; Rattache les raccourcis à l'identité applicative (épinglage, groupement barre
  ; des tâches, notifications) — même traitement que les raccourcis natifs.
  WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
  WinShell::SetLnkAUMI "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "${APP_ID}"
  ; Rafraîchit l'affichage du Bureau (sinon l'icône n'apparaît qu'au prochain F5).
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'

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

; electron-builder insère « customUnInstall » (I MAJUSCULE, cf.
; app-builder-lib/templates/nsis/uninstaller.nsh). La macro s'appelait ici
; « customUninstall » : elle n'était donc JAMAIS exécutée, et la clé de registre
; Software\GarageFlow survivait à toute désinstallation.
!macro customUnInstall
  ; Remove registry keys on uninstall
  DeleteRegKey HKCU "Software\GarageFlow"

  ; Retrait des raccourcis créés dans customInstall. Idempotent : `Delete` ne
  ; signale rien si le fichier est déjà parti (cas d'une désinstallation par le
  ; chemin natif d'electron-builder, qui les a déjà supprimés).
  ; AUCUNE donnée métier n'est touchée : %APPDATA%\GarageFlow reste intact.
  SetShellVarContext current
  WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  WinShell::UninstShortcut "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
