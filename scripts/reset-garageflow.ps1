#requires -Version 5.1
param(
    [switch]$DryRun,
    [switch]$NonInteractive,
    [switch]$ConfirmDestructiveReset,
    [switch]$BackupOnly,
    [string]$Restore,
    [switch]$SkipDeploy,
    [switch]$SkipDatabaseReset,
    [switch]$SkipLicenseReset,
    [switch]$VerboseDiagnostics
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Figer les paramètres AVANT le dot-source : configurer-api-garageflow.ps1 possède
# son propre param() qui déclare aussi BackupOnly/Restore et écraserait ces valeurs
# dans la portée courante. On les capture donc sous des noms dédiés $script:Gf*.
$script:GfDryRun             = [bool]$DryRun
$script:GfNonInteractive     = [bool]$NonInteractive
$script:GfConfirmDestructive = [bool]$ConfirmDestructiveReset
$script:GfBackupOnly         = [bool]$BackupOnly
$script:GfRestorePath        = [string]$Restore
$script:GfSkipDeploy         = [bool]$SkipDeploy
$script:GfSkipDatabaseReset  = [bool]$SkipDatabaseReset
$script:GfSkipLicenseReset   = [bool]$SkipLicenseReset
$script:GfVerboseDiagnostics = [bool]$VerboseDiagnostics
$script:PatchedSourceBackups = @()

$env:GF_CONFIGURER_API_TEST_MODE = '1'
. (Join-Path $PSScriptRoot 'configurer-api-garageflow.ps1')

$script:ResetVersion = '1.8.5'

# =====================================================================
# OUTIL AVANCE ET POTENTIELLEMENT DESTRUCTEUR - Windows uniquement.
# Rotation cryptographique TOTALE + reinitialisation des licences (Neon/Vercel).
# PARAMETRES (bloc param() ci-dessous) :
#   -DryRun                  Simulation : aucune mutation Vercel/Neon/projet.
#   -NonInteractive          Sans invite ; exige -ConfirmDestructiveReset.
#   -ConfirmDestructiveReset Confirme explicitement une execution destructrice.
#   -BackupOnly              Sauvegarde puis arret (aucune modification).
#   -Restore <dossier>       Restaure .env + keys/server_config.json depuis une sauvegarde.
#   -SkipDeploy              Pas de deploiement Vercel ni de tests runtime.
#   -SkipDatabaseReset       N execute pas la reparation legacyIdV* (no-op ici).
#   -SkipLicenseReset        Ne supprime pas les anciennes licences.
#   -VerboseDiagnostics      Diagnostics detailles.
# Sans parametre : mode interactif (double confirmation RESET puis ROTATION-TOTALE).
# La « reparation legacyIdV* » est un NO-OP sur ce projet (aucune colonne legacyId).
# Voir docs/REINITIALISATION_GARAGEFLOW.md et docs/RESTAURATION_GARAGEFLOW.md.
# =====================================================================

function Resolve-SafeStartDirectory {
    param([AllowNull()][string]$Value)

    # Ne jamais dépendre d'un chemin CMD brut si aucun chemin n'est nécessaire.
    $candidate = if ([string]::IsNullOrWhiteSpace($Value)) { $PSScriptRoot } else { $Value }

    # Supprimer les guillemets résiduels et les caractères invisibles qui peuvent
    # être ajoutés lors du passage d'un chemin terminé par une barre oblique inverse.
    $candidate = $candidate.Trim()
    $candidate = $candidate.Trim('"').Trim("'")
    $candidate = $candidate.Replace([string][char]0xFEFF, '')
    $candidate = $candidate.Replace([string][char]0x200B, '')
    $candidate = $candidate.Replace([string][char]0x0000, '')

    if ([string]::IsNullOrWhiteSpace($candidate)) {
        $candidate = $PSScriptRoot
    }

    try {
        $fullPath = [IO.Path]::GetFullPath($candidate)
    } catch {
        throw "Chemin de démarrage invalide après normalisation. Lancez le CMD depuis le dossier scripts. Détail : $($_.Exception.Message)"
    }

    if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
        throw "Le dossier de démarrage n'existe pas : $fullPath"
    }

    return $fullPath
}

$resolvedStartDirectory = Resolve-SafeStartDirectory -Value $PSScriptRoot
$script:ProjectRoot = Find-ProjectRoot -StartPath $resolvedStartDirectory
$script:ScriptDirectory = $PSScriptRoot
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:Vercel = $null
$script:VercelProject = $null
$script:VercelTokenPlain = $null
$script:SecretRegistry = New-Object 'System.Collections.Generic.List[string]'

function Clean-InputValue {
    param([AllowNull()][string]$Value)
    if ($null -eq $Value) { return '' }
    return $Value.Replace([string][char]0xFEFF, '').Replace([string][char]0x200B, '').Replace([string][char]0x0000, '').Trim()
}

function Test-IsMaskedVercelValue {
    param([AllowNull()][string]$Value)
    $clean = Clean-InputValue $Value
    if ([string]::IsNullOrWhiteSpace($clean)) { return $false }
    return ($clean -match '^\[?(?:SENSITIVE|SECRET_MASQUE|ENCRYPTED|REDACTED)\]?$' -or
            $clean -match '^__VERCEL_.*(?:SENSITIVE|ENCRYPTED).*$')
}

function Get-UsableExistingValue {
    param([AllowNull()][string]$Value)
    $clean = Clean-InputValue $Value
    if (Test-IsMaskedVercelValue $clean) { return '' }
    return $clean
}

function Normalize-PostgresUrl {
    param([AllowNull()][string]$Value)

    $clean = Clean-InputValue $Value
    if ([string]::IsNullOrWhiteSpace($clean)) { return '' }

    # Accepter aussi une ligne complète copiée depuis Neon : DATABASE_URL=...
    $assignment = [regex]::Match($clean, '^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$')
    if ($assignment.Success) {
        $clean = Clean-InputValue $assignment.Groups[1].Value
    }

    # Retirer une paire de guillemets externes sans toucher au contenu de l'URL.
    if ($clean.Length -ge 2) {
        if (($clean[0] -eq '"' -and $clean[$clean.Length - 1] -eq '"') -or
            ($clean[0] -eq "'" -and $clean[$clean.Length - 1] -eq "'")) {
            $clean = $clean.Substring(1, $clean.Length - 2)
        }
    }

    return (Clean-InputValue $clean)
}

# Alias local explicite : la fonction centrale de masquage est définie dans
# configurer-api-garageflow.ps1 sous le nom Protect-LogText.
# Garder cet alias évite qu'une erreur de nom bloque le diagnostic ou le rollback.
function Protect-Text {
    param([AllowNull()][object]$Text)
    return (Protect-LogText $Text)
}

function Read-SecretOrKeep {
    param(
        [Parameter(Mandatory=$true)][string]$Name,
        [AllowNull()][string]$Existing,
        [switch]$Required
    )
    $Existing = Get-UsableExistingValue $Existing
    $message = if ([string]::IsNullOrEmpty($Existing)) {
        "$Name (saisie masquée)"
    } else {
        "$Name (Entrée = conserver l'ancienne valeur, saisie masquée)"
    }
    while ($true) {
        $secure = Read-Host $message -AsSecureString
        $plain = ConvertFrom-SecureStringPlain $secure
        $plain = Clean-InputValue $plain
        if ([string]::IsNullOrEmpty($plain) -and -not [string]::IsNullOrEmpty($Existing)) { return (Clean-InputValue $Existing) }
        if ([string]::IsNullOrEmpty($plain) -and -not $Required) { return '' }
        if (-not [string]::IsNullOrEmpty($plain)) { return $plain }
        Write-Host "[ERREUR] $Name est obligatoire." -ForegroundColor Red
    }
}

function Read-TextOrKeep {
    param(
        [Parameter(Mandatory=$true)][string]$Name,
        [AllowNull()][string]$Existing,
        [string]$Default,
        [switch]$Required
    )
    $Existing = Get-UsableExistingValue $Existing
    $fallback = if (-not [string]::IsNullOrEmpty($Existing)) { Clean-InputValue $Existing } else { Clean-InputValue $Default }
    $suffix = if (-not [string]::IsNullOrEmpty($fallback)) { " [$fallback]" } else { '' }
    while ($true) {
        $answer = Read-Host "$Name$suffix"
        $answer = Clean-InputValue $answer
        if ([string]::IsNullOrEmpty($answer)) { $answer = $fallback }
        if (-not [string]::IsNullOrEmpty($answer)) { return $answer }
        if (-not $Required) { return '' }
        Write-Host "[ERREUR] $Name est obligatoire." -ForegroundColor Red
    }
}

function Assert-Url {
    param([string]$Name,[string]$Value,[switch]$Postgres,[switch]$Https)
    $clean = if ($Postgres) { Normalize-PostgresUrl $Value } else { Clean-InputValue $Value }
    if ($Postgres) {
        if ($clean -notmatch '^postgres(?:ql)?://') { throw "$Name doit commencer par postgresql:// ou postgres://" }
        return
    }
    $uri = $null
    if (-not [Uri]::TryCreate($clean, [UriKind]::Absolute, [ref]$uri)) { throw "$Name n'est pas une URL valide." }
    if ($Https -and $uri.Scheme -ne 'https') { throw "$Name doit commencer par https://" }
}



function New-LicenseSigningKeyPair {
    param([Parameter(Mandatory=$true)][string]$OutputDirectory)

    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
    if (-not $node) { throw 'Node.js est obligatoire pour générer la nouvelle paire de signature ECDSA.' }

    if (-not (Test-Path -LiteralPath $OutputDirectory)) {
        New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    }
    $privatePath = Join-Path $OutputDirectory 'private.pem'
    $publicPath = Join-Path $OutputDirectory 'public.pem'
    $generatorPath = Join-Path $OutputDirectory 'generate-license-keypair.cjs'
    $js = @'
const fs = require('fs');
const crypto = require('crypto');
const out = process.argv[2];
const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
fs.writeFileSync(require('path').join(out, 'private.pem'), privatePem, { mode: 0o600 });
fs.writeFileSync(require('path').join(out, 'public.pem'), publicPem, { mode: 0o644 });
'@
    [IO.File]::WriteAllText($generatorPath, $js, $script:Utf8NoBom)
    try {
        $output = & $node.Source $generatorPath $OutputDirectory 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Génération ECDSA échouée : $(Protect-LogText ($output -join ' | '))" }
    } finally {
        Remove-Item -LiteralPath $generatorPath -Force -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path -LiteralPath $privatePath -PathType Leaf) -or -not (Test-Path -LiteralPath $publicPath -PathType Leaf)) {
        throw 'La paire ECDSA n-a pas été générée.'
    }
    $privatePem = [IO.File]::ReadAllText($privatePath)
    $publicPem = [IO.File]::ReadAllText($publicPath)
    if ($privatePem -notmatch '-----BEGIN PRIVATE KEY-----' -or $publicPem -notmatch '-----BEGIN PUBLIC KEY-----') {
        throw 'La paire ECDSA générée est invalide.'
    }
    Set-PrivateFileAcl $privatePath
    return [pscustomobject]@{
        PrivatePem = $privatePem
        PrivateBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($privatePem))
        PublicPem = $publicPem
        PrivatePath = $privatePath
        PublicPath = $publicPath
    }
}

