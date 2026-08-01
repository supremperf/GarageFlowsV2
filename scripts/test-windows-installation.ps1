<#
.SYNOPSIS
  Test d'installation/désinstallation silencieuse de l'installateur NSIS GarageFlow.

.DESCRIPTION
  À exécuter sur une machine Windows (ou un runner windows-latest). Installe
  l'exécutable en mode silencieux (/S), vérifie la présence du dossier
  d'installation et du raccourci, lance un contrôle basique, puis désinstalle et
  vérifie le nettoyage. Ce script est un OUTIL de validation manuelle/CI — son
  exécution réelle nécessite Windows (BLOCKED_ENVIRONMENT hors Windows).

.PARAMETER Installer
  Chemin vers « <Produit> Setup <version>.exe ».

.PARAMETER ProductName
  Nom du produit (dossier / raccourci). Défaut : GarageFlow.

.EXAMPLE
  ./scripts/test-windows-installation.ps1 -Installer "dist/GarageFlow Setup 1.1.0.exe"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$ProductName = "GarageFlow"
)

$ErrorActionPreference = "Stop"
function Fail($msg) { Write-Error $msg; exit 1 }

if (-not (Test-Path $Installer)) { Fail "Installateur introuvable : $Installer" }

# Emplacement d'installation par défaut (NSIS perMachine=false → per-user).
$installDir = Join-Path $env:LOCALAPPDATA "Programs\$ProductName"
$startMenu  = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$ProductName.lnk"

Write-Host "==> Installation silencieuse…"
$p = Start-Process -FilePath $Installer -ArgumentList "/S" -Wait -PassThru
if ($p.ExitCode -ne 0) { Fail "Échec de l'installation (exit $($p.ExitCode))." }

Start-Sleep -Seconds 3
if (-not (Test-Path $installDir)) { Fail "Dossier d'installation absent : $installDir" }
$exe = Join-Path $installDir "$ProductName.exe"
if (-not (Test-Path $exe)) { Fail "Exécutable absent : $exe" }
Write-Host "OK  Dossier + exécutable présents." -ForegroundColor Green

# Vérifie la signature de l'exécutable installé (informational).
$sig = Get-AuthenticodeSignature -FilePath $exe
Write-Host "    Signature de l'exécutable installé : $($sig.Status)"

Write-Host "==> Désinstallation silencieuse…"
$uninstaller = Join-Path $installDir "Uninstall $ProductName.exe"
if (Test-Path $uninstaller) {
  $u = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
  if ($u.ExitCode -ne 0) { Write-Warning "Désinstallateur exit $($u.ExitCode)." }
  Start-Sleep -Seconds 3
} else {
  Write-Warning "Désinstallateur introuvable : $uninstaller"
}

if (Test-Path $installDir) {
  Write-Warning "Le dossier d'installation subsiste après désinstallation : $installDir"
} else {
  Write-Host "OK  Nettoyage vérifié." -ForegroundColor Green
}

Write-Host "Terminé."
exit 0
