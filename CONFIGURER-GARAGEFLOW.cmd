@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0" || (
  echo [ERREUR] Impossible d acceder au dossier du projet.
  pause
  exit /b 1
)
title GarageFlow - Configuration des variables et API

set "SCRIPT=%~dp0scripts\configurer-api-garageflow.ps1"
set "MANIFEST=%~dp0scripts\garageflow-env-manifest.json"

if not exist "%SCRIPT%" ( echo [ERREUR] Fichier manquant : scripts\configurer-api-garageflow.ps1 & goto :missing )
if not exist "%MANIFEST%" ( echo [ERREUR] Fichier manquant : scripts\garageflow-env-manifest.json & goto :missing )

set "PS_EXE=powershell.exe"
where pwsh.exe >nul 2>&1 && set "PS_EXE=pwsh.exe"

"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" ( echo [OK] Configuration terminee. ) else ( echo [ERREUR] Configuration interrompue (code %RC%). )
pause
popd
exit /b %RC%

:missing
echo Copiez le dossier scripts complet du projet.
pause
exit /b 1