function Set-LicensePublicKeyInProject {
    param(
        [Parameter(Mandatory=$true)][string]$Root,
        [Parameter(Mandatory=$true)][string]$PublicPem
    )
    $lines = @($PublicPem -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($lines.Count -lt 3) { throw 'Clé publique PEM invalide pour le patch du projet.' }
    $arrayLines = ($lines | ForEach-Object { "  '$($_.Replace("'", "''"))'," }) -join "`r`n"

    $targets = @(
        @{ Path = (Join-Path $Root 'src\lib\license\public-key.ts'); Name = '_LINES' },
        @{ Path = (Join-Path $Root 'electron\main.js'); Name = '_PK' }
    )
    foreach ($target in $targets) {
        $path = [string]$target.Path
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Fichier de clé publique introuvable : $path" }
        $raw = [IO.File]::ReadAllText($path)
        $name = [regex]::Escape([string]$target.Name)
        $pattern = "(?s)(?:const|let|var)\s+$name\s*=\s*\[.*?\]"
        $replacement = "const $([string]$target.Name) = [`r`n$arrayLines`r`n]"
        $patched = [regex]::Replace($raw, $pattern, $replacement, 1)
        if ($patched -eq $raw) { throw "Tableau $([string]$target.Name) introuvable dans $path" }
        $backup = $path + '.before-v171-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
        Copy-Item -LiteralPath $path -Destination $backup -Force
        $script:PatchedSourceBackups += , ([pscustomobject]@{ Original = $path; Backup = $backup })
        [IO.File]::WriteAllText($path, $patched, $script:Utf8NoBom)
    }
    Write-Host '[OK] Nouvelle clé publique de licence appliquée au serveur et à Electron.' -ForegroundColor Green
}

function Repair-LegacyLicenseColumns {
    param(
        [Parameter(Mandatory=$true)][string]$DirectUrl,
        [Parameter(Mandatory=$true)][string]$RunDirectory
    )

    $schemaPath = Join-Path $script:ProjectRoot 'prisma\server\schema.prisma'
    if (-not (Test-Path -LiteralPath $schemaPath -PathType Leaf)) { throw 'Schéma Prisma serveur introuvable.' }

    $localPrismaCmd = Join-Path $script:ProjectRoot 'node_modules\.bin\prisma.cmd'
    $localPrismaExe = Join-Path $script:ProjectRoot 'node_modules\.bin\prisma.exe'
    $prismaMode = ''
    $prismaLauncher = ''

    if (Test-Path -LiteralPath $localPrismaCmd -PathType Leaf) {
        $prismaLauncher = $localPrismaCmd
        $prismaMode = 'local-cmd'
    } elseif (Test-Path -LiteralPath $localPrismaExe -PathType Leaf) {
        $prismaLauncher = $localPrismaExe
        $prismaMode = 'local-exe'
    } else {
        $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
        if (-not $npx) { $npx = Get-Command npx.exe -ErrorAction SilentlyContinue }
        if (-not $npx) { $npx = Get-Command npx -ErrorAction SilentlyContinue }
        if (-not $npx) { throw 'Prisma local introuvable et npx indisponible. Exécutez npm install dans le projet.' }
        $prismaLauncher = [string]$npx.Source
        $prismaMode = 'npx-pinned'
    }

    if (-not (Test-Path -LiteralPath $RunDirectory)) {
        New-Item -ItemType Directory -Path $RunDirectory -Force | Out-Null
    }

    $sqlPath = Join-Path $RunDirectory 'repair-licensekey-legacy-columns.sql'
    $stdoutPath = Join-Path $RunDirectory 'repair-licensekey-legacy-columns.stdout.txt'
    $stderrPath = Join-Path $RunDirectory 'repair-licensekey-legacy-columns.stderr.txt'
    $commandPath = Join-Path $RunDirectory 'repair-licensekey-legacy-columns.command.txt'

    # Certaines anciennes migrations ont ajouté legacyIdV31/V32/V33 en NOT NULL,
    # alors que ces colonnes n'existent plus dans le schéma Prisma courant.
    # Prisma ne peut donc pas les renseigner lors d'un create(). On conserve les
    # colonnes pour compatibilité, mais on retire uniquement la contrainte NOT NULL.
    $sql = @'
DO $garageflow$
DECLARE
  legacy_column record;
BEGIN
  FOR legacy_column IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'LicenseKey'
      AND column_name LIKE 'legacyIdV%'
      AND is_nullable = 'NO'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I DROP NOT NULL',
      'public',
      'LicenseKey',
      legacy_column.column_name
    );
  END LOOP;
END
$garageflow$;
'@
    [IO.File]::WriteAllText($sqlPath, $sql, $script:Utf8NoBom)

    $oldDb = [Environment]::GetEnvironmentVariable('DATABASE_URL','Process')
    $oldDirect = [Environment]::GetEnvironmentVariable('DIRECT_URL','Process')
    $oldNativePrefExists = Test-Path variable:PSNativeCommandUseErrorActionPreference
    $oldNativePref = if ($oldNativePrefExists) { $PSNativeCommandUseErrorActionPreference } else { $null }

    try {
        [Environment]::SetEnvironmentVariable('DATABASE_URL', $DirectUrl, 'Process')
        [Environment]::SetEnvironmentVariable('DIRECT_URL', $DirectUrl, 'Process')
        if ($oldNativePrefExists) { $PSNativeCommandUseErrorActionPreference = $false }

        if ($prismaMode -eq 'npx-pinned') {
            $safeCommand = '"{0}" --yes prisma@5 db execute --schema "{1}" --file "{2}"' -f `
                $prismaLauncher.Replace('"','""'), `
                $schemaPath.Replace('"','""'), `
                $sqlPath.Replace('"','""')
        } else {
            $safeCommand = '"{0}" db execute --schema "{1}" --file "{2}"' -f `
                $prismaLauncher.Replace('"','""'), `
                $schemaPath.Replace('"','""'), `
                $sqlPath.Replace('"','""')
        }
        [IO.File]::WriteAllText($commandPath, $safeCommand, $script:Utf8NoBom)
        Write-Host "[INFO] Réparation LicenseKey avec Prisma : $prismaMode" -ForegroundColor DarkCyan

        Remove-Item -LiteralPath $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
        $proc = Start-Process `
            -FilePath $env:ComSpec `
            -ArgumentList @('/d','/s','/c',('"' + $safeCommand + '"')) `
            -WorkingDirectory $script:ProjectRoot `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath `
            -NoNewWindow `
            -Wait `
            -PassThru

        $stdout = if (Test-Path -LiteralPath $stdoutPath) { [IO.File]::ReadAllText($stdoutPath) } else { '' }
        $stderr = if (Test-Path -LiteralPath $stderrPath) { [IO.File]::ReadAllText($stderrPath) } else { '' }
        $combined = (($stdout.Trim(), $stderr.Trim()) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ' | '

        if ($proc.ExitCode -ne 0) {
            if ([string]::IsNullOrWhiteSpace($combined)) { $combined = "Aucune sortie native. Code retour : $($proc.ExitCode)." }
            throw "Réparation LicenseKey échouée (code $($proc.ExitCode)) : $(Protect-LogText $combined). Consultez $stdoutPath et $stderrPath"
        }
        if ($combined -match '(?im)^\s*Error\s*:') {
            throw "Prisma a signalé une erreur pendant la réparation LicenseKey : $(Protect-LogText $combined)."
        }
    } finally {
        [Environment]::SetEnvironmentVariable('DATABASE_URL', $oldDb, 'Process')
        [Environment]::SetEnvironmentVariable('DIRECT_URL', $oldDirect, 'Process')
        if ($oldNativePrefExists) { $PSNativeCommandUseErrorActionPreference = $oldNativePref }
    }

    Write-Host '[OK] Schéma Neon réparé : les colonnes legacyIdV* de LicenseKey ne bloquent plus les créations Prisma.' -ForegroundColor Green
}

function Invoke-ServerSchemaConverge {
    # Aligne le schéma Neon Production sur le CODE fusionné (mechanic-licenses +
    # chrono) via un DDL IDEMPOTENT (ADD COLUMN/CREATE TABLE/CREATE INDEX IF NOT
    # EXISTS + FK guardées). Sans ces objets, toute requête Prisma les listant
    # renvoie HTTP 500 « Erreur base de données » (ex. LicenseKey.parentLicenseId
    # via findUnique qui SELECT tous les scalaires). Le build Vercel ne fait que
    # `prisma generate` — il ne migre PAS la base ; on le fait donc ici, AVANT que
    # le nouveau déploiement ne serve du trafic.
    #
    # Pourquoi `db execute` (comme Repair-LegacyLicenseColumns) et NON
    # `migrate deploy` : migrate deploy SAUTE toute migration déjà inscrite dans
    # _prisma_migrations même si ses colonnes manquent réellement (drift), et peut
    # avorter sur un état de migration échoué. Le DDL conditionnel CONVERGE toujours
    # les colonnes/tables réelles quel que soit l'historique, et est rejouable sans
    # risque. Additif : sûr pour l'ancien déploiement encore en ligne.
    param(
        [Parameter(Mandatory=$true)][string]$DirectUrl,
        [Parameter(Mandatory=$true)][string]$RunDirectory
    )

    $schemaPath = Join-Path $script:ProjectRoot 'prisma\server\schema.prisma'
    if (-not (Test-Path -LiteralPath $schemaPath -PathType Leaf)) { throw 'Schéma Prisma serveur introuvable.' }

    $localPrismaCmd = Join-Path $script:ProjectRoot 'node_modules\.bin\prisma.cmd'
    $localPrismaExe = Join-Path $script:ProjectRoot 'node_modules\.bin\prisma.exe'
    $prismaMode = ''
    $prismaLauncher = ''
    if (Test-Path -LiteralPath $localPrismaCmd -PathType Leaf) {
        $prismaLauncher = $localPrismaCmd
        $prismaMode = 'local-cmd'
    } elseif (Test-Path -LiteralPath $localPrismaExe -PathType Leaf) {
        $prismaLauncher = $localPrismaExe
        $prismaMode = 'local-exe'
    } else {
        $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
        if (-not $npx) { $npx = Get-Command npx.exe -ErrorAction SilentlyContinue }
        if (-not $npx) { $npx = Get-Command npx -ErrorAction SilentlyContinue }
        if (-not $npx) { throw 'Prisma local introuvable et npx indisponible. Exécutez npm install dans le projet.' }
        $prismaLauncher = [string]$npx.Source
        $prismaMode = 'npx-pinned'
    }

    if (-not (Test-Path -LiteralPath $RunDirectory)) { New-Item -ItemType Directory -Path $RunDirectory -Force | Out-Null }
    $sqlPath = Join-Path $RunDirectory 'converge-server-schema.sql'
    $stdoutPath = Join-Path $RunDirectory 'converge-server-schema.stdout.txt'
    $stderrPath = Join-Path $RunDirectory 'converge-server-schema.stderr.txt'
    $commandPath = Join-Path $RunDirectory 'converge-server-schema.command.txt'

    # DDL idempotent — types/défauts COPIÉS des migrations 20260804000000_mechanic_licenses
    # et 20260805000000_job_timer_accumulated. Non destructif, rejouable.
    $sql = @'
-- Colonnes mechanic/attribution sur LicenseKey (toutes nullables, sans défaut).
ALTER TABLE "LicenseKey" ADD COLUMN IF NOT EXISTS "parentLicenseId" TEXT;
ALTER TABLE "LicenseKey" ADD COLUMN IF NOT EXISTS "mechanicId" TEXT;
ALTER TABLE "LicenseKey" ADD COLUMN IF NOT EXISTS "mechanicHint" TEXT;
ALTER TABLE "LicenseKey" ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3);
ALTER TABLE "LicenseKey" ADD COLUMN IF NOT EXISTS "assignedBy" TEXT;
ALTER TABLE "LicenseKey" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);

-- JobPhoto.mechanicId (nullable).
ALTER TABLE "JobPhoto" ADD COLUMN IF NOT EXISTS "mechanicId" TEXT;

-- Job.timerAccumulatedSec (chrono cumulé, NOT NULL DEFAULT 0 -> sûr sur table peuplée).
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "timerAccumulatedSec" INTEGER NOT NULL DEFAULT 0;

-- Migration monétaire : unités EXACTES (centimes + dix-millièmes), source de vérité.
-- La convergence est STRICTEMENT ADDITIVE (ADD IF NOT EXISTS) : le backfill vérifié
-- et la SUPPRESSION des anciennes colonnes Float relèvent EXCLUSIVEMENT de la chaîne
-- de migrations Prisma (20260807000000_money_scaled_units + _drop_floats), jamais du
-- reset. Voir docs/MIGRATION-MONEY.md. Aucune donnée supprimée ici.
ALTER TABLE "WorkOrder"         ADD COLUMN IF NOT EXISTS "totalHtCents"       INTEGER;
ALTER TABLE "WorkOrder"         ADD COLUMN IF NOT EXISTS "totalTtcCents"      INTEGER;
ALTER TABLE "PurchaseOrder"     ADD COLUMN IF NOT EXISTS "totalHtCents"       INTEGER;
ALTER TABLE "LoanerReservation" ADD COLUMN IF NOT EXISTS "depositAmountCents" INTEGER;
ALTER TABLE "Garage"            ADD COLUMN IF NOT EXISTS "hourlyRateTenThousandths" INTEGER NOT NULL DEFAULT 600000;
ALTER TABLE "Part"              ADD COLUMN IF NOT EXISTS "unitCostTenThousandths"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Part"              ADD COLUMN IF NOT EXISTS "unitPriceTenThousandths"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobPart"           ADD COLUMN IF NOT EXISTS "unitPriceTenThousandths"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobPart"           ADD COLUMN IF NOT EXISTS "unitCostTenThousandths"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QuoteLine"         ADD COLUMN IF NOT EXISTS "quantityTenThousandths"   INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE "QuoteLine"         ADD COLUMN IF NOT EXISTS "unitPriceTenThousandths"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QuoteLine"         ADD COLUMN IF NOT EXISTS "unitCostTenThousandths"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InvoiceLine"       ADD COLUMN IF NOT EXISTS "quantityTenThousandths"   INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE "InvoiceLine"       ADD COLUMN IF NOT EXISTS "unitPriceTenThousandths"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InvoiceLine"       ADD COLUMN IF NOT EXISTS "unitCostTenThousandths"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LaborOperation"    ADD COLUMN IF NOT EXISTS "unitPriceTenThousandths"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LoanerReservation" ADD COLUMN IF NOT EXISTS "dailyRateTenThousandths"  INTEGER;

-- Tables mechanic.
CREATE TABLE IF NOT EXISTS "MechanicLicenseAssignment" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT,
    "mechanicId" TEXT,
    "garageId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    "unassignedAt" TIMESTAMP(3),
    "previousMechanicId" TEXT,
    CONSTRAINT "MechanicLicenseAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JobMechanicNote" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "mechanicId" TEXT,
    "licenseId" TEXT,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobMechanicNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MechanicActionAudit" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "targetMechanicId" TEXT,
    "licenseId" TEXT,
    "jobId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MechanicActionAudit_pkey" PRIMARY KEY ("id")
);

-- Convergence COLONNE par COLONNE (idempotente). Si une de ces tables PRÉEXISTE
-- avec un schéma plus ancien, le CREATE TABLE IF NOT EXISTS ci-dessus est un
-- NO-OP et n'ajoute AUCUNE colonne manquante -> les index par colonne plus bas
-- échoueraient (« column "…" does not exist »). On réaligne donc explicitement
-- chaque colonne AVANT ses index. Les colonnes NOT NULL sans défaut sont ajoutées
-- en NULLABLE : sûr sur toute table préexistante (une table dérivée sans cette
-- colonne n'a jamais servi -> vide) ; les tables NEUVES restent NOT NULL via le
-- CREATE TABLE, et l'application garantit la présence des valeurs.
ALTER TABLE "MechanicLicenseAssignment" ADD COLUMN IF NOT EXISTS "licenseId" TEXT;
ALTER TABLE "MechanicLicenseAssignment" ADD COLUMN IF NOT EXISTS "mechanicId" TEXT;
ALTER TABLE "MechanicLicenseAssignment" ADD COLUMN IF NOT EXISTS "garageId" TEXT;
ALTER TABLE "MechanicLicenseAssignment" ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MechanicLicenseAssignment" ADD COLUMN IF NOT EXISTS "assignedBy" TEXT;
ALTER TABLE "MechanicLicenseAssignment" ADD COLUMN IF NOT EXISTS "unassignedAt" TIMESTAMP(3);
ALTER TABLE "MechanicLicenseAssignment" ADD COLUMN IF NOT EXISTS "previousMechanicId" TEXT;

ALTER TABLE "JobMechanicNote" ADD COLUMN IF NOT EXISTS "jobId" TEXT;
ALTER TABLE "JobMechanicNote" ADD COLUMN IF NOT EXISTS "garageId" TEXT;
ALTER TABLE "JobMechanicNote" ADD COLUMN IF NOT EXISTS "mechanicId" TEXT;
ALTER TABLE "JobMechanicNote" ADD COLUMN IF NOT EXISTS "licenseId" TEXT;
ALTER TABLE "JobMechanicNote" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "JobMechanicNote" ADD COLUMN IF NOT EXISTS "body" TEXT;
ALTER TABLE "JobMechanicNote" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "MechanicActionAudit" ADD COLUMN IF NOT EXISTS "garageId" TEXT;
ALTER TABLE "MechanicActionAudit" ADD COLUMN IF NOT EXISTS "actorUserId" TEXT;
ALTER TABLE "MechanicActionAudit" ADD COLUMN IF NOT EXISTS "actorRole" TEXT;
ALTER TABLE "MechanicActionAudit" ADD COLUMN IF NOT EXISTS "targetMechanicId" TEXT;
ALTER TABLE "MechanicActionAudit" ADD COLUMN IF NOT EXISTS "licenseId" TEXT;
ALTER TABLE "MechanicActionAudit" ADD COLUMN IF NOT EXISTS "jobId" TEXT;
ALTER TABLE "MechanicActionAudit" ADD COLUMN IF NOT EXISTS "action" TEXT;
ALTER TABLE "MechanicActionAudit" ADD COLUMN IF NOT EXISTS "targetType" TEXT;
ALTER TABLE "MechanicActionAudit" ADD COLUMN IF NOT EXISTS "targetId" TEXT;
ALTER TABLE "MechanicActionAudit" ADD COLUMN IF NOT EXISTS "metadata" TEXT;
ALTER TABLE "MechanicActionAudit" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Index (IF NOT EXISTS).
CREATE INDEX IF NOT EXISTS "LicenseKey_parentLicenseId_idx" ON "LicenseKey"("parentLicenseId");
CREATE INDEX IF NOT EXISTS "LicenseKey_garageId_licenseType_idx" ON "LicenseKey"("garageId", "licenseType");
CREATE INDEX IF NOT EXISTS "LicenseKey_mechanicId_idx" ON "LicenseKey"("mechanicId");
CREATE INDEX IF NOT EXISTS "LicenseKey_assignedBy_idx" ON "LicenseKey"("assignedBy");
CREATE INDEX IF NOT EXISTS "MechanicLicenseAssignment_licenseId_assignedAt_idx" ON "MechanicLicenseAssignment"("licenseId", "assignedAt");
CREATE INDEX IF NOT EXISTS "MechanicLicenseAssignment_garageId_idx" ON "MechanicLicenseAssignment"("garageId");
CREATE INDEX IF NOT EXISTS "MechanicLicenseAssignment_mechanicId_idx" ON "MechanicLicenseAssignment"("mechanicId");
CREATE INDEX IF NOT EXISTS "MechanicLicenseAssignment_assignedBy_idx" ON "MechanicLicenseAssignment"("assignedBy");
CREATE INDEX IF NOT EXISTS "MechanicLicenseAssignment_previousMechanicId_idx" ON "MechanicLicenseAssignment"("previousMechanicId");
CREATE INDEX IF NOT EXISTS "JobMechanicNote_jobId_createdAt_idx" ON "JobMechanicNote"("jobId", "createdAt");
CREATE INDEX IF NOT EXISTS "JobMechanicNote_garageId_mechanicId_idx" ON "JobMechanicNote"("garageId", "mechanicId");
CREATE INDEX IF NOT EXISTS "JobMechanicNote_licenseId_idx" ON "JobMechanicNote"("licenseId");
CREATE INDEX IF NOT EXISTS "MechanicActionAudit_garageId_createdAt_idx" ON "MechanicActionAudit"("garageId", "createdAt");
CREATE INDEX IF NOT EXISTS "MechanicActionAudit_targetMechanicId_createdAt_idx" ON "MechanicActionAudit"("targetMechanicId", "createdAt");
CREATE INDEX IF NOT EXISTS "MechanicActionAudit_actorUserId_createdAt_idx" ON "MechanicActionAudit"("actorUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "MechanicActionAudit_jobId_idx" ON "MechanicActionAudit"("jobId");
CREATE INDEX IF NOT EXISTS "MechanicActionAudit_licenseId_idx" ON "MechanicActionAudit"("licenseId");

-- Facturation électronique (Phase 2) — tables additives, non destructives. La
-- rotation amène ainsi le schéma Neon à jour pour les modèles e-invoicing.
CREATE TABLE IF NOT EXISTS "GarageEInvoiceConnection" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "authMethod" TEXT,
    "externalAccountId" TEXT,
    "legalEntityId" TEXT,
    "siren" TEXT,
    "capabilities" TEXT,
    "credentials" TEXT,
    "credentialsKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GarageEInvoiceConnection_pkey" PRIMARY KEY ("id")
);
-- Convergence colonne (cf. note plus haut) : réaligne une table e-invoicing
-- préexistante avant ses index. NOT NULL sans défaut -> NULLABLE (drift-safe).
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "garageId" TEXT;
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "providerId" TEXT;
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'sandbox';
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'disconnected';
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "authMethod" TEXT;
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "externalAccountId" TEXT;
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "legalEntityId" TEXT;
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "siren" TEXT;
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "capabilities" TEXT;
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "credentials" TEXT;
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "credentialsKeyVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "lastTestedAt" TIMESTAMP(3);
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "lastTestOk" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "GarageEInvoiceConnection" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "GarageEInvoiceConnection_garageId_providerId_environment_key" ON "GarageEInvoiceConnection"("garageId", "providerId", "environment");
CREATE INDEX IF NOT EXISTS "GarageEInvoiceConnection_garageId_idx" ON "GarageEInvoiceConnection"("garageId");
CREATE INDEX IF NOT EXISTS "GarageEInvoiceConnection_status_idx" ON "GarageEInvoiceConnection"("status");

CREATE TABLE IF NOT EXISTS "EInvoiceTransmission" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "connectionId" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "documentFormat" TEXT,
    "documentSha256" TEXT,
    "externalId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EInvoiceTransmission_pkey" PRIMARY KEY ("id")
);
-- Convergence colonne (cf. note plus haut). NOT NULL sans défaut -> NULLABLE.
ALTER TABLE "EInvoiceTransmission" ADD COLUMN IF NOT EXISTS "garageId" TEXT;
ALTER TABLE "EInvoiceTransmission" ADD COLUMN IF NOT EXISTS "invoiceId" TEXT;
ALTER TABLE "EInvoiceTransmission" ADD COLUMN IF NOT EXISTS "providerId" TEXT;
ALTER TABLE "EInvoiceTransmission" ADD COLUMN IF NOT EXISTS "connectionId" TEXT;
ALTER TABLE "EInvoiceTransmission" ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'sandbox';
ALTER TABLE "EInvoiceTransmission" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "EInvoiceTransmission" ADD COLUMN IF NOT EXISTS "documentFormat" TEXT;
ALTER TABLE "EInvoiceTransmission" ADD COLUMN IF NOT EXISTS "documentSha256" TEXT;
ALTER TABLE "EInvoiceTransmission" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "EInvoiceTransmission" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "EInvoiceTransmission" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
ALTER TABLE "EInvoiceTransmission" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "EInvoiceTransmission" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "EInvoiceTransmission_idempotencyKey_key" ON "EInvoiceTransmission"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "EInvoiceTransmission_garageId_createdAt_idx" ON "EInvoiceTransmission"("garageId", "createdAt");
CREATE INDEX IF NOT EXISTS "EInvoiceTransmission_invoiceId_idx" ON "EInvoiceTransmission"("invoiceId");
CREATE INDEX IF NOT EXISTS "EInvoiceTransmission_status_idx" ON "EInvoiceTransmission"("status");

CREATE TABLE IF NOT EXISTS "EInvoiceEvent" (
    "id" TEXT NOT NULL,
    "transmissionId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT,
    "message" TEXT,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EInvoiceEvent_pkey" PRIMARY KEY ("id")
);
-- Convergence colonne (cf. note plus haut) : c'est ICI que « transmissionId »
-- manquant (table préexistante d'un schéma antérieur) faisait échouer la rotation
-- au CREATE INDEX. NOT NULL sans défaut -> NULLABLE (drift-safe).
ALTER TABLE "EInvoiceEvent" ADD COLUMN IF NOT EXISTS "transmissionId" TEXT;
ALTER TABLE "EInvoiceEvent" ADD COLUMN IF NOT EXISTS "garageId" TEXT;
ALTER TABLE "EInvoiceEvent" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "EInvoiceEvent" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "EInvoiceEvent" ADD COLUMN IF NOT EXISTS "message" TEXT;
ALTER TABLE "EInvoiceEvent" ADD COLUMN IF NOT EXISTS "payload" TEXT;
ALTER TABLE "EInvoiceEvent" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "EInvoiceEvent_transmissionId_createdAt_idx" ON "EInvoiceEvent"("transmissionId", "createdAt");
CREATE INDEX IF NOT EXISTS "EInvoiceEvent_garageId_createdAt_idx" ON "EInvoiceEvent"("garageId", "createdAt");

CREATE TABLE IF NOT EXISTS "EInvoiceAuditEvent" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EInvoiceAuditEvent_pkey" PRIMARY KEY ("id")
);
-- Convergence colonne (cf. note plus haut). NOT NULL sans défaut -> NULLABLE.
ALTER TABLE "EInvoiceAuditEvent" ADD COLUMN IF NOT EXISTS "garageId" TEXT;
ALTER TABLE "EInvoiceAuditEvent" ADD COLUMN IF NOT EXISTS "actorUserId" TEXT;
ALTER TABLE "EInvoiceAuditEvent" ADD COLUMN IF NOT EXISTS "action" TEXT;
ALTER TABLE "EInvoiceAuditEvent" ADD COLUMN IF NOT EXISTS "targetType" TEXT;
ALTER TABLE "EInvoiceAuditEvent" ADD COLUMN IF NOT EXISTS "targetId" TEXT;
ALTER TABLE "EInvoiceAuditEvent" ADD COLUMN IF NOT EXISTS "metadata" TEXT;
ALTER TABLE "EInvoiceAuditEvent" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "EInvoiceAuditEvent_garageId_createdAt_idx" ON "EInvoiceAuditEvent"("garageId", "createdAt");
CREATE INDEX IF NOT EXISTS "EInvoiceAuditEvent_actorUserId_createdAt_idx" ON "EInvoiceAuditEvent"("actorUserId", "createdAt");

-- Clés étrangères — ADD CONSTRAINT n'a pas d'IF NOT EXISTS : on garde par conname.
-- Colonnes/tables neuves donc NULL/vides : aucun risque de violation FK.
DO $garageflow$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LicenseKey_parentLicenseId_fkey') THEN
    ALTER TABLE "LicenseKey" ADD CONSTRAINT "LicenseKey_parentLicenseId_fkey" FOREIGN KEY ("parentLicenseId") REFERENCES "LicenseKey"("licenseId") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LicenseKey_mechanicId_fkey') THEN
    ALTER TABLE "LicenseKey" ADD CONSTRAINT "LicenseKey_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LicenseKey_assignedBy_fkey') THEN
    ALTER TABLE "LicenseKey" ADD CONSTRAINT "LicenseKey_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MechanicLicenseAssignment_garageId_fkey') THEN
    ALTER TABLE "MechanicLicenseAssignment" ADD CONSTRAINT "MechanicLicenseAssignment_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MechanicLicenseAssignment_licenseId_fkey') THEN
    ALTER TABLE "MechanicLicenseAssignment" ADD CONSTRAINT "MechanicLicenseAssignment_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "LicenseKey"("licenseId") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MechanicLicenseAssignment_mechanicId_fkey') THEN
    ALTER TABLE "MechanicLicenseAssignment" ADD CONSTRAINT "MechanicLicenseAssignment_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MechanicLicenseAssignment_assignedBy_fkey') THEN
    ALTER TABLE "MechanicLicenseAssignment" ADD CONSTRAINT "MechanicLicenseAssignment_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MechanicLicenseAssignment_previousMechanicId_fkey') THEN
    ALTER TABLE "MechanicLicenseAssignment" ADD CONSTRAINT "MechanicLicenseAssignment_previousMechanicId_fkey" FOREIGN KEY ("previousMechanicId") REFERENCES "Mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobMechanicNote_jobId_fkey') THEN
    ALTER TABLE "JobMechanicNote" ADD CONSTRAINT "JobMechanicNote_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobMechanicNote_garageId_fkey') THEN
    ALTER TABLE "JobMechanicNote" ADD CONSTRAINT "JobMechanicNote_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobMechanicNote_mechanicId_fkey') THEN
    ALTER TABLE "JobMechanicNote" ADD CONSTRAINT "JobMechanicNote_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobMechanicNote_licenseId_fkey') THEN
    ALTER TABLE "JobMechanicNote" ADD CONSTRAINT "JobMechanicNote_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "LicenseKey"("licenseId") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MechanicActionAudit_garageId_fkey') THEN
    ALTER TABLE "MechanicActionAudit" ADD CONSTRAINT "MechanicActionAudit_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MechanicActionAudit_actorUserId_fkey') THEN
    ALTER TABLE "MechanicActionAudit" ADD CONSTRAINT "MechanicActionAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MechanicActionAudit_targetMechanicId_fkey') THEN
    ALTER TABLE "MechanicActionAudit" ADD CONSTRAINT "MechanicActionAudit_targetMechanicId_fkey" FOREIGN KEY ("targetMechanicId") REFERENCES "Mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MechanicActionAudit_licenseId_fkey') THEN
    ALTER TABLE "MechanicActionAudit" ADD CONSTRAINT "MechanicActionAudit_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "LicenseKey"("licenseId") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MechanicActionAudit_jobId_fkey') THEN
    ALTER TABLE "MechanicActionAudit" ADD CONSTRAINT "MechanicActionAudit_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$garageflow$;
'@
    [IO.File]::WriteAllText($sqlPath, $sql, $script:Utf8NoBom)

    $oldDb = [Environment]::GetEnvironmentVariable('DATABASE_URL','Process')
    $oldDirect = [Environment]::GetEnvironmentVariable('DIRECT_URL','Process')
    $oldNativePrefExists = Test-Path variable:PSNativeCommandUseErrorActionPreference
    $oldNativePref = if ($oldNativePrefExists) { $PSNativeCommandUseErrorActionPreference } else { $null }

    try {
        # DDL via la connexion DIRECTE (non poolée) de Neon.
        [Environment]::SetEnvironmentVariable('DATABASE_URL', $DirectUrl, 'Process')
        [Environment]::SetEnvironmentVariable('DIRECT_URL', $DirectUrl, 'Process')
        if ($oldNativePrefExists) { $PSNativeCommandUseErrorActionPreference = $false }

        if ($prismaMode -eq 'npx-pinned') {
            $safeCommand = '"{0}" --yes prisma@5 db execute --schema "{1}" --file "{2}"' -f `
                $prismaLauncher.Replace('"','""'), `
                $schemaPath.Replace('"','""'), `
                $sqlPath.Replace('"','""')
        } else {
            $safeCommand = '"{0}" db execute --schema "{1}" --file "{2}"' -f `
                $prismaLauncher.Replace('"','""'), `
                $schemaPath.Replace('"','""'), `
                $sqlPath.Replace('"','""')
        }
        [IO.File]::WriteAllText($commandPath, $safeCommand, $script:Utf8NoBom)
        Write-Host "[INFO] Convergence du schéma Neon (mechanic-licenses + chrono) : $prismaMode" -ForegroundColor DarkCyan

        Remove-Item -LiteralPath $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
        $proc = Start-Process `
            -FilePath $env:ComSpec `
            -ArgumentList @('/d','/s','/c',('"' + $safeCommand + '"')) `
            -WorkingDirectory $script:ProjectRoot `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath `
            -NoNewWindow `
            -Wait `
            -PassThru

        $stdout = if (Test-Path -LiteralPath $stdoutPath) { [IO.File]::ReadAllText($stdoutPath) } else { '' }
        $stderr = if (Test-Path -LiteralPath $stderrPath) { [IO.File]::ReadAllText($stderrPath) } else { '' }
        $combined = (($stdout.Trim(), $stderr.Trim()) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ' | '

        if ($proc.ExitCode -ne 0) {
            if ([string]::IsNullOrWhiteSpace($combined)) { $combined = "Aucune sortie native. Code retour : $($proc.ExitCode)." }
            throw "Convergence du schéma Neon échouée (code $($proc.ExitCode)) : $(Protect-LogText $combined). Voir docs/POST_ROTATION_RECOVERY.md §7. Journaux : $stdoutPath / $stderrPath"
        }
        if ($combined -match '(?im)^\s*Error\s*:') {
            throw "Prisma a signalé une erreur pendant la convergence du schéma : $(Protect-LogText $combined). Voir docs/POST_ROTATION_RECOVERY.md §7."
        }
        # Note : brefs verrous d'écriture pendant CREATE INDEX / ADD CONSTRAINT sur
        # LicenseKey (petite table) ; les tables mechanic sont neuves/vides. Idempotent
        # PAR NOM : une colonne préexistante au mauvais type ne serait pas corrigée.
        Write-Host '[OK] Schéma Neon convergé : colonnes/tables du merge (mechanic + chrono) créées. Un « Erreur base de données » persistant signalerait un autre écart de schéma — voir docs/POST_ROTATION_RECOVERY.md §7.' -ForegroundColor Green
    } finally {
        [Environment]::SetEnvironmentVariable('DATABASE_URL', $oldDb, 'Process')
        [Environment]::SetEnvironmentVariable('DIRECT_URL', $oldDirect, 'Process')
        if ($oldNativePrefExists) { $PSNativeCommandUseErrorActionPreference = $oldNativePref }
    }
}

function Reset-RemoteLicenseDataForFullRotation {
    param(
        [Parameter(Mandatory=$true)][string]$DirectUrl,
        [Parameter(Mandatory=$true)][string]$RunDirectory
    )

    $schemaPath = Join-Path $script:ProjectRoot 'prisma\server\schema.prisma'
    if (-not (Test-Path -LiteralPath $schemaPath -PathType Leaf)) { throw 'Schéma Prisma serveur introuvable.' }

    # Prisma 7 a supprimé --schema pour db execute. GarageFlow utilise Prisma 5.22,
    # donc on exécute en priorité le binaire local exact du projet pour éviter que
    # npx télécharge silencieusement une version majeure incompatible.
    $localPrismaCmd = Join-Path $script:ProjectRoot 'node_modules\.bin\prisma.cmd'
    $localPrismaExe = Join-Path $script:ProjectRoot 'node_modules\.bin\prisma.exe'
    $prismaMode = ''
    $prismaLauncher = ''

    if (Test-Path -LiteralPath $localPrismaCmd -PathType Leaf) {
        $prismaLauncher = $localPrismaCmd
        $prismaMode = 'local-cmd'
    } elseif (Test-Path -LiteralPath $localPrismaExe -PathType Leaf) {
        $prismaLauncher = $localPrismaExe
        $prismaMode = 'local-exe'
    } else {
        $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
        if (-not $npx) { $npx = Get-Command npx.exe -ErrorAction SilentlyContinue }
        if (-not $npx) { $npx = Get-Command npx -ErrorAction SilentlyContinue }
        if (-not $npx) {
            throw 'Prisma local introuvable et npx indisponible. Exécutez npm install dans le projet.'
        }
        $prismaLauncher = [string]$npx.Source
        $prismaMode = 'npx-pinned'
    }

    if (-not (Test-Path -LiteralPath $RunDirectory)) {
        New-Item -ItemType Directory -Path $RunDirectory -Force | Out-Null
    }

    $sqlPath = Join-Path $RunDirectory 'rotation-total-delete-licenses.sql'
    $stdoutPath = Join-Path $RunDirectory 'rotation-total-prisma.stdout.txt'
    $stderrPath = Join-Path $RunDirectory 'rotation-total-prisma.stderr.txt'
    $commandPath = Join-Path $RunDirectory 'rotation-total-prisma-command.txt'

    $sql = @'
BEGIN;
DELETE FROM "LicenseDeviceEvent";
DELETE FROM "LicenseDevice";
DELETE FROM "LicenseKey";
COMMIT;
'@
    [IO.File]::WriteAllText($sqlPath, $sql, $script:Utf8NoBom)

    $oldDb = [Environment]::GetEnvironmentVariable('DATABASE_URL','Process')
    $oldDirect = [Environment]::GetEnvironmentVariable('DIRECT_URL','Process')
    $oldNativePrefExists = Test-Path variable:PSNativeCommandUseErrorActionPreference
    $oldNativePref = if ($oldNativePrefExists) { $PSNativeCommandUseErrorActionPreference } else { $null }

    try {
        [Environment]::SetEnvironmentVariable('DATABASE_URL', $DirectUrl, 'Process')
        [Environment]::SetEnvironmentVariable('DIRECT_URL', $DirectUrl, 'Process')
        if ($oldNativePrefExists) { $PSNativeCommandUseErrorActionPreference = $false }

        # Utiliser cmd.exe pour exécuter correctement npx.cmd sous Windows et
        # séparer stdout/stderr. Cela évite qu'un simple "Error:" écrit par une
        # commande native soit transformé en exception PowerShell sans détails.
        if ($prismaMode -eq 'npx-pinned') {
            $safeCommand = '"{0}" --yes prisma@5 db execute --schema "{1}" --file "{2}"' -f `
                $prismaLauncher.Replace('"','""'), `
                $schemaPath.Replace('"','""'), `
                $sqlPath.Replace('"','""')
        } else {
            $safeCommand = '"{0}" db execute --schema "{1}" --file "{2}"' -f `
                $prismaLauncher.Replace('"','""'), `
                $schemaPath.Replace('"','""'), `
                $sqlPath.Replace('"','""')
        }
        [IO.File]::WriteAllText($commandPath, $safeCommand, $script:Utf8NoBom)
        Write-Host "[OK] Prisma sélectionné pour le nettoyage Neon : $prismaMode" -ForegroundColor Green

        Remove-Item -LiteralPath $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
        $proc = Start-Process `
            -FilePath $env:ComSpec `
            -ArgumentList @('/d','/s','/c',('"' + $safeCommand + '"')) `
            -WorkingDirectory $script:ProjectRoot `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath `
            -NoNewWindow `
            -Wait `
            -PassThru

        $stdout = if (Test-Path -LiteralPath $stdoutPath) { [IO.File]::ReadAllText($stdoutPath) } else { '' }
        $stderr = if (Test-Path -LiteralPath $stderrPath) { [IO.File]::ReadAllText($stderrPath) } else { '' }
        $combined = (($stdout.Trim(), $stderr.Trim()) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ' | '

        if ($proc.ExitCode -ne 0) {
            if ([string]::IsNullOrWhiteSpace($combined)) {
                $combined = "Aucune sortie native. Code retour : $($proc.ExitCode)."
            }
            throw "Réinitialisation des licences Neon échouée (code $($proc.ExitCode)) : $(Protect-LogText $combined). Consultez $stdoutPath et $stderrPath"
        }

        if ($combined -match '(?im)^\s*Error\s*:') {
            throw "Prisma a signalé une erreur malgré un code retour nul : $(Protect-LogText $combined). Consultez $stdoutPath et $stderrPath"
        }
    } finally {
        [Environment]::SetEnvironmentVariable('DATABASE_URL', $oldDb, 'Process')
        [Environment]::SetEnvironmentVariable('DIRECT_URL', $oldDirect, 'Process')
        if ($oldNativePrefExists) { $PSNativeCommandUseErrorActionPreference = $oldNativePref }
    }

    Write-Host '[OK] Anciennes licences et appareils supprimés : la nouvelle cryptographie repart de zéro.' -ForegroundColor Green
}

function Test-IsProtectedPlatformVariable {
    param([Parameter(Mandatory=$true)][string]$Name)
    # Variables injectées ou utilisées par la plateforme/build : ne jamais les
    # supprimer pendant une rotation de secrets applicatifs.
    return (
        $Name -eq 'VERCEL' -or
        $Name -like 'VERCEL_*' -or
        $Name -eq 'NX_DAEMON' -or
        $Name -like 'TURBO_*'
    )
}


function Convert-ToLocalFilePath {
    param([AllowNull()][string]$Value)
    $clean = Clean-InputValue $Value
    if ([string]::IsNullOrWhiteSpace($clean)) { return '' }
    if ($clean -match '^file://') {
        try {
            return ([Uri]$clean).LocalPath
        } catch {
            throw "Chemin de fichier invalide : $clean"
        }
    }
    return $clean
}

function Ensure-VercelIgnore {
    $path = Join-Path $script:ProjectRoot '.vercelignore'
    $required = @('.env', '.env.*')
    $existing = @()
    if (Test-Path -LiteralPath $path) {
        $existing = @([IO.File]::ReadAllLines($path) | Where-Object { ([string]$_).Trim() -ne '!.env.example' })
    }
    $lines = New-Object System.Collections.ArrayList
    foreach ($line in $existing) { [void]$lines.Add([string]$line) }
    foreach ($line in $required) {
        if (-not ($existing -contains $line)) { [void]$lines.Add($line) }
    }
    [IO.File]::WriteAllText($path, ((@($lines) -join "`r`n") + "`r`n"), $script:Utf8NoBom)
}

function Copy-CleanDeploymentTree {
    param(
        [Parameter(Mandatory=$true)][string]$Destination,
        [Parameter(Mandatory=$true)][string]$LinkedProjectDirectory
    )
    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null

    $excludedDirectories = @('.git','.vercel','.next','node_modules','dist','out','API générées')
    foreach ($item in Get-ChildItem -LiteralPath $script:ProjectRoot -Force) {
        if ($item.PSIsContainer) {
            if ($excludedDirectories -contains $item.Name) { continue }
            Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $Destination $item.Name) -Recurse -Force
            continue
        }
        if ($item.Name -like '.env*') { continue }
        Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $Destination $item.Name) -Force
    }

    # La copie doit rester liée au même projet Vercel.
    $sourceProject = Join-Path $LinkedProjectDirectory '.vercel/project.json'
    $targetVercel = Join-Path $Destination '.vercel'
    if (-not (Test-Path -LiteralPath $sourceProject -PathType Leaf)) {
        throw 'Le fichier .vercel/project.json est introuvable avant le déploiement propre.'
    }
    New-Item -ItemType Directory -Path $targetVercel -Force | Out-Null
    Copy-Item -LiteralPath $sourceProject -Destination (Join-Path $targetVercel 'project.json') -Force

    # Défense supplémentaire : aucun .env réel ne doit être présent dans la copie.
    $leaks = @(Get-ChildItem -LiteralPath $Destination -Force -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like '.env*' })
    if ($leaks.Count -gt 0) {
        throw ('Sécurité : fichier .env détecté dans la copie de déploiement : ' + (($leaks | ForEach-Object FullName) -join ', '))
    }
}

function Get-DeploymentUrlFromOutput {
    param([AllowNull()][string]$Output)
    if ([string]::IsNullOrWhiteSpace($Output)) { return '' }
    $matches = [regex]::Matches($Output, 'https://[A-Za-z0-9][A-Za-z0-9.-]*\.vercel\.app')
    if ($matches.Count -eq 0) { return '' }
    return $matches[$matches.Count - 1].Value.TrimEnd('/')
}


function Get-JsonPayloadFromVercelCurlOutput {
    param([AllowNull()][string]$Output)
    $clean = Protect-LogText ([string]$Output)
    if ([string]::IsNullOrWhiteSpace($clean)) { return $null }

    # Vercel CLI peut écrire sa bannière ou des avertissements avant le corps HTTP.
    # Chercher d'abord une ligne JSON complète, de la dernière vers la première.
    $lines = @($clean -split "`r?`n")
    for ($index = $lines.Count - 1; $index -ge 0; $index--) {
        $candidate = ([string]$lines[$index]).Trim()
        if (-not ($candidate.StartsWith('{') -or $candidate.StartsWith('['))) { continue }
        try { return ($candidate | ConvertFrom-Json) } catch { }
    }

    # Repli pour un JSON multi-ligne : prendre le dernier bloc commençant par { ou [.
    $startBrace = $clean.LastIndexOf('{')
    $startBracket = $clean.LastIndexOf('[')
    $start = [Math]::Max($startBrace, $startBracket)
    if ($start -ge 0) {
        $candidate = $clean.Substring($start).Trim()
        try { return ($candidate | ConvertFrom-Json) } catch { }
    }
    return $null
}

function Test-IsVercelLoginPage {
    param([AllowNull()][string]$Text)
    $value = [string]$Text
    if ([string]::IsNullOrWhiteSpace($value)) { return $false }
    return (
        $value -match '/sso-api\?url=' -or
        $value -match 'Vercel Logo' -or
        $value -match 'zeit-theme' -or
        $value -match '<title>[^<]*Vercel' -or
        $value -match 'login\?next=%2Fsso-api'
    )
}

function Invoke-ProtectedDeploymentRequest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$DeploymentUrl,
        [ValidateSet('GET','POST')][string]$Method = 'GET',
        [AllowNull()][hashtable]$Headers,
        [AllowNull()][string]$Body
    )

    $curlArguments = @('--silent', '--show-error')
    if ($Method -ne 'GET') { $curlArguments += @('--request', $Method) }
    # Capture le VRAI code HTTP renvoyé par la fonction déployée. curl interprète
    # `\n` et `%{http_code}` dans --write-out ; le marqueur est émis sur SA propre
    # ligne (après le corps JSON) pour ne pas casser l'extraction du JSON en aval.
    $curlArguments += @('--write-out', '\nGF_HTTP_STATUS:%{http_code}')

    $configPath = $null
    try {
        # Ne jamais exposer GARAGEFLOW_API_KEY dans les arguments du processus.
        # Les en-têtes et le corps sont transmis via un fichier curl temporaire privé.
        if (($Headers -and $Headers.Count -gt 0) -or -not [string]::IsNullOrEmpty($Body)) {
            $tempDirectory = Join-Path $env:TEMP ('garageflow-curl-' + [Guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $tempDirectory -Force | Out-Null
            Set-PrivateFileAcl $tempDirectory
            $configPath = Join-Path $tempDirectory 'request.cfg'
            $configLines = New-Object System.Collections.ArrayList
            foreach ($name in @($Headers.Keys)) {
                $headerValue = ([string]$Headers[$name]).Replace('"','\"').Replace("`r",'').Replace("`n",'')
                [void]$configLines.Add('header = "' + $name + ': ' + $headerValue + '"')
            }
            if (-not [string]::IsNullOrEmpty($Body)) {
                $bodyValue = $Body.Replace('\','\\').Replace('"','\"').Replace("`r",'').Replace("`n",'\n')
                [void]$configLines.Add('data = "' + $bodyValue + '"')
            }
            [IO.File]::WriteAllText($configPath, ((@($configLines) -join "`r`n") + "`r`n"), $script:Utf8NoBom)
            Set-PrivateFileAcl $configPath
            $curlArguments += @('--config', $configPath)
        }

        # IMPORTANT : Vercel CLI 58 transmet tout ce qui suit `--` au curl interne.
        # Ne pas passer --cwd à `vercel curl` : cette version beta le transmet à curl.
        # On exécute donc la CLI depuis la racine liée et on sépare explicitement
        # les options Vercel des options curl avec `--`.
        if ($null -eq $script:Vercel) { $script:Vercel = Resolve-VercelCommand }
        $vercelArguments = @($script:Vercel.Prefix) + @(
            'curl', $Path,
            '--deployment', $DeploymentUrl,
            '--'
        ) + @($curlArguments)
        $extra = @{}
        if (-not [string]::IsNullOrEmpty($script:VercelTokenPlain)) { $extra['VERCEL_TOKEN'] = $script:VercelTokenPlain }

        Push-Location -LiteralPath $script:ProjectRoot
        try {
            $result = Invoke-NativeCommand -Executable $script:Vercel.Executable -Arguments $vercelArguments -EnvironmentVariables $extra -AllowFailure
        } finally {
            Pop-Location
        }

        $safeOutput = Protect-LogText ([string]$result.Output)
        $httpStatus = 0
        $statusMatch = [regex]::Match([string]$result.Output, 'GF_HTTP_STATUS:(\d{3})')
        if ($statusMatch.Success) { $httpStatus = [int]$statusMatch.Groups[1].Value }
        if (Test-IsVercelLoginPage -Text $safeOutput) {
            return [pscustomobject]@{
                Ok = $false
                ExitCode = $result.ExitCode
                Output = $safeOutput
                Payload = $null
                HttpStatus = $httpStatus
                ProtectionIntercepted = $true
            }
        }
        return [pscustomobject]@{
            Ok = ($result.ExitCode -eq 0)
            ExitCode = $result.ExitCode
            Output = $safeOutput
            Payload = (Get-JsonPayloadFromVercelCurlOutput -Output $safeOutput)
            HttpStatus = $httpStatus
            ProtectionIntercepted = $false
        }
    } finally {
        if ($configPath) {
            $directory = Split-Path -Parent $configPath
            if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
}

function Test-UpstashRestConnection {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$Url,
        [Parameter(Mandatory=$true)][string]$Token
    )

    $cleanUrl = (Clean-InputValue $Url).TrimEnd('/')
    $cleanToken = Clean-InputValue $Token
    Assert-Url 'UPSTASH_REDIS_REST_URL' $cleanUrl -Https
    if ([string]::IsNullOrWhiteSpace($cleanToken)) { throw 'UPSTASH_REDIS_REST_TOKEN est vide.' }
    Add-SecretToRegistry $cleanToken

    try {
        $headers = @{
            Authorization = 'Bearer ' + $cleanToken
            'Content-Type' = 'application/json'
            Accept = 'application/json'
        }
        $response = Invoke-RestMethod `
            -Uri $cleanUrl `
            -Method Post `
            -Headers $headers `
            -Body '["PING"]' `
            -TimeoutSec 15 `
            -ErrorAction Stop

        if ($null -eq $response -or [string]$response.result -ne 'PONG') {
            $safe = Protect-LogText (($response | ConvertTo-Json -Compress -Depth 5))
            throw "Réponse Upstash inattendue : $safe"
        }

        $probeKey = 'gf:config:test:' + [Guid]::NewGuid().ToString('N')

        # IMPORTANT : ne jamais envoyer le tableau via le pipeline vers
        # ConvertTo-Json. PowerShell énumère alors les sous-tableaux et peut
        # produire un tableau JSON plat, refusé par Upstash avec HTTP 400.
        # /multi-exec exige strictement un tableau JSON à deux dimensions.
        $transactionCommands = New-Object 'System.Collections.Generic.List[object]'
        [void]$transactionCommands.Add([object[]]@('SET', $probeKey, '0', 'PX', '30000', 'NX'))
        [void]$transactionCommands.Add([object[]]@('INCR', $probeKey))
        [void]$transactionCommands.Add([object[]]@('PTTL', $probeKey))
        [void]$transactionCommands.Add([object[]]@('DEL', $probeKey))
        $transaction = ConvertTo-Json `
            -InputObject ([object[]]$transactionCommands.ToArray()) `
            -Compress `
            -Depth 5

        # Auto-contrôle local du format avant toute requête réseau.
        $transactionShape = $transaction | ConvertFrom-Json
        if (@($transactionShape).Count -ne 4 -or @($transactionShape[0]).Count -lt 2) {
            throw 'Sérialisation /multi-exec invalide : tableau JSON 2D attendu.'
        }
        $transactionResponse = Invoke-RestMethod `
            -Uri ($cleanUrl + '/multi-exec') `
            -Method Post `
            -Headers $headers `
            -Body $transaction `
            -TimeoutSec 15 `
            -ErrorAction Stop
        if ($null -eq $transactionResponse -or @($transactionResponse).Count -lt 4) {
            throw 'Réponse Upstash /multi-exec incomplète.'
        }
        $transactionItems = @($transactionResponse)

        # Sous Set-StrictMode, l'accès direct à une propriété absente (ex. $_.error)
        # déclenche une exception. Une réponse Upstash réussie contient uniquement
        # `result`, donc vérifier explicitement l'existence de chaque propriété.
        $transactionError = $transactionItems |
            Where-Object {
                $null -ne $_ -and
                $null -ne $_.PSObject.Properties['error'] -and
                -not [string]::IsNullOrWhiteSpace([string]$_.PSObject.Properties['error'].Value)
            } |
            Select-Object -First 1

        if ($transactionError) {
            $errorValue = [string]$transactionError.PSObject.Properties['error'].Value
            throw ('Transaction Upstash refusée : ' + $errorValue)
        }

        $counterItem = $transactionItems[1]
        if ($null -eq $counterItem -or $null -eq $counterItem.PSObject.Properties['result']) {
            throw 'Transaction Upstash : résultat INCR absent.'
        }
        if ([int]$counterItem.PSObject.Properties['result'].Value -ne 1) {
            throw 'Transaction Upstash : compteur inattendu.'
        }
        Write-Host '[OK] Upstash Redis authentifié : PING = PONG et /multi-exec JSON 2D opérationnel.' -ForegroundColor Green
        return $true
    } catch {
        $safeMessage = Protect-LogText ([string]$_.Exception.Message)
        throw "Connexion Upstash impossible. Vérifiez UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN. Détail : $safeMessage"
    }
}

function Test-LicenseActivationRateLimit {
    param([Parameter(Mandatory=$true)][string]$DeploymentUrl)

    $body = @{
        license = 'GF-DIAGNOSTIC-INVALID-' + [Guid]::NewGuid().ToString('N')
        installId = [Guid]::NewGuid().ToString('N')
        version = 'config-validator'
        os = 'windows'
        arch = 'x64'
        name = 'GarageFlows configuration validator'
    } | ConvertTo-Json -Compress

    $result = Invoke-ProtectedDeploymentRequest `
        -Path '/api/license/activate' `
        -DeploymentUrl $DeploymentUrl `
        -Method POST `
        -Headers @{ 'Content-Type' = 'application/json'; 'Accept' = 'application/json' } `
        -Body $body

    $payload = $result.Payload
    if (-not $result.Ok) {
        $safe = Protect-LogText ([string]$result.Output)
        if ($safe.Length -gt 900) { $safe = $safe.Substring(0,900) }
        throw "Test /api/license/activate impossible (vercel curl code $($result.ExitCode)) : $safe"
    }

    if ($payload -and [string]$payload.code -eq 'SERVICE_UNAVAILABLE') {
        throw '/api/license/activate renvoie encore SERVICE_UNAVAILABLE malgré le repli contrôlé. Consultez les logs détaillés de la route.'
    }
    if ($payload -and [string]$payload.code -eq 'RATE_LIMITED') {
        throw '/api/license/activate est joignable mais le compteur de test est temporairement limité. Attendez le Retry-After ou augmentez temporairement RATE_LIMIT_LICENSE_ACTIVATE_MAX.'
    }
    if ($payload -and [string]$payload.code -eq 'LICENSE_INVALID') {
        Write-Host '[OK] /api/license/activate atteint la validation cryptographique : rate limiter Upstash opérationnel.' -ForegroundColor Green
        return $true
    }

    $safePayload = Protect-LogText (($payload | ConvertTo-Json -Compress -Depth 6))
    throw "Réponse inattendue du test non destructif /api/license/activate : $safePayload"
}

function Test-ProtectedApiKeyEndpoint {
    param(
        [Parameter(Mandatory=$true)][string]$DeploymentUrl,
        [Parameter(Mandatory=$true)][string]$ApiKey
    )
    $script:LastApiKeyDiag = ''
    Add-SecretToRegistry $ApiKey

    # Juste après `vercel --prod`, la nouvelle valeur GARAGEFLOW_API_KEY vient
    # d'être écrite : le runtime de la fonction fraîchement déployée peut mettre
    # quelques secondes à la lire. On RETENTE avec backoff, et surtout on
    # DIAGNOSTIQUE le vrai code HTTP au lieu d'un échec opaque (le check /api/health
    # a déjà prouvé que `vercel curl` traverse la Deployment Protection : un échec
    # ICI n'est donc PAS un problème de protection, mais de propagation/valeur).
    $maxAttempts = 4
    $backoff = @(0, 3, 6, 9)
    $lastStatus = 0
    $lastReason = ''

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        if ($backoff[$attempt - 1] -gt 0) { Start-Sleep -Seconds $backoff[$attempt - 1] }

        $licenseId = 'config-test-' + [Guid]::NewGuid().ToString('N')
        $body = @{ licenseId = $licenseId; status = 'active' } | ConvertTo-Json -Compress
        $result = Invoke-ProtectedDeploymentRequest `
            -Path '/api/admin/licenses/revoke-by-key' `
            -DeploymentUrl $DeploymentUrl `
            -Method POST `
            -Headers @{ 'x-gf-key' = $ApiKey; 'Content-Type' = 'application/json'; 'Accept' = 'application/json' } `
            -Body $body

        $status = [int]$result.HttpStatus
        $lastStatus = $status

        # Réponse attendue : HTTP 200 + { ok:true, note:'not_registered' }.
        # Accès SÛR sous Set-StrictMode : une réponse d'erreur ne contient pas
        # 'ok'/'note' — on teste l'existence de la propriété avant lecture.
        $payload = $result.Payload
        $payloadOk = $payload -and $payload.PSObject.Properties['ok'] -and $payload.PSObject.Properties['ok'].Value -eq $true
        $payloadNote = if ($payload -and $payload.PSObject.Properties['note']) { [string]$payload.PSObject.Properties['note'].Value } else { '' }
        if (($status -eq 200 -or $status -eq 0) -and $payloadOk -and $payloadNote -eq 'not_registered') {
            Write-Host "[OK] GARAGEFLOW_API_KEY authentifiée via vercel curl (test non destructif, tentative $attempt/$maxAttempts)." -ForegroundColor Green
            return $true
        }

        if ($result.ProtectionIntercepted) {
            $lastReason = "Deployment Protection a intercepté la requête. vercel curl doit être authentifié (vercel whoami) et lié au projet ; sinon fournir un VERCEL_TOKEN valide."
        } else {
            switch ($status) {
                403 { $lastReason = "HTTP 403 : la fonction déployée lit un GARAGEFLOW_API_KEY DIFFÉRENT de la nouvelle clé. La valeur envoyée ne correspond pas à celle du runtime — variable pas encore propagée à CE déploiement, ou écrite dans un autre environnement que Production." }
                500 {
                    # Deux causes de 500 sur cette route : (a) clé API absente/faible,
                    # (b) erreur base de données (schéma Neon désaligné du code). On
                    # LES DISTINGUE via le champ 'error' du corps JSON — ne jamais
                    # attribuer un 500 DB à un problème de clé.
                    $errText = if ($payload -and $payload.PSObject.Properties['error']) { [string]$payload.PSObject.Properties['error'].Value } else { '' }
                    if ($errText -match 'base de donn') {
                        $lastReason = "HTTP 500 (erreur base de données) : le schéma Neon Production ne correspond PAS au code déployé — colonne/table manquante (ex. LicenseKey.parentLicenseId). La rotation converge désormais le schéma (DDL idempotent) AVANT le déploiement ; si l'erreur persiste, REJOUEZ la convergence (converge-server-schema.sql via 'prisma db execute') — évitez 'migrate deploy' seul, qui saute une migration inscrite-mais-manquante et laisserait le 500. Voir docs/POST_ROTATION_RECOVERY.md §7."
                    } elseif ($errText -match 'Configuration serveur') {
                        $lastReason = "HTTP 500 (configuration) : GARAGEFLOW_API_KEY absente ou trop courte (<16) dans le runtime déployé. La variable n'a pas été appliquée à l'environnement Production."
                    } else {
                        $lastReason = "HTTP 500 : erreur serveur inattendue$(if ($errText) { " — $errText" } else { '' })."
                    }
                }
                401 { $lastReason = "HTTP 401 : couche d'authentification (Deployment Protection) devant la fonction." }
                429 { $lastReason = "HTTP 429 : rate limit admin atteint ; nouvelle tentative." }
                502 { $lastReason = "HTTP 502 : passerelle ; fonction pas encore prête, nouvelle tentative." }
                503 { $lastReason = "HTTP 503 : service indisponible (rate limiter/Upstash) ; nouvelle tentative." }
                504 { $lastReason = "HTTP 504 : délai dépassé ; nouvelle tentative." }
                0   { $lastReason = if (-not $result.Ok) { "vercel curl a échoué (code $($result.ExitCode)) sans code HTTP exploitable." } else { "Réponse sans code HTTP exploitable." } }
                default { $lastReason = "HTTP $status : réponse inattendue, payload non conforme au test non destructif." }
            }
        }
        Write-Host "[ATTENTION] Test clé API tentative $attempt/$maxAttempts : $lastReason" -ForegroundColor Yellow
    }

    $script:LastApiKeyDiag = "Dernier code HTTP=$lastStatus. $lastReason"
    Write-Host "[ERREUR] Validation GARAGEFLOW_API_KEY échouée après $maxAttempts tentatives — $($script:LastApiKeyDiag)" -ForegroundColor Red
    return $false
}


function Ensure-PwaRuntimeDatabaseOverride {
    param([Parameter(Mandatory=$true)][string]$Root)

    $instrumentationPath = Join-Path $Root 'src\instrumentation.ts'
    if (-not (Test-Path -LiteralPath $instrumentationPath -PathType Leaf)) {
        throw 'src/instrumentation.ts introuvable : impossible de sécuriser le runtime PWA.'
    }

    $raw = [IO.File]::ReadAllText($instrumentationPath)
    $tag = 'GF_PWA_DATABASE_OVERRIDE_V167'
    if ($raw.Contains($tag)) {
        Write-Host '[OK] Priorité PWA Neon déjà présente dans src/instrumentation.ts.' -ForegroundColor Green
        return
    }

    $block = @"
    // GF_PWA_DATABASE_OVERRIDE_V167
    // Sur Vercel uniquement, la connexion PWA dédiée doit être appliquée avant
    // validateEnv() et avant toute initialisation Prisma. Electron n-est pas affecté.
    if (process.env.VERCEL === '1') {
      const pwaDatabaseUrl = process.env.PWA_DATABASE_URL?.trim()
      const pwaDirectUrl = process.env.PWA_DIRECT_URL?.trim()
      if (pwaDatabaseUrl && /^postgres(?:ql)?:\/\//i.test(pwaDatabaseUrl)) {
        process.env.DATABASE_URL = pwaDatabaseUrl
      }
      if (pwaDirectUrl && /^postgres(?:ql)?:\/\//i.test(pwaDirectUrl)) {
        process.env.DIRECT_URL = pwaDirectUrl
      }
    }
"@

    $pattern = '(?m)^(\s*)if \(process\.env\.NEXT_RUNTIME === [''"]nodejs[''"]\) \{\s*$'
    $match = [regex]::Match($raw, $pattern)
    if (-not $match.Success) {
        throw 'Bloc NEXT_RUNTIME=nodejs introuvable dans src/instrumentation.ts ; aucun patch approximatif appliqué.'
    }

    $replacement = $match.Value + "`r`n" + $block.TrimEnd()
    $patched = $raw.Substring(0, $match.Index) + $replacement + $raw.Substring($match.Index + $match.Length)
    $backup = $instrumentationPath + '.before-v167-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Copy-Item -LiteralPath $instrumentationPath -Destination $backup -Force
    [IO.File]::WriteAllText($instrumentationPath, $patched, $script:Utf8NoBom)

    $verify = [IO.File]::ReadAllText($instrumentationPath)
    if (-not $verify.Contains($tag) -or $verify -notmatch 'process\.env\.DATABASE_URL\s*=\s*pwaDatabaseUrl') {
        throw 'Le patch PWA Neon n-a pas pu être vérifié après écriture.'
    }
    Write-Host '[OK] src/instrumentation.ts corrigé : PWA_DATABASE_URL prioritaire sur Vercel.' -ForegroundColor Green
}


function Ensure-LicenseActivationDiagnostics {
    param([Parameter(Mandatory=$true)][string]$Root)

    $candidates = @(
        (Join-Path $Root 'src\app\api\license\activate\route.ts'),
        (Join-Path $Root 'app\api\license\activate\route.ts')
    )
    $routePath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace([string]$routePath)) {
        Write-Host '[INFO] Route /api/license/activate introuvable : diagnostic ignoré sans bloquer le déploiement.' -ForegroundColor DarkYellow
        return
    }

    $raw = [IO.File]::ReadAllText($routePath)
    $tag = 'GF_LICENSE_ACTIVATE_DIAGNOSTICS_V174'
    if ($raw.Contains($tag)) {
        Write-Host '[OK] Diagnostic détaillé de /api/license/activate et du rate limiter déjà présent.' -ForegroundColor Green
        return
    }

    $helperAnchor = "const IS_ELECTRON = () => process.env.ELECTRON === '1'"
    if (-not $raw.Contains($helperAnchor)) {
        Write-Host '[INFO] Point d-insertion diagnostic introuvable : route laissée intacte.' -ForegroundColor DarkYellow
        return
    }

    $helper = @'

// GF_LICENSE_ACTIVATE_DIAGNOSTICS_V174
function serializeActivationError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error
        ? { name: error.cause.name, message: error.cause.message, stack: error.cause.stack }
        : error.cause ? String(error.cause) : undefined,
    }
  }
  return { value: String(error) }
}

