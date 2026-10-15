@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0" || (
  echo [ERREUR] Impossible d'acceder au dossier scripts.
  pause
  exit /b 1
)
title GarageFlows - Rotation totale Vercel

echo ================================================================
echo GarageFlows - Rotation totale des variables Production
echo Outil avance et potentiellement destructeur - Windows uniquement
echo ================================================================
echo.

set "RESET=%~dp0reset-garageflow.ps1"
set "MAIN=%~dp0configurer-api-garageflow.ps1"
set "MANIFEST=%~dp0garageflow-env-manifest.json"

if not exist "%RESET%" ( echo [ERREUR] Fichier manquant : scripts\reset-garageflow.ps1 & goto :missing )
if not exist "%MAIN%" ( echo [ERREUR] Fichier manquant : scripts\configurer-api-garageflow.ps1 & goto :missing )
if not exist "%MANIFEST%" ( echo [ERREUR] Fichier manquant : scripts\garageflow-env-manifest.json & goto :missing )

set "PS_EXE=powershell.exe"
where pwsh.exe >nul 2>&1 && set "PS_EXE=pwsh.exe"

set "GF_SCRIPT_TO_PARSE=%RESET%"
"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:GF_SCRIPT_TO_PARSE,[ref]$t,[ref]$e);if(@($e).Count -gt 0){foreach($pe in @($e)){Write-Host ('[ERREUR SYNTAXE] Ligne '+$pe.Extent.StartLineNumber+' : '+$pe.Message)};exit 3}"
if errorlevel 1 goto :syntax
set "GF_SCRIPT_TO_PARSE=%MAIN%"
"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:GF_SCRIPT_TO_PARSE,[ref]$t,[ref]$e);if(@($e).Count -gt 0){foreach($pe in @($e)){Write-Host ('[ERREUR SYNTAXE] Ligne '+$pe.Extent.StartLineNumber+' : '+$pe.Message)};exit 3}"
if errorlevel 1 goto :syntax
set "GF_SCRIPT_TO_PARSE="

echo [OK] Syntaxe PowerShell valide.
"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%RESET%"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" ( echo [OK] Operation terminee. ) else ( echo [ERREUR] Operation echouee. Consultez le dossier de rapport. )
pause
popd
exit /b %RC%

:syntax
echo [ERREUR] Erreur de syntaxe PowerShell detectee. Abandon.
pause
popd
exit /b 3

:missing
echo Copiez le dossier scripts complet.
pause
exit /b 1
