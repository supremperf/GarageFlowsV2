<#
.SYNOPSIS
  Vérifie la signature Authenticode des exécutables/installateurs Windows produits.

.DESCRIPTION
  Parcourt les fichiers .exe du chemin donné et contrôle leur signature via
  Get-AuthenticodeSignature. En mode -Strict, échoue (exit 1) si un binaire n'est
  pas signé « Valid » — utilisé pour bloquer une release non signée en CI. Sans
  -Strict, se contente d'un rapport (les builds de développement peuvent être
  non signés — voir docs/WINDOWS_CODE_SIGNING.md).

.PARAMETER Path
  Dossier (ex. "dist") ou fichier .exe à vérifier.

.PARAMETER Strict
  Si présent, un binaire non « Valid » fait échouer le script.

.EXAMPLE
  ./scripts/verify-windows-signature.ps1 -Path dist -Strict
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [switch]$Strict
)

$ErrorActionPreference = "Stop"

if (Test-Path -Path $Path -PathType Container) {
  $files = Get-ChildItem -Path $Path -Filter *.exe -Recurse -File
} elseif (Test-Path -Path $Path -PathType Leaf) {
  $files = @(Get-Item -Path $Path)
} else {
  Write-Error "Chemin introuvable : $Path"
  exit 2
}

if (-not $files -or $files.Count -eq 0) {
  Write-Warning "Aucun .exe trouvé dans '$Path'."
  if ($Strict) { exit 1 } else { exit 0 }
}

$allValid = $true
foreach ($f in $files) {
  $sig = Get-AuthenticodeSignature -FilePath $f.FullName
  $status = $sig.Status
  $signer = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { "(non signé)" }
  $line = "{0,-8} {1}  [{2}]" -f $status, $f.Name, $signer
  if ($status -eq "Valid") {
    Write-Host "OK    $line" -ForegroundColor Green
  } else {
    Write-Host "FAIL  $line" -ForegroundColor Yellow
    $allValid = $false
  }
}

if (-not $allValid) {
  if ($Strict) {
    Write-Error "Un ou plusieurs binaires ne sont pas signés « Valid » (mode strict)."
    exit 1
  }
  Write-Warning "Build non signé — DEVELOPMENT ONLY. Ne pas distribuer en production."
}
exit 0