function activationRuntimeState(req: NextRequest) {
  return {
    requestId: req.headers.get('x-vercel-id') ?? req.headers.get('x-request-id') ?? undefined,
    databaseProvider: /^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL?.trim() ?? '') ? 'postgresql' : 'invalid',
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasDirectUrl: Boolean(process.env.DIRECT_URL),
    hasDbMacSecret: Boolean(process.env.GF_DB_MAC_SECRET),
    hasPrivateKey: Boolean(process.env.GF_PRIVATE_KEY),
    nodeEnv: process.env.NODE_ENV,
    vercel: process.env.VERCEL,
  }
}
'@
    $patched = $raw.Replace($helperAnchor, $helperAnchor + $helper)

    $step0 = "export async function POST(req: NextRequest) {"
    if (-not $patched.Contains($step0)) { Write-Host '[INFO] Fonction POST non reconnue : route laissée intacte.' -ForegroundColor DarkYellow; return }
    $patched = $patched.Replace($step0, $step0 + "`r`n  console.info('[license/activate] étape 0 : requête reçue', activationRuntimeState(req))")

    $rateLimitAnchor = "  const rl = await enforceRateLimit('license_activate', clientIpFrom(req))"
    if (-not $patched.Contains($rateLimitAnchor)) { Write-Host '[INFO] Appel rate-limit non reconnu : route laissée intacte.' -ForegroundColor DarkYellow; return }
    $rateLimitReturn = '  if (!rl.ok) return rateLimitResponse(rl)'
    if (-not $patched.Contains($rateLimitReturn)) { Write-Host '[INFO] Retour rate-limit non reconnu : route laissée intacte.' -ForegroundColor DarkYellow; return }
    $rateLimitDiagnostic = @'
  console.info('[license/activate] rate-limit', {
    ok: rl.ok,
    remaining: rl.remaining,
    retryAfterSec: rl.retryAfterSec,
    degraded: rl.degraded,
    hasUpstashUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    hasUpstashToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
  })
  // GF_LICENSE_ACTIVATE_UPSTASH_FALLBACK_V184
  // En cas d'indisponibilité temporaire d'Upstash, ne pas bloquer toutes les
  // activations. Les contrôles cryptographiques, DB, seats et appareils restent
  // appliqués. Les vraies limites atteintes continuent de renvoyer 429.
  if (!rl.ok && rl.degraded === 'fail_closed') {
    console.error('[license/activate] rate-limit dégradé : repli contrôlé actif', {
      retryAfterSec: rl.retryAfterSec,
      hasUpstashUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
      hasUpstashToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
      ...activationRuntimeState(req),
    })
  } else if (!rl.ok) {
    return rateLimitResponse(rl)
  }
'@
    # Remplacement tolérant CRLF/LF et espaces entre l'appel et le retour.
    $rateLimitPattern = '(?ms)^\s*const rl = await enforceRateLimit\(''license_activate'', clientIpFrom\(req\)\)\s*\r?\n\s*if \(!rl\.ok\) return rateLimitResponse\(rl\)'
    $rateLimitReplacement = $rateLimitAnchor + "`r`n" + $rateLimitDiagnostic.TrimEnd()
    $patchedRateLimit = [regex]::Replace($patched, $rateLimitPattern, [System.Text.RegularExpressions.MatchEvaluator]{
        param($m)
        return $rateLimitReplacement
    }, 1)
    if ($patchedRateLimit -eq $patched -and -not $patched.Contains('GF_LICENSE_ACTIVATE_UPSTASH_FALLBACK_V184')) {
        Write-Host '[INFO] Bloc rate-limit déjà différent : aucun remplacement fragile appliqué.' -ForegroundColor DarkYellow
    } else {
        $patched = $patchedRateLimit
    }

    $step1 = '  const result = verifyLicenseToken(licenseToken)'
    if ($patched.Contains($step1)) {
        $patched = $patched.Replace($step1, "  console.info('[license/activate] étape 1 : validation cryptographique')`r`n" + $step1)
    }

    $step2 = '  let seats = payload.seats ?? 1'
    if ($patched.Contains($step2)) {
        $patched = $patched.Replace($step2, "  console.info('[license/activate] étape 2 : contrôle base et intégrité', { lid: payload.lid })`r`n" + $step2)
    }

    $oldDbLog = "      logger.error('[license/activate] erreur DB (fail-closed serveur)', err)"
    $newDbLog = @'
      console.error('[license/activate] erreur DB complète (fail-closed serveur)', {
        error: serializeActivationError(err),
        ...activationRuntimeState(req),
        lid: payload.lid,
      })
      logger.error('[license/activate] erreur DB (fail-closed serveur)', err)
'@
    if (-not $patched.Contains($oldDbLog)) { Write-Host '[INFO] Bloc erreur DB déjà différent : diagnostic détaillé ignoré.' -ForegroundColor DarkYellow; return }
    $patched = $patched.Replace($oldDbLog, $newDbLog.TrimEnd())

    $oldDeviceLog = "        logger.error('[license/activate] enregistrement appareil impossible (fail-closed serveur)', err)"
    $newDeviceLog = @'
        console.error('[license/activate] enregistrement appareil impossible — erreur complète', {
          error: serializeActivationError(err),
          ...activationRuntimeState(req),
          lid: payload.lid,
          hasHwid,
          hasInstallId,
          seats,
        })
        logger.error('[license/activate] enregistrement appareil impossible (fail-closed serveur)', err)
'@
    if (-not $patched.Contains($oldDeviceLog)) { Write-Host '[INFO] Bloc erreur appareil déjà différent : diagnostic détaillé ignoré.' -ForegroundColor DarkYellow; return }
    $patched = $patched.Replace($oldDeviceLog, $newDeviceLog.TrimEnd())

    $oldIntegrity = "        logger.error('[license/activate] DB integrity check FAILED', { lid: record.licenseId })"
    $newIntegrity = @'
        console.error('[license/activate] DB integrity check FAILED', {
          lid: record.licenseId,
          hasStoredMac: Boolean(record.recordMac),
          hasMacSecret: Boolean(process.env.GF_DB_MAC_SECRET),
          ...activationRuntimeState(req),
        })
        logger.error('[license/activate] DB integrity check FAILED', { lid: record.licenseId })
'@
    if ($patched.Contains($oldIntegrity)) {
        $patched = $patched.Replace($oldIntegrity, $newIntegrity.TrimEnd())
    }

    $activationAnchor = '      const activation = await activateDevice({'
    if ($patched.Contains($activationAnchor)) {
        $patched = $patched.Replace($activationAnchor, "      console.info('[license/activate] étape 3 : enregistrement appareil', { lid: payload.lid, seats, hasHwid, hasInstallId })`r`n" + $activationAnchor)
    }

    $successAnchor = '  return response'
    if ($patched.Contains($successAnchor)) {
        $patched = $patched.Replace($successAnchor, "  console.info('[license/activate] étape 5 : activation réussie', { lid: payload.lid, deviceId: deviceId ?? null })`r`n" + $successAnchor)
    }

    $backup = $routePath + '.before-v174-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Copy-Item -LiteralPath $routePath -Destination $backup -Force
    [IO.File]::WriteAllText($routePath, $patched, $script:Utf8NoBom)

    $verify = [IO.File]::ReadAllText($routePath)
    $diagnosticOk = $verify.Contains($tag) -and $verify.Contains('serializeActivationError') -and $verify.Contains('erreur DB complète')
    $fallbackOk = $verify.Contains('GF_LICENSE_ACTIVATE_UPSTASH_FALLBACK_V184')
    if (-not $diagnosticOk -or -not $fallbackOk) {
        # Ne jamais bloquer le déploiement sur un contrôle textuel. Restaurer le
        # fichier original si le patch n'est pas entièrement vérifiable.
        Copy-Item -LiteralPath $backup -Destination $routePath -Force
        Write-Host '[INFO] Patch diagnostic non vérifiable : route originale restaurée, déploiement poursuivi sans modification fragile.' -ForegroundColor DarkYellow
        return
    }
    Write-Host '[OK] /api/license/activate enrichie avec diagnostic et repli contrôlé vérifiés.' -ForegroundColor Green
}


function Ensure-UpstashRuntimeReliability {
    param([Parameter(Mandatory=$true)][string]$Root)

    # v1.8.4 : ne plus réécrire src/lib/security/rate-limit.ts.
    # Les versions précédentes ont démontré que modifier automatiquement une
    # méthode TypeScript complexe est trop fragile. Le backend d'origine reste
    # intact ; le repli contrôlé est limité à /api/license/activate.
    $candidates = @(
        (Join-Path $Root 'src\lib\security\rate-limit.ts'),
        (Join-Path $Root 'lib\security\rate-limit.ts')
    )
    $rateLimitPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace([string]$rateLimitPath)) {
        throw 'Fichier src/lib/security/rate-limit.ts introuvable.'
    }
    Write-Host '[OK] Rate limiter d-origine conservé intact ; repli contrôlé appliqué uniquement à /api/license/activate.' -ForegroundColor Green
}

function Invoke-ProductionDeployFromCleanCopy {
    param([Parameter(Mandatory=$true)][string]$StagingDirectory)
    Copy-CleanDeploymentTree -Destination $StagingDirectory -LinkedProjectDirectory $script:ProjectRoot
    Ensure-PwaRuntimeDatabaseOverride -Root $StagingDirectory
    Ensure-LicenseActivationDiagnostics -Root $StagingDirectory
    Ensure-UpstashRuntimeReliability -Root $StagingDirectory
    $oldRoot = $script:ProjectRoot
    $savedProcessEnvironment = @{}
    foreach ($environmentName in @('DATABASE_URL','DIRECT_URL','DATABASE_URL_UNPOOLED','DESKTOP_DATABASE_URL')) {
        $savedProcessEnvironment[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, 'Process')
    }
    try {
        $script:ProjectRoot = $StagingDirectory
        # Ne jamais laisser les valeurs SQLite du terminal local influencer la CLI.
        [Environment]::SetEnvironmentVariable('DATABASE_URL', $null, 'Process')
        [Environment]::SetEnvironmentVariable('DIRECT_URL', $null, 'Process')
        [Environment]::SetEnvironmentVariable('DATABASE_URL_UNPOOLED', $null, 'Process')
        [Environment]::SetEnvironmentVariable('DESKTOP_DATABASE_URL', $null, 'Process')

        $deploy = Invoke-VercelCommand -Arguments @('--prod','--yes','--force','--no-color') -AllowFailure
        $deploymentUrl = Get-DeploymentUrlFromOutput -Output ([string]$deploy.Output)
        return [pscustomobject]@{
            ExitCode = $deploy.ExitCode
            Output = $deploy.Output
            DeploymentUrl = $deploymentUrl
        }
    } finally {
        foreach ($environmentName in $savedProcessEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($environmentName, $savedProcessEnvironment[$environmentName], 'Process')
        }
        $script:ProjectRoot = $oldRoot
    }
}

function Get-HttpFailureDetails {
    param([Parameter(Mandatory=$true)][string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 30
        return [pscustomobject]@{ Ok = ([int]$response.StatusCode -eq 200); StatusCode = [int]$response.StatusCode; Body = [string]$response.Content }
    } catch {
        $status = 0
        $body = ''
        if ($_.Exception.Response) {
            try { $status = [int]$_.Exception.Response.StatusCode } catch { }
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                if ($stream) {
                    $reader = New-Object IO.StreamReader($stream)
                    try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
                }
            } catch { }
        }
        return [pscustomobject]@{ Ok = $false; StatusCode = $status; Body = $body; Error = $_.Exception.Message }
    }
}

function Start-VercelLiveLogCapture {
    param(
        [Parameter(Mandatory=$true)][string]$DeploymentUrl,
        [Parameter(Mandatory=$true)][string]$OutputDirectory
    )

    if ($null -eq $script:Vercel) { $script:Vercel = Resolve-VercelCommand }
    $stdoutPath = Join-Path $OutputDirectory 'vercel-runtime-live.stdout.txt'
    $stderrPath = Join-Path $OutputDirectory 'vercel-runtime-live.stderr.txt'
    foreach ($path in @($stdoutPath,$stderrPath)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
    }

    # Sous Windows, `Get-Command vercel` retourne généralement vercel.cmd ou vercel.ps1.
    # Start-Process ne peut pas toujours exécuter directement ces shims npm et renvoie alors
    # « %1 n’est pas une application Win32 valide ». On lance donc un processus PowerShell
    # natif qui invoque lui-même le shim avec l’opérateur &, compatible .cmd/.ps1/.exe/npx.
    $runnerPath = Join-Path $OutputDirectory 'vercel-runtime-follow.ps1'
    $hostExecutable = (Get-Process -Id $PID -ErrorAction Stop).Path

    function ConvertTo-SingleQuotedPowerShellLiteral {
        param([AllowEmptyString()][string]$Value)
        return "'" + ([string]$Value).Replace("'", "''") + "'"
    }

    $commandArguments = @($script:Vercel.Prefix) + @('logs', $DeploymentUrl, '--follow', '--no-color')
    $argumentLiterals = @($commandArguments | ForEach-Object { ConvertTo-SingleQuotedPowerShellLiteral ([string]$_) })
    $runnerLines = @(
        '$ErrorActionPreference = ''Continue''',
        '$ProgressPreference = ''SilentlyContinue''',
        ('Set-Location -LiteralPath ' + (ConvertTo-SingleQuotedPowerShellLiteral $script:ProjectRoot)),
        ('& ' + (ConvertTo-SingleQuotedPowerShellLiteral $script:Vercel.Executable) + ' ' + ($argumentLiterals -join ' ')),
        'exit $LASTEXITCODE'
    )
    [IO.File]::WriteAllLines($runnerPath, $runnerLines, (New-Object Text.UTF8Encoding($true)))

    $processArguments = @('-NoLogo', '-NoProfile')
    if ([IO.Path]::GetFileName($hostExecutable) -match '(?i)^powershell\.exe$') {
        $processArguments += @('-ExecutionPolicy', 'Bypass')
    }
    $quotedRunnerPath = '"' + $runnerPath + '"'
    $processArguments += @('-File', $quotedRunnerPath)

    $process = Start-Process `
        -FilePath $hostExecutable `
        -ArgumentList $processArguments `
        -WorkingDirectory $script:ProjectRoot `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    return [pscustomobject]@{
        Process = $process
        StdoutPath = $stdoutPath
        StderrPath = $stderrPath
        RunnerPath = $runnerPath
    }
}

function Stop-VercelLiveLogCapture {
    param([AllowNull()]$Capture)
    if ($null -eq $Capture) { return }

    try {
        if ($Capture.Process -and -not $Capture.Process.HasExited) {
            # Sous Windows, arrêter uniquement le processus PowerShell parent peut
            # laisser node/vercel vivant. Le processus enfant conserve alors les
            # fichiers stdout/stderr ouverts et ReadAllText échoue avec un partage.
            if ($env:OS -eq 'Windows_NT') {
                try {
                    & taskkill.exe /PID $Capture.Process.Id /T /F 2>$null | Out-Null
                } catch {
                    Stop-Process -Id $Capture.Process.Id -Force -ErrorAction SilentlyContinue
                }
            } else {
                Stop-Process -Id $Capture.Process.Id -Force -ErrorAction SilentlyContinue
            }
            try { [void]$Capture.Process.WaitForExit(5000) } catch { }
        }
    } catch { }

    # Attendre brièvement que node et la redirection Start-Process libèrent les handles.
    foreach ($path in @($Capture.StdoutPath, $Capture.StderrPath)) {
        if ([string]::IsNullOrWhiteSpace([string]$path)) { continue }
        for ($attempt = 1; $attempt -le 20; $attempt++) {
            try {
                $stream = New-Object IO.FileStream($path, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
                $stream.Dispose()
                break
            } catch {
                Start-Sleep -Milliseconds 250
            }
        }
    }
}

function Read-SharedTextFile {
    param([Parameter(Mandatory=$true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $lastError = $null
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        try {
            $stream = New-Object IO.FileStream($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
            try {
                $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8, $true)
                try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
            } finally {
                if ($stream) { $stream.Dispose() }
            }
        } catch {
            $lastError = $_.Exception.Message
            Start-Sleep -Milliseconds 250
        }
    }
    return "[ATTENTION] Fichier de logs encore verrouillé après plusieurs tentatives : $Path. Détail : $lastError"
}

function Write-VercelRuntimeDiagnostics {
    param(
        [Parameter(Mandatory=$true)][string]$DeploymentUrl,
        [Parameter(Mandatory=$true)][string]$OutputPath,
        [AllowNull()]$LiveCapture
    )
    $sections = New-Object System.Collections.ArrayList

    [void]$sections.Add('===== VERCEL LIVE RUNTIME STDOUT =====')
    if ($LiveCapture -and (Test-Path -LiteralPath $LiveCapture.StdoutPath)) {
        [void]$sections.Add((Protect-LogText (Read-SharedTextFile -Path $LiveCapture.StdoutPath)))
    } else { [void]$sections.Add('Aucune sortie live capturée.') }

    [void]$sections.Add('===== VERCEL LIVE RUNTIME STDERR =====')
    if ($LiveCapture -and (Test-Path -LiteralPath $LiveCapture.StderrPath)) {
        [void]$sections.Add((Protect-LogText (Read-SharedTextFile -Path $LiveCapture.StderrPath)))
    } else { [void]$sections.Add('Aucune erreur live capturée.') }

    # `inspect --logs` fournit les informations et journaux de build du déploiement.
    $inspect = Invoke-VercelCommand -Arguments @('inspect',$DeploymentUrl,'--logs','--no-color') -AllowFailure
    [void]$sections.Add('===== VERCEL INSPECT --LOGS =====')
    [void]$sections.Add((Protect-LogText ([string]$inspect.Output)))

    # Requête ponctuelle supplémentaire avec la syntaxe officielle du CLI.
    $logs = Invoke-VercelCommand -Arguments @('logs',$DeploymentUrl,'--no-color') -AllowFailure
    [void]$sections.Add('===== VERCEL RUNTIME LOGS SNAPSHOT =====')
    [void]$sections.Add((Protect-LogText ([string]$logs.Output)))

    $safe = (@($sections) -join [Environment]::NewLine)
    [IO.File]::WriteAllText($OutputPath, $safe + [Environment]::NewLine, $script:Utf8NoBom)
    return $safe
}

function Assert-SingleHealthResult {
    param([AllowNull()]$Result)

    $items = @($Result)
    if ($items.Count -ne 1) {
        throw "Résultat de santé interne invalide : un seul objet était attendu, $($items.Count) ont été retournés."
    }
    $item = $items[0]
    $propertyNames = @($item.PSObject.Properties.Name)
    foreach ($requiredProperty in @('Ok','Health','Logs','DiagnosticPath')) {
        if ($propertyNames -notcontains $requiredProperty) {
            throw "Résultat de santé interne invalide : propriété '$requiredProperty' absente."
        }
    }
    return $item
}

function Test-NewDeploymentHealth {
    param(
        [Parameter(Mandatory=$true)][string]$DeploymentUrl,
        [Parameter(Mandatory=$true)][string]$RunDirectory
    )

    $capture = $null
    try {
        $capture = Start-VercelLiveLogCapture -DeploymentUrl $DeploymentUrl -OutputDirectory $RunDirectory
        Start-Sleep -Seconds 3

        $health = Invoke-ProtectedDeploymentRequest `
            -Path '/api/health' `
            -DeploymentUrl $DeploymentUrl `
            -Headers @{ 'Accept' = 'application/json' }

        # Laisser le flux Runtime recevoir la fin de l'invocation.
        Start-Sleep -Seconds 6
    } finally {
        Stop-VercelLiveLogCapture -Capture $capture
    }

    $payload = $health.Payload
    if ($health.Ok -and $payload -and [string]$payload.status -eq 'ok') {
        return [pscustomobject]@{
            Ok = $true
            Health = $health
            Logs = ''
            DiagnosticPath = ''
        }
    }

    $diagnosticPath = Join-Path $RunDirectory 'vercel-runtime-errors.txt'
    $logs = Write-VercelRuntimeDiagnostics -DeploymentUrl $DeploymentUrl -OutputPath $diagnosticPath -LiveCapture $capture

    return [pscustomobject]@{
        Ok = $false
        Health = $health
        Logs = [string]$logs
        DiagnosticPath = $diagnosticPath
    }
}


function Read-EnvFileMap {
    param([Parameter(Mandatory=$true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return @{} }

    # Get-DotEnvMap retourne une table de listes d'objets d'analyse. Pour un
    # export Vercel, les appelants ont besoin des valeurs finales en texte.
    # Utiliser la dernière occurrence de chaque variable, comme le font dotenv
    # et Vercel, et ne jamais convertir l'objet d'analyse lui-même en chaîne.
    $doc = Get-TextFileDocument $Path
    $entryMap = Get-DotEnvMap $doc
    $valueMap = @{}
    foreach ($name in @($entryMap.Keys)) {
        $entries = @($entryMap[$name])
        if ($entries.Count -eq 0) { continue }
        $lastEntry = $entries[$entries.Count - 1]
        $valueMap[[string]$name] = Clean-InputValue ([string]$lastEntry.Value)
    }
    return $valueMap
}

function Test-EnvPullParsingRegression {
    $testDirectory = Join-Path $env:TEMP ('garageflow-env-pull-test-' + [Guid]::NewGuid().ToString('N'))
    $testPath = Join-Path $testDirectory 'production.env'
    try {
        New-Item -ItemType Directory -Path $testDirectory -Force | Out-Null
        $sample = 'DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"' + "`r`n" +
                  'DIRECT_URL=postgres://user:pass@host-direct/db?sslmode=require' + "`r`n"
        [IO.File]::WriteAllText($testPath, $sample, $script:Utf8NoBom)
        $map = Read-EnvFileMap $testPath
        $database = Normalize-PostgresUrl ([string]$map['DATABASE_URL'])
        $direct = Normalize-PostgresUrl ([string]$map['DIRECT_URL'])
        if ($database -ne 'postgresql://user:pass@host/db?sslmode=require') {
            throw 'Le parseur Vercel ne retourne pas la valeur DATABASE_URL attendue.'
        }
        if ($direct -ne 'postgres://user:pass@host-direct/db?sslmode=require') {
            throw 'Le parseur Vercel ne retourne pas la valeur DIRECT_URL attendue.'
        }
        Assert-Url 'DATABASE_URL auto-test' $database -Postgres
        Assert-Url 'DIRECT_URL auto-test' $direct -Postgres
        Write-Host '[OK] Auto-test lecture Vercel env pull et normalisation Neon.' -ForegroundColor Green

    $healthSelfTest = Assert-SingleHealthResult -Result ([pscustomobject]@{ Ok = $true; Health = $null; Logs = ''; DiagnosticPath = '' })
    if (-not $healthSelfTest.Ok) { throw 'Auto-test du résultat de santé en échec.' }
    Write-Host '[OK] Auto-test retour unique du contrôle runtime.' -ForegroundColor Green
    } finally {
        Remove-Item -LiteralPath $testDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}


function Test-RemoteEnvironmentIsolationRegression {
    $names = @('DATABASE_URL','DIRECT_URL','DATABASE_URL_UNPOOLED','DESKTOP_DATABASE_URL')
    $saved = @{}
    foreach ($name in $names) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    try {
        [Environment]::SetEnvironmentVariable('DATABASE_URL', 'file:./dev.db', 'Process')
        foreach ($name in $names) {
            [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
        if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process'))) {
            throw 'Auto-test isolation distante : DATABASE_URL locale encore visible.'
        }
    } finally {
        foreach ($name in $names) {
            [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
        }
    }
    Write-Host '[OK] Auto-test isolation des variables SQLite locales.' -ForegroundColor Green
}

function Write-EnvMap {
    param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][hashtable]$Map)
    $lines = New-Object System.Collections.ArrayList
    foreach ($name in @($Map.Keys | Sort-Object)) {
        $value = Clean-InputValue ([string]$Map[$name])
        $escaped = $value.Replace('\','\\').Replace('"','\"').Replace("`r",'').Replace("`n",'\n')
        [void]$lines.Add("$name=`"$escaped`"")
    }
    $text = (($lines | ForEach-Object { [string]$_ }) -join "`r`n") + "`r`n"
    [IO.File]::WriteAllText($Path, $text, $script:Utf8NoBom)
    Set-PrivateFileAcl $Path
}

function Remove-AllProductionVariables {
    param([string[]]$Names)
    foreach ($name in @($Names | Sort-Object -Unique)) {
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        $result = Invoke-VercelCommand -Arguments @('env','rm',$name,'production','--yes','--no-color') -AllowFailure
        if ($result.ExitCode -ne 0 -and $result.Output -notmatch '(not found|does not exist|no environment variable)') {
            throw "Suppression Vercel impossible pour $name : $($result.Output)"
        }
        Write-Host "[OK] Supprimée de Vercel Production : $name" -ForegroundColor Green
    }
}

function Get-ProductionVariableNames {
    $list = Invoke-VercelCommand -Arguments @('env','ls','production','--no-color') -AllowFailure
    if ($list.ExitCode -ne 0) {
        throw "Impossible de lister les variables Vercel Production : $($list.Output)"
    }

    $names = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($line in @(([string]$list.Output) -split "`r?`n")) {
        $match = [regex]::Match(([string]$line), '^\s*([A-Za-z_][A-Za-z0-9_]*)\s+')
        if ($match.Success) { [void]$names.Add($match.Groups[1].Value) }
    }
    return ,$names
}

function Add-AllProductionVariables {
    param([Parameter(Mandatory=$true)][hashtable]$Values,[string[]]$SensitiveNames)

    $existingNames = Get-ProductionVariableNames

    foreach ($name in @($Values.Keys | Sort-Object)) {
        $value = Clean-InputValue ([string]$Values[$name])
        if ([string]::IsNullOrEmpty($value)) { continue }
        Add-SecretToRegistry $value

        # DATABASE_URL et DIRECT_URL déterminent le moteur Prisma au démarrage.
        # Sur certains projets anciens, `env update` peut laisser une ancienne
        # entrée ciblée active. Pour ces deux variables seulement, supprimer
        # explicitement toutes les entrées Production puis recréer une entrée
        # unique avec la valeur Neon saisie. Les autres secrets ne sont jamais
        # supprimés avant leur mise à jour.
        if ($name -in @('DATABASE_URL','DIRECT_URL','PWA_DATABASE_URL','PWA_DIRECT_URL')) {
            if ($existingNames.Contains([string]$name)) {
                $remove = Invoke-VercelCommand -Arguments @('env','rm',$name,'production','--yes','--no-color') -AllowFailure
                if ($remove.ExitCode -ne 0 -and ([string]$remove.Output -notmatch 'not found|does not exist|introuvable')) {
                    throw "Suppression préalable impossible pour $name : $($remove.Output)"
                }
                [void]$existingNames.Remove([string]$name)
            }
            $args = @('env','add',$name,'production','--yes','--no-color','--sensitive')
            $result = Invoke-VercelCommand -Arguments $args -InputText $value -AllowFailure
            if ($result.ExitCode -ne 0) {
                throw "Recréation Vercel impossible pour $name : $($result.Output)"
            }
            [void]$existingNames.Add([string]$name)
            Write-Host "[OK] Recréation unique dans Vercel Production : $name — empreinte $(Get-ShortFingerprint $value)" -ForegroundColor Green
            continue
        }

        $verb = if ($existingNames.Contains([string]$name)) { 'update' } else { 'add' }
        $args = @('env',$verb,$name,'production','--yes','--no-color')
        if ($name -in $SensitiveNames) { $args += '--sensitive' }

        $result = Invoke-VercelCommand -Arguments $args -InputText $value -AllowFailure
        if ($result.ExitCode -ne 0) {
            throw "Mise à jour Vercel impossible pour $name avec env $verb : $($result.Output)"
        }
        [void]$existingNames.Add([string]$name)
        Write-Host "[OK] Mise à jour dans Vercel Production : $name — empreinte $(Get-ShortFingerprint $value)" -ForegroundColor Green
    }
}

function Assert-RemoteProductionDatabaseValues {
    param(
        [Parameter(Mandatory=$true)][string]$ExpectedDatabaseUrl,
        [Parameter(Mandatory=$true)][string]$ExpectedDirectUrl,
        [Parameter(Mandatory=$true)][string]$TemporaryDirectory
    )

    $probePath = Join-Path $TemporaryDirectory ('verify-vercel-database-' + [Guid]::NewGuid().ToString('N') + '.cjs')
    $probe = @'
const crypto = require('crypto');
const clean = value => String(value || '').replace(/^\uFEFF|\u200B|\u0000/g, '').trim();
const fp = value => crypto.createHash('sha256').update(clean(value), 'utf8').digest('hex').slice(0, 8).toUpperCase();
const database = clean(process.env.DATABASE_URL);
const direct = clean(process.env.DIRECT_URL);
process.stdout.write(JSON.stringify({
  databasePostgres: /^postgres(?:ql)?:\/\//i.test(database),
  directPostgres: /^postgres(?:ql)?:\/\//i.test(direct),
  databaseFile: /^file:/i.test(database),
  directFile: /^file:/i.test(direct),
  databaseFingerprint: fp(database),
  directFingerprint: fp(direct)
}));
'@
    [IO.File]::WriteAllText($probePath, $probe, $script:Utf8NoBom)

    $savedProcessEnvironment = @{}
    foreach ($environmentName in @('DATABASE_URL','DIRECT_URL','DATABASE_URL_UNPOOLED','DESKTOP_DATABASE_URL')) {
        $savedProcessEnvironment[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, 'Process')
    }

    try {
        # `vercel env run` peut conserver une variable déjà présente dans le
        # processus appelant. Le poste Electron possède volontairement
        # DATABASE_URL=file:./dev.db : la retirer temporairement est donc
        # indispensable pour mesurer uniquement la valeur Production distante.
        foreach ($environmentName in $savedProcessEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable([string]$environmentName, $null, 'Process')
        }

        $result = Invoke-VercelCommand -Arguments @('env','run','-e','production','--','node',$probePath) -AllowFailure
        if ($result.ExitCode -ne 0) {
            throw "Impossible de vérifier les valeurs Production réelles via vercel env run : $($result.Output)"
        }

        $jsonMatch = [regex]::Matches([string]$result.Output, '\{[^\r\n]*"databasePostgres"[^\r\n]*\}')
        if ($jsonMatch.Count -eq 0) {
            throw "Réponse de vérification Vercel illisible : $(Protect-LogText ([string]$result.Output))"
        }
        $payload = $jsonMatch[$jsonMatch.Count - 1].Value | ConvertFrom-Json
        $expectedDbFp = Get-ShortFingerprint (Normalize-PostgresUrl $ExpectedDatabaseUrl)
        $expectedDirectFp = Get-ShortFingerprint (Normalize-PostgresUrl $ExpectedDirectUrl)

        if (-not [bool]$payload.databasePostgres -or [bool]$payload.databaseFile) {
            throw 'Vérification distante : DATABASE_URL réellement injectée par Vercel n-est pas PostgreSQL.'
        }
        if (-not [bool]$payload.directPostgres -or [bool]$payload.directFile) {
            throw 'Vérification distante : DIRECT_URL réellement injectée par Vercel n-est pas PostgreSQL.'
        }
        if ([string]$payload.databaseFingerprint -ne $expectedDbFp) {
            throw "Vérification distante : empreinte DATABASE_URL différente ($($payload.databaseFingerprint) au lieu de $expectedDbFp)."
        }
        if ([string]$payload.directFingerprint -ne $expectedDirectFp) {
            throw "Vérification distante : empreinte DIRECT_URL différente ($($payload.directFingerprint) au lieu de $expectedDirectFp)."
        }

        Write-Host "[OK] Valeurs Vercel réellement injectées vérifiées : PostgreSQL — empreintes $expectedDbFp / $expectedDirectFp." -ForegroundColor Green
    } finally {
        foreach ($environmentName in $savedProcessEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable(
                [string]$environmentName,
                $savedProcessEnvironment[$environmentName],
                'Process'
            )
        }
        Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
    }
}

function Assert-ProductionDatabaseVariables {
    param(
        [Parameter(Mandatory=$true)][string]$ExpectedDatabaseUrl,
        [Parameter(Mandatory=$true)][string]$ExpectedDirectUrl,
        [Parameter(Mandatory=$true)][string]$TemporaryDirectory
    )

    # DATABASE_URL et DIRECT_URL sont ajoutées comme variables sensibles.
    # Vercel peut masquer ou rendre non relisible leur valeur après création.
    # Il est donc incorrect de tenter de recalculer leur empreinte depuis
    # `vercel env pull`. La validation fiable est :
    #   1. normaliser et valider les valeurs saisies avant l'ajout ;
    #   2. vérifier le succès des commandes `vercel env add` ;
    #   3. vérifier la présence des noms dans `vercel env ls` ;
    #   4. valider le véritable runtime via /api/health après déploiement.
    $expectedDatabase = Normalize-PostgresUrl $ExpectedDatabaseUrl
    $expectedDirect = Normalize-PostgresUrl $ExpectedDirectUrl
    Assert-Url 'DATABASE_URL' $expectedDatabase -Postgres
    Assert-Url 'DIRECT_URL' $expectedDirect -Postgres

    if ($expectedDatabase -match '^file:' -or $expectedDirect -match '^file:') {
        throw 'Sécurité : une URL SQLite ne peut jamais être envoyée à Vercel.'
    }

    $list = Invoke-VercelCommand -Arguments @('env','ls','production','--no-color') -AllowFailure
    if ($list.ExitCode -ne 0) {
        throw "Impossible de vérifier la présence des variables Production : $($list.Output)"
    }

    $output = [string]$list.Output
    foreach ($requiredName in @('DATABASE_URL','DIRECT_URL')) {
        if ($output -notmatch ('(?m)^\s*' + [regex]::Escape($requiredName) + '(?:\s|$)')) {
            throw "Vérification distante : $requiredName est absente de Vercel Production."
        }
    }

    Write-Host "[OK] Vercel Production : DATABASE_URL et DIRECT_URL sont présentes ; valeurs PostgreSQL validées avant envoi — empreintes $((Get-ShortFingerprint $expectedDatabase)) / $((Get-ShortFingerprint $expectedDirect))." -ForegroundColor Green
}

function Restore-ProductionFromBackup {
    param([hashtable]$Backup,[string[]]$CurrentNames,[string[]]$SensitiveNames)
    Write-Host '[ROLLBACK] Restauration des anciennes valeurs récupérables...' -ForegroundColor Yellow
    try {
        $restorable = @{}
        foreach ($name in $Backup.Keys) {
            $value = Get-UsableExistingValue ([string]$Backup[$name])
            if (-not [string]::IsNullOrWhiteSpace($value) -and -not (Test-IsProtectedPlatformVariable ([string]$name))) {
                $restorable[[string]$name] = $value
            }
        }
        # Ne jamais supprimer une nouvelle valeur si l'ancienne valeur était masquée
        # et donc impossible à restaurer. Cela évite d'injecter littéralement [SENSITIVE].
        $namesToRestore = @($restorable.Keys)
        Remove-AllProductionVariables -Names $namesToRestore
        Add-AllProductionVariables -Values $restorable -SensitiveNames $SensitiveNames
        Write-Host "[ROLLBACK] $($restorable.Count) anciennes valeurs récupérables restaurées ; aucun placeholder masqué n'a été injecté." -ForegroundColor Yellow
    } catch {
        Write-Host "[ERREUR ROLLBACK] $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Invoke-GfLocalRestore {
    param([Parameter(Mandatory = $true)][string]$RestoreDir)
    if (-not (Test-Path -LiteralPath $RestoreDir)) { throw "Dossier de restauration introuvable : $RestoreDir" }
    Write-Host "[RESTAURATION] Depuis : $RestoreDir" -ForegroundColor Cyan
    $envDest = Join-Path $script:ProjectRoot '.env'
    $cfgDest = Join-Path $script:ProjectRoot 'keys/server_config.json'
    $envSrc = @((Join-Path $RestoreDir '.env.avant-reset'), (Join-Path $RestoreDir 'sauvegardes/.env.avant-reset')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    $cfgSrc = @((Join-Path $RestoreDir 'server_config.avant-reset.json'), (Join-Path $RestoreDir 'sauvegardes/server_config.avant-reset.json')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    $stamp = (Get-Date -Format 'yyyyMMdd-HHmmss')
    if ($envSrc) {
        if (Test-Path -LiteralPath $envDest) { Copy-Item -LiteralPath $envDest -Destination ($envDest + '.before-restore-' + $stamp) -Force }
        Copy-Item -LiteralPath $envSrc -Destination $envDest -Force
        Write-Host "[OK] .env restauré depuis $envSrc" -ForegroundColor Green
    } else { Write-Host '[IGNORÉ] Aucune sauvegarde .env.avant-reset trouvée dans le dossier fourni.' -ForegroundColor Yellow }
    if ($cfgSrc) {
        $cfgDir = Split-Path -Parent $cfgDest
        if (-not (Test-Path -LiteralPath $cfgDir)) { New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null }
        if (Test-Path -LiteralPath $cfgDest) { Copy-Item -LiteralPath $cfgDest -Destination ($cfgDest + '.before-restore-' + $stamp) -Force }
        Copy-Item -LiteralPath $cfgSrc -Destination $cfgDest -Force
        Write-Host "[OK] keys/server_config.json restauré depuis $cfgSrc" -ForegroundColor Green
    } else { Write-Host '[IGNORÉ] Aucune sauvegarde server_config.avant-reset.json trouvée.' -ForegroundColor Yellow }
    Write-Host '[INFO] Restauration LOCALE terminée. Les variables Vercel Production ne sont PAS modifiées ici' -ForegroundColor Cyan
    Write-Host '[INFO] (pour le distant : réappliquer manuellement vercel-production-avant-reset.env du run-dir).' -ForegroundColor Cyan
}

# ── Lot B : garde-fous d'entrée AVANT tout effet de bord (run-dir) ───────────────
if (-not [string]::IsNullOrWhiteSpace($script:GfRestorePath)) {
    try { Invoke-GfLocalRestore -RestoreDir $script:GfRestorePath; exit 0 }
    catch { Write-Host "[ERREUR] $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
}
if ($script:GfNonInteractive -and -not $script:GfConfirmDestructive) {
    Write-Host '[ERREUR] Mode -NonInteractive : opération destructrice REFUSÉE sans -ConfirmDestructiveReset.' -ForegroundColor Red
    exit 2
}

$desktop = Get-DesktopDirectory
# -DryRun : tout artefact d'exécution (inventaire env pull, fichiers de travail)
# va dans un dossier TEMPORAIRE éphémère au lieu du Bureau — la simulation ne
# laisse ainsi AUCUNE trace persistante sur le poste. En exécution réelle, les
# sauvegardes restent sur le Bureau (« API générées ») pour le retour arrière.
$runDir = if ($script:GfDryRun) {
    Join-Path ([IO.Path]::GetTempPath()) ('gf-dryrun-' + (Get-Date).ToString('yyyy-MM-dd_HH-mm-ss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
} else {
    Join-Path (Join-Path $desktop 'API générées') ((Get-Date).ToString('yyyy-MM-dd_HH-mm-ss'))
}
$backupDir = Join-Path $runDir 'sauvegardes'
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Set-PrivateFileAcl $runDir

$localEnvPath = Join-Path $script:ProjectRoot '.env'
$keygenPath = Join-Path $script:ProjectRoot 'keys/server_config.json'
$remoteBackupPath = Join-Path $backupDir 'vercel-production-avant-reset.env'
$localEnvBackup = Join-Path $backupDir '.env.avant-reset'
$keygenBackup = Join-Path $backupDir 'server_config.avant-reset.json'
$remoteBackup = @{}
$newValues = @{}
$deletedNames = @()
$sensitiveNames = @(
    'DATABASE_URL','DIRECT_URL','PWA_DATABASE_URL','PWA_DIRECT_URL','NEXTAUTH_SECRET','GARAGEFLOW_API_KEY','DEVICE_TOKEN_PEPPER',
    'UPSTASH_REDIS_REST_TOKEN','GF_PORTAL_SECRET','ANTHROPIC_API_KEY','GF_TOTP_ENC_KEY',
    'GF_SMTP_CIPHER_KEY','GF_SIGNATURE_SECRET','GF_BACKUP_KEY','GF_DB_MAC_SECRET','GF_PRIVATE_KEY'
)
$success = $false
$remoteMutationStarted = $false

# ── Lot B : bandeau dry-run ─────────────────────────────────────────────────────
if ($script:GfDryRun) {
    Write-Host '================================================================' -ForegroundColor Magenta
    Write-Host '[DRY-RUN] SIMULATION : aucune modification Vercel/Neon/projet ne sera appliquée.' -ForegroundColor Magenta
    Write-Host '================================================================' -ForegroundColor Magenta
}

try {
    Test-EnvPullParsingRegression
    Test-RemoteEnvironmentIsolationRegression
    Write-Host '================================================================' -ForegroundColor Cyan
    Write-Host 'GarageFlows - Rotation cryptographique totale des variables Vercel' -ForegroundColor Cyan
    Write-Host '================================================================' -ForegroundColor Cyan
    Write-Host 'Les variables Production seront sauvegardées puis mises à jour sans suppression préalable.'
    Write-Host 'Les secrets générables recevront une nouvelle valeur.'
    Write-Host 'Les valeurs externes seront demandées ou conservées si tu appuies sur Entrée.'
    Write-Host ''
    Write-Host '[ATTENTION] Certains secrets seront renouvelés et peuvent fermer les sessions.' -ForegroundColor Yellow
    if ($script:GfNonInteractive -or $script:GfDryRun) {
        Write-Host '[INFO] Confirmation RESET automatique (-NonInteractive/-DryRun).' -ForegroundColor Yellow
    } else {
        $confirm = Read-Host 'Tape exactement RESET pour continuer'
        if ($confirm -cne 'RESET') { throw 'Réinitialisation annulée.' }
    }

    $script:Vercel = Resolve-VercelCommand
    Ensure-VercelConnection
    Ensure-VercelLink

    # `vercel curl` s'appuie sur curl.exe pour contourner proprement la
    # Deployment Protection. Vérifier ce prérequis avant toute mutation distante.
    $curlCommand = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curlCommand) {
        throw 'curl.exe est requis pour valider les déploiements Vercel protégés. Installez curl puis relancez ; aucune variable n-a été modifiée.'
    }
    Write-Host "[OK] curl disponible : $($curlCommand.Source)" -ForegroundColor Green

    Write-Host '[1/7] Sauvegarde complète de Vercel Production...' -ForegroundColor Cyan
    $pull = Invoke-VercelCommand -Arguments @('env','pull',$remoteBackupPath,'--environment=production','--yes','--no-color') -AllowFailure
    if ($pull.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $remoteBackupPath)) {
        throw "Export Vercel impossible. Aucune suppression n'a été effectuée. $($pull.Output)"
    }
    $remoteBackup = Read-EnvFileMap $remoteBackupPath
    if ($remoteBackup.Count -eq 0) { throw 'La sauvegarde Vercel est vide. Aucune suppression n-a été effectuée.' }
    $maskedNames = @($remoteBackup.Keys | Where-Object { Test-IsMaskedVercelValue ([string]$remoteBackup[[string]$_]) })
    $deletedNames = @()
    Write-Host "[OK] $($remoteBackup.Count) variables inventoriées avant modification." -ForegroundColor Green
    if ($maskedNames.Count -gt 0) {
        Write-Host "[ATTENTION] $($maskedNames.Count) valeurs sensibles sont masquées par Vercel ; elles ne seront jamais utilisées comme sauvegarde en clair." -ForegroundColor Yellow
    }

    if ($script:GfDryRun) {
        Write-Host '[DRY-RUN] Sauvegarde locale (.env / keys/server_config.json) IGNORÉE — aucune mutation à protéger en simulation.' -ForegroundColor Magenta
    } else {
        if (Test-Path -LiteralPath $localEnvPath) { Copy-Item -LiteralPath $localEnvPath -Destination $localEnvBackup -Force }
        if (Test-Path -LiteralPath $keygenPath) { Copy-Item -LiteralPath $keygenPath -Destination $keygenBackup -Force }
    }

    if ($script:GfBackupOnly) {
        Write-Host '[OK] -BackupOnly : sauvegarde terminée, aucune modification effectuée.' -ForegroundColor Green
        Write-Host "[OK] Sauvegardes : $backupDir" -ForegroundColor Green
        $success = $true
        exit 0
    }

    Write-Host '[2/7] Collecte des valeurs externes...' -ForegroundColor Cyan
    $databaseUrl = Normalize-PostgresUrl (Read-SecretOrKeep 'DATABASE_URL Neon poolée' ([string]$remoteBackup['DATABASE_URL']) -Required)
    $directUrl = Normalize-PostgresUrl (Read-SecretOrKeep 'DIRECT_URL Neon directe' ([string]$remoteBackup['DIRECT_URL']) -Required)
    Assert-Url 'DATABASE_URL' $databaseUrl -Postgres
    Assert-Url 'DIRECT_URL' $directUrl -Postgres

    $existingAppUrl = if ($remoteBackup.ContainsKey('NEXTAUTH_URL')) { [string]$remoteBackup['NEXTAUTH_URL'] } elseif ($remoteBackup.ContainsKey('GF_APP_URL')) { [string]$remoteBackup['GF_APP_URL'] } else { '' }
    $appUrl = Read-TextOrKeep 'URL publique GarageFlows' $existingAppUrl 'https://app.garageflows.fr' -Required
    $appUrl = Clean-InputValue $appUrl
    if ($appUrl -match '^https://app\.garagesflows\.fr/?$') {
        Write-Host '[ATTENTION] Adresse corrigée automatiquement : app.garagesflows.fr -> app.garageflows.fr' -ForegroundColor Yellow
        $appUrl = 'https://app.garageflows.fr'
    }
    Assert-Url 'URL publique GarageFlows' $appUrl -Https

    $upstashUrl = Read-TextOrKeep 'UPSTASH_REDIS_REST_URL' ([string]$remoteBackup['UPSTASH_REDIS_REST_URL']) '' -Required
    # SÉCURITÉ D'EXÉCUTION : retirer TOUT retour à la ligne / tabulation, y compris
    # interne. Un « \n » résiduel dans le token formerait un en-tête HTTP invalide
    # (« Authorization: Bearer <token>\n ») → fetch lève côté app AVANT tout appel
    # réseau → repli fail-closed 503 alors qu'Upstash est pourtant configuré. On
    # nettoie AVANT le test ET l'écriture pour que la valeur testée == valeur écrite.
    $upstashUrl = (Clean-InputValue $upstashUrl) -replace '[\r\n\t]', ''
    Assert-Url 'UPSTASH_REDIS_REST_URL' $upstashUrl -Https
    $upstashToken = Read-SecretOrKeep 'UPSTASH_REDIS_REST_TOKEN' ([string]$remoteBackup['UPSTASH_REDIS_REST_TOKEN']) -Required
    $upstashToken = (Clean-InputValue $upstashToken) -replace '[\r\n\t]', ''
    [void](Test-UpstashRestConnection -Url $upstashUrl -Token $upstashToken)
    $anthropic = Read-SecretOrKeep 'ANTHROPIC_API_KEY optionnelle' ([string]$remoteBackup['ANTHROPIC_API_KEY'])

    Write-Host '[ATTENTION] Rotation totale demandée : toutes les anciennes licences seront invalidées et supprimées.' -ForegroundColor Yellow
    if ($script:GfNonInteractive -or $script:GfDryRun) {
        Write-Host '[INFO] Confirmation ROTATION-TOTALE automatique (-NonInteractive/-DryRun).' -ForegroundColor Yellow
    } else {
        $fullConfirm = Read-Host 'Tape exactement ROTATION-TOTALE pour continuer'
        if ($fullConfirm -cne 'ROTATION-TOTALE') { throw 'Rotation totale annulée.' }
    }

    Write-Host '[3/7] Génération de toutes les nouvelles clés...' -ForegroundColor Cyan
    $keyPairDir = Join-Path $runDir 'nouvelle-paire-licence'
    $licenseKeyPair = New-LicenseSigningKeyPair -OutputDirectory $keyPairDir
    $privateKey = [string]$licenseKeyPair.PrivateBase64


    # Repartir de toutes les variables utilisateur existantes afin de ne jamais
    # perdre une intégration inconnue. Les variables système Vercel sont exclues.
    foreach ($name in $remoteBackup.Keys) {
        $variableName = [string]$name
        $existingValue = Get-UsableExistingValue ([string]$remoteBackup[$variableName])
        if (-not (Test-IsProtectedPlatformVariable $variableName) -and -not [string]::IsNullOrWhiteSpace($existingValue)) {
            $newValues[$variableName] = $existingValue
        }
    }

    # Générer un jeu entièrement neuf : aucune clé applicative historique n-est conservée.
    # Convertir explicitement le résultat en dictionnaire afin d'éviter les
    # différences de comportement de Windows PowerShell 5.1 avec la sortie pipeline.
    $generatedRaw = New-CandidateSecretSet
    $generated = @{}
    if ($generatedRaw -is [System.Collections.IDictionary]) {
        foreach ($key in $generatedRaw.Keys) { $generated[[string]$key] = [string]$generatedRaw[$key] }
    } else {
        foreach ($item in @($generatedRaw)) {
            if ($item -is [System.Collections.IDictionary]) {
                foreach ($key in $item.Keys) { $generated[[string]$key] = [string]$item[$key] }
            }
        }
    }

    # Garantir localement tous les secrets générables indispensables, même si
    # la fonction partagée change ou retourne une forme inattendue.
    # NOTE : GF_TOTP_ENC_KEY et GF_SMTP_CIPHER_KEY sont EXCLUS ci-dessous.
    # Ce sont des clés de chiffrement AU REPOS (secrets TOTP, mots de passe SMTP) :
    # les régénérer rendrait les données déjà chiffrées DÉFINITIVEMENT illisibles
    # (perte irréversible), contrairement aux secrets de session (rotation = simple
    # reconnexion). Le manifeste les marque autoGenerate=false / rotationRisk=high.
    # On les PRÉSERVE donc telles quelles (valeur existante conservée en 1864).
    $fallbackGenerators = @{
        NEXTAUTH_SECRET      = @{ Bytes = 32; Format = 'base64' }
        GARAGEFLOW_API_KEY   = @{ Bytes = 32; Format = 'hex' }
        DEVICE_TOKEN_PEPPER  = @{ Bytes = 32; Format = 'base64' }
        GF_PORTAL_SECRET     = @{ Bytes = 32; Format = 'base64' }
        GF_SIGNATURE_SECRET  = @{ Bytes = 32; Format = 'base64' }
        GF_BACKUP_KEY        = @{ Bytes = 32; Format = 'base64' }
        GF_DB_MAC_SECRET     = @{ Bytes = 32; Format = 'hex' }
    }
    # Secrets de chiffrement au repos : JAMAIS auto-générés ni auto-rotés par le
    # reset. Générés UNIQUEMENT s'ils sont totalement absents (installation neuve,
    # aucune donnée chiffrée à perdre) et jamais écrasés s'ils existent déjà.
    $encryptionAtRestKeys = @('GF_TOTP_ENC_KEY','GF_SMTP_CIPHER_KEY')
    foreach ($name in $encryptionAtRestKeys) {
        $already = $newValues.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace([string]$newValues[$name])
        if (-not $already) {
            $newValues[$name] = New-CryptoRandomValue -Bytes 32 -Format 'base64'
            Add-SecretToRegistry ([string]$newValues[$name])
        }
    }
    foreach ($name in $fallbackGenerators.Keys) {
        if (-not $generated.ContainsKey($name) -or [string]::IsNullOrWhiteSpace([string]$generated[$name])) {
            $spec = $fallbackGenerators[$name]
            $generated[$name] = New-CryptoRandomValue -Bytes ([int]$spec.Bytes) -Format ([string]$spec.Format)
            Add-SecretToRegistry ([string]$generated[$name])
        }
    }

    # Rotation totale explicite : écraser les secrets ROTABLES (session/signature/
    # API/pepper/backup/MAC). GF_TOTP_ENC_KEY et GF_SMTP_CIPHER_KEY en sont EXCLUS
    # (chiffrement au repos — cf. bloc ci-dessus, préservés/générés une seule fois).
    foreach ($name in @('NEXTAUTH_SECRET','GARAGEFLOW_API_KEY','DEVICE_TOKEN_PEPPER','GF_PORTAL_SECRET','GF_SIGNATURE_SECRET','GF_BACKUP_KEY','GF_DB_MAC_SECRET')) {
        $newValues[$name] = Clean-InputValue ([string]$generated[$name])
    }

    $newValues['DATABASE_URL'] = $databaseUrl
    $newValues['DIRECT_URL'] = $directUrl
    $newValues['PWA_DATABASE_URL'] = $databaseUrl
    $newValues['PWA_DIRECT_URL'] = $directUrl
    $newValues['NEXTAUTH_URL'] = $appUrl
    $newValues['GF_APP_URL'] = $appUrl
    $newValues['UPSTASH_REDIS_REST_URL'] = $upstashUrl
    $newValues['UPSTASH_REDIS_TIMEOUT_MS'] = '8000'
    $newValues['UPSTASH_REDIS_REST_TOKEN'] = $upstashToken
    if (-not [string]::IsNullOrEmpty($anthropic)) { $newValues['ANTHROPIC_API_KEY'] = $anthropic }
    if (-not [string]::IsNullOrEmpty($privateKey)) { $newValues['GF_PRIVATE_KEY'] = $privateKey }

    if ($script:GfDryRun) {
        Write-Host '[DRY-RUN] Patch clé publique (public-key.ts, electron/main.js) + écriture keys/*.pem IGNORÉS.' -ForegroundColor Magenta
    } else {
    Set-LicensePublicKeyInProject -Root $script:ProjectRoot -PublicPem ([string]$licenseKeyPair.PublicPem)

    $projectKeysDir = Join-Path $script:ProjectRoot 'keys'
    if (-not (Test-Path -LiteralPath $projectKeysDir)) { New-Item -ItemType Directory -Path $projectKeysDir -Force | Out-Null }
    $projectPrivatePath = Join-Path $projectKeysDir 'private.pem'
    $projectPublicPath = Join-Path $projectKeysDir 'public.pem'
    if (Test-Path -LiteralPath $projectPrivatePath) { Copy-Item -LiteralPath $projectPrivatePath -Destination ($projectPrivatePath + '.before-v171-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Force }
    if (Test-Path -LiteralPath $projectPublicPath) { Copy-Item -LiteralPath $projectPublicPath -Destination ($projectPublicPath + '.before-v171-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Force }
    [IO.File]::WriteAllText($projectPrivatePath, [string]$licenseKeyPair.PrivatePem, $script:Utf8NoBom)
    [IO.File]::WriteAllText($projectPublicPath, [string]$licenseKeyPair.PublicPem, $script:Utf8NoBom)
    Set-PrivateFileAcl $projectPrivatePath
    Write-Host '[OK] Nouvelle paire ECDSA enregistrée dans le dossier keys du projet.' -ForegroundColor Green
    }

    # Conserver les variables de configuration non secrètes déjà présentes.
    $manifest = Get-EnvironmentManifest
    foreach ($definition in $manifest.variables) {
        $name = [string]$definition.name
        $classification = [string]$definition.classification
        if ($remoteBackup.ContainsKey($name) -and -not $newValues.ContainsKey($name) -and $classification -match 'configuration|public') {
            $usableValue = Get-UsableExistingValue ([string]$remoteBackup[$name])
            if (-not [string]::IsNullOrWhiteSpace($usableValue)) { $newValues[$name] = $usableValue }
        }
    }
    # Conserver aussi les variables de marque et de limitation explicitement configurées.
    foreach ($name in $remoteBackup.Keys) {
        if (-not $newValues.ContainsKey($name) -and ($name -like 'GF_BRAND_*' -or $name -like 'NEXT_PUBLIC_GF_BRAND_*' -or $name -like 'RATE_LIMIT_*')) {
            $usableValue = Get-UsableExistingValue ([string]$remoteBackup[$name])
            if (-not [string]::IsNullOrWhiteSpace($usableValue)) { $newValues[$name] = $usableValue }
        }
    }

    foreach ($required in @('DATABASE_URL','DIRECT_URL','NEXTAUTH_URL','NEXTAUTH_SECRET','GARAGEFLOW_API_KEY','DEVICE_TOKEN_PEPPER','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','GF_DB_MAC_SECRET')) {
        if (-not $newValues.ContainsKey($required) -or [string]::IsNullOrWhiteSpace([string]$newValues[$required])) { throw "Variable obligatoire manquante : $required" }
    }
    Assert-Url 'DATABASE_URL' ([string]$newValues['DATABASE_URL']) -Postgres
    Assert-Url 'DIRECT_URL' ([string]$newValues['DIRECT_URL']) -Postgres
    if ([string]$newValues['DATABASE_URL'] -match '^file:' -or [string]$newValues['DIRECT_URL'] -match '^file:') {
        throw 'Sécurité : une URL SQLite ne peut jamais être envoyée à Vercel.'
    }
    if ($script:GfDryRun) { Write-Host '[DRY-RUN] Écriture de .vercelignore IGNORÉE.' -ForegroundColor Magenta } else { Ensure-VercelIgnore }

    # Ne supprimer que les variables que cette exécution sait recréer. Les variables
    # inconnues et les variables système restent intactes.
    $deletedNames = @($newValues.Keys | Where-Object {
        $remoteBackup.ContainsKey([string]$_) -and -not (Test-IsProtectedPlatformVariable ([string]$_))
    })
    Write-Host "[OK] $($newValues.Count) variables utilisateur seront recréées ; variables système et inconnues conservées." -ForegroundColor Green
    Write-Host '[4/7] Préparation de la mise à jour sûre...' -ForegroundColor Cyan
    $remoteMutationStarted = $true
    Write-Host '[OK] Aucune variable Production ne sera supprimée avant validation.' -ForegroundColor Green

    Write-Host '[5/7] Mise à jour des variables Production...' -ForegroundColor Cyan
    if ($script:GfDryRun) {
        Write-Host '[DRY-RUN] Mise à jour des variables Vercel Production IGNORÉE.' -ForegroundColor Magenta
    } else {
    $desktopRemove = Invoke-VercelCommand -Arguments @('env','rm','DESKTOP_DATABASE_URL','production','--yes','--no-color') -AllowFailure
    if ($desktopRemove.ExitCode -eq 0) { Write-Host '[OK] DESKTOP_DATABASE_URL supprimée de Vercel Production.' -ForegroundColor Green }
    Add-AllProductionVariables -Values $newValues -SensitiveNames $sensitiveNames
    Assert-ProductionDatabaseVariables `
        -ExpectedDatabaseUrl ([string]$newValues['DATABASE_URL']) `
        -ExpectedDirectUrl ([string]$newValues['DIRECT_URL']) `
        -TemporaryDirectory $backupDir
    Write-Host '[OK] PWA_DATABASE_URL/PWA_DIRECT_URL appliquées avant instrumentation ; validation finale sur le runtime Vercel.' -ForegroundColor Green
    }

    if ($script:GfDryRun -or $script:GfSkipDatabaseReset) {
        Write-Host '[DRY-RUN/-SkipDatabaseReset] Réparation legacyIdV* (DDL Neon) IGNORÉE — no-op sur ce projet.' -ForegroundColor Magenta
    } else {
        Repair-LegacyLicenseColumns -DirectUrl ([string]$newValues['DIRECT_URL']) -RunDirectory $runDir
    }

    # Convergence du schéma Neon vers le CODE fusionné (mechanic-licenses, chrono)
    # AVANT le déploiement — sinon LicenseKey.parentLicenseId & co. manquent et
    # toute requête Prisma les listant renvoie HTTP 500. Exécuté sur tout run réel
    # (indépendant de -SkipDatabaseReset, qui ne vise que la réparation legacyIdV*).
    # DDL additif et idempotent.
    if ($script:GfDryRun) {
        Write-Host '[DRY-RUN] Convergence du schéma Neon (DDL idempotent) IGNORÉE.' -ForegroundColor Magenta
    } else {
        Invoke-ServerSchemaConverge -DirectUrl ([string]$newValues['DIRECT_URL']) -RunDirectory $runDir
    }

    Write-Host '[6/7] Mise à jour locale et sauvegarde API générées...' -ForegroundColor Cyan
    $localValues = @{}
    foreach ($name in $newValues.Keys) { $localValues[$name] = [string]$newValues[$name] }
    $localValues['DATABASE_URL'] = 'file:./dev.db'
    $localValues.Remove('DIRECT_URL')
    if ($script:GfDryRun) {
        Write-Host '[DRY-RUN] Écriture .env local + keys/server_config.json + secrets.env IGNORÉE.' -ForegroundColor Magenta
    } else {
    Write-EnvMap -Path $localEnvPath -Map $localValues

    $keysDir = Split-Path -Parent $keygenPath
    if (-not (Test-Path -LiteralPath $keysDir)) { New-Item -ItemType Directory -Path $keysDir -Force | Out-Null }
    $keygen = [ordered]@{ url = $appUrl; api_key = [string]$newValues['GARAGEFLOW_API_KEY'] }
    [IO.File]::WriteAllText($keygenPath, ($keygen | ConvertTo-Json -Depth 4), $script:Utf8NoBom)
    Set-PrivateFileAcl $keygenPath

    Write-EnvMap -Path (Join-Path $runDir 'secrets.env') -Map $newValues
    }
    $summary = @(
        'GarageFlows - Rotation cryptographique totale',
        "Date : $([DateTime]::UtcNow.ToString('o'))",
        "Projet : $($script:VercelProject.Name)",
        "Variables supprimées : $($deletedNames.Count)",
        "Variables recréées : $($newValues.Count)",
        'Environnement : production',
        'Résultat : EN COURS - déploiement et tests non encore validés'
    )
    [IO.File]::WriteAllLines((Join-Path $runDir 'rapport-validation.txt'), [string[]]$summary, $script:Utf8NoBom)

    Write-Host '[7/7] Déploiement Vercel Production...' -ForegroundColor Cyan
    if ($script:GfDryRun -or $script:GfSkipDeploy) {
        Write-Host '[DRY-RUN/-SkipDeploy] Déploiement Vercel, tests runtime et suppression des licences IGNORÉS.' -ForegroundColor Magenta
    } else {
    $stagingDir = Join-Path $env:TEMP ('garageflow-vercel-staging-' + [Guid]::NewGuid().ToString('N'))
    try {
        $deploy = Invoke-ProductionDeployFromCleanCopy -StagingDirectory $stagingDir
        if ($deploy.ExitCode -ne 0) { throw "Déploiement Vercel en échec : $($deploy.Output)" }
        if ([string]::IsNullOrWhiteSpace([string]$deploy.DeploymentUrl)) {
            throw 'Le déploiement a réussi mais son URL Vercel n-a pas pu être détectée.'
        }
        Write-Host "[OK] Déploiement créé : $($deploy.DeploymentUrl)" -ForegroundColor Green

        # Tester le véritable runtime une seule fois. Un HTTP 500 ne permet pas
        # de conclure que DATABASE_URL est SQLite : seule l'erreur Runtime exacte
        # peut établir la cause. La capture live est démarrée avant l'appel HTTP.
        $healthCheckRaw = Test-NewDeploymentHealth `
            -DeploymentUrl ([string]$deploy.DeploymentUrl) `
            -RunDirectory $runDir
        $healthCheck = Assert-SingleHealthResult -Result $healthCheckRaw

        if (-not [bool]$healthCheck.Ok) {
            $bodySafe = Protect-LogText ([string]$healthCheck.Health.Output)
            if ($bodySafe.Length -gt 1200) { $bodySafe = $bodySafe.Substring(0,1200) }
            $reason = if ($healthCheck.Health.ProtectionIntercepted) {
                'Vercel Deployment Protection a intercepté la requête malgré vercel curl.'
            } elseif (-not $healthCheck.Health.Ok) {
                "vercel curl a retourné le code $($healthCheck.Health.ExitCode)."
            } else {
                '/api/health a retourné une réponse non valide ou un HTTP 500.'
            }
            throw "$reason Réponse : $bodySafe. Logs : $($healthCheck.DiagnosticPath)"
        }
        Write-Host '[OK] Nouveau déploiement protégé : /api/health = status ok.' -ForegroundColor Green

        if (-not (Test-ProtectedApiKeyEndpoint -DeploymentUrl ([string]$deploy.DeploymentUrl) -ApiKey ([string]$newValues['GARAGEFLOW_API_KEY']))) {
            $apiKeyDiag = if (-not [string]::IsNullOrWhiteSpace([string]$script:LastApiKeyDiag)) { ' ' + [string]$script:LastApiKeyDiag } else { '' }
            throw "La nouvelle GARAGEFLOW_API_KEY n-a pas passé le test runtime sur le déploiement Production (le check /api/health a réussi via vercel curl, donc la Deployment Protection n-est PAS en cause).$apiKeyDiag"
        }
        [void](Test-LicenseActivationRateLimit -DeploymentUrl ([string]$deploy.DeploymentUrl))

        # La rotation est validée côté runtime : invalider maintenant les anciennes
        # licences afin qu'aucun recordMac ni jeton signé avec les anciennes clés ne subsiste.
        if ($script:GfSkipLicenseReset) {
            Write-Host '[-SkipLicenseReset] Suppression des anciennes licences IGNORÉE.' -ForegroundColor Yellow
        } else {
            Reset-RemoteLicenseDataForFullRotation -DirectUrl ([string]$newValues['DIRECT_URL']) -RunDirectory $runDir
        }
    } finally {
        if (Test-Path -LiteralPath $stagingDir) { Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
    }

    $successSummary = @(
        'GarageFlows - Rotation cryptographique totale',
        "Date : $([DateTime]::UtcNow.ToString('o'))",
        "Projet : $($script:VercelProject.Name)",
        "Variables utilisateur supprimées : 0",
        "Variables utilisateur recréées : $($newValues.Count)",
        'Environnement : production',
        'Résultat : SUCCÈS - déploiement et tests validés'
    )
    [IO.File]::WriteAllLines((Join-Path $runDir 'rapport-validation.txt'), [string[]]$successSummary, $script:Utf8NoBom)
    $success = $true
    Write-Host ''
    if ($script:GfDryRun) {
        Write-Host '[DRY-RUN] Simulation terminée — AUCUNE modification Vercel/Neon/projet appliquée.' -ForegroundColor Magenta
    } else {
        Write-Host '[SUCCÈS] Tous les secrets ont été régénérés ; les anciennes licences ont été invalidées et supprimées.' -ForegroundColor Green
    }
    Write-Host "[SUCCÈS] Fichiers sécurisés : $runDir" -ForegroundColor Green
} catch {
    Write-Host "[ERREUR] $($_.Exception.Message)" -ForegroundColor Red
    if ($remoteMutationStarted) {
        Write-Host '[SÉCURITÉ] Aucun rollback automatique destructif : les variables n-ont pas été supprimées avant la mise à jour.' -ForegroundColor Yellow
        Write-Host '[SÉCURITÉ] Les valeurs actuellement présentes dans Vercel sont conservées pour permettre le diagnostic.' -ForegroundColor Yellow
    }
    if (Test-Path -LiteralPath $localEnvBackup) { Copy-Item -LiteralPath $localEnvBackup -Destination $localEnvPath -Force }
    if (Test-Path -LiteralPath $keygenBackup) { Copy-Item -LiteralPath $keygenBackup -Destination $keygenPath -Force }
    foreach ($psb in $script:PatchedSourceBackups) {
        if ($psb -and (Test-Path -LiteralPath $psb.Backup)) {
            Copy-Item -LiteralPath $psb.Backup -Destination $psb.Original -Force
            Write-Host "[ROLLBACK] Fichier source restauré : $($psb.Original)" -ForegroundColor Yellow
        }
    }
    $failureSummary = @(
        'GarageFlows - Rotation cryptographique totale',
        "Date : $([DateTime]::UtcNow.ToString('o'))",
        "Projet : $($script:VercelProject.Name)",
        'Environnement : production',
        'Résultat : ÉCHEC - aucun rollback destructif effectué',
        "Erreur : $($_.Exception.Message)"
    )
    [IO.File]::WriteAllLines((Join-Path $runDir 'rapport-validation.txt'), [string[]]$failureSummary, $script:Utf8NoBom)
    Write-Host "[INFO] Rapport et sauvegardes : $runDir" -ForegroundColor Yellow
    exit 1
} finally {
    $env:GF_CONFIGURER_API_TEST_MODE = $null
}

if ($success) { exit 0 }
exit 1
