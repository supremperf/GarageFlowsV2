#requires -Version 5.1
<#
.SYNOPSIS
  Configure, synchronise, valide et sauvegarde les variables d'environnement GarageFlow.
.DESCRIPTION
  Ce script distingue strictement l'environnement Electron/SQLite local de l'environnement
  PWA/Vercel/PostgreSQL. Les valeurs secrètes ne sont jamais écrites dans les journaux.
  Les écritures Vercel utilisent l'entrée standard de la CLI, jamais un secret en argument.
.NOTES
  Compatible Windows PowerShell 5.1 et PowerShell 7+.
  Version du script : 1.3.0
#>

[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [switch]$Repair,
    [switch]$RotateApiKey,
    [ValidateSet('production', 'preview', 'development')]
    [string[]]$Environment,
    [string]$Project,
    [switch]$NoDeploy,
    [switch]$NoBuild,
    [switch]$NoDatabaseMigration,
    [switch]$BackupOnly,
    [string]$Restore,
    [string]$OutputDirectory,
    [System.Security.SecureString]$VercelToken,
    [switch]$Force,
    [switch]$AllowDangerousKeyInitialization,
    [switch]$AutoRotateApiKey
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ScriptVersion = '1.3.3'
$script:ScriptPath = $MyInvocation.MyCommand.Path
$script:ScriptDirectory = Split-Path -Parent $script:ScriptPath
$script:ProjectRoot = $null
$script:RunDirectory = $null
$script:BackupDirectory = $null
$script:RollbackDirectory = $null
$script:ReportLines = New-Object 'System.Collections.Generic.List[string]'
$script:ManifestEntries = New-Object 'System.Collections.Generic.List[object]'
$script:SecretRegistry = New-Object 'System.Collections.Generic.List[string]'
$script:Transaction = New-Object 'System.Collections.Generic.List[object]'
$script:Vercel = $null
$script:VercelProject = $null
$script:VercelTokenPlain = $null
$script:CandidateSecrets = @{}
$script:AppliedValues = @{}
$script:ValueOrigins = @{}
$script:RunResult = 'NON_EXECUTE'
$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$script:IsWindows = $env:OS -eq 'Windows_NT'
$script:TargetEnvironments = @()
$script:DeploymentPerformed = $false
$script:ProductionVariablesChanged = $false

# Mode simplifié déclenché par generer-cle-api-automatique.cmd.
# Il ne fait tourner que GARAGEFLOW_API_KEY : les clés de chiffrement,
# de signature, de base de données et les jetons de fournisseurs tiers
# sont volontairement conservés.
if ($AutoRotateApiKey) {
    $Force = $true
    $Environment = @('production')
    $NoBuild = $true
    $NoDatabaseMigration = $true
}


function Set-ValueOrigin {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$EnvironmentLabel,
        [ValidateSet('générée', 'conservée', 'saisie', 'importée')][string]$Origin
    )
    $script:ValueOrigins["$EnvironmentLabel|$Name"] = $Origin
}

function Get-ValueOrigin {
    param([string]$Name, [string]$EnvironmentLabel, [string]$Default = 'conservée')
    $key = "$EnvironmentLabel|$Name"
    if ($script:ValueOrigins.ContainsKey($key)) { return [string]$script:ValueOrigins[$key] }
    return $Default
}

function ConvertFrom-SecureStringPlain {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][System.Security.SecureString]$Secure)
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Add-SecretToRegistry {
    param([AllowEmptyString()][string]$Value)
    if (-not [string]::IsNullOrEmpty($Value) -and -not $script:SecretRegistry.Contains($Value)) {
        [void]$script:SecretRegistry.Add($Value)
    }
}

function Protect-LogText {
    param([AllowNull()][object]$Text)
    if ($null -eq $Text) { return '' }
    $safe = [string]$Text
    foreach ($secret in $script:SecretRegistry) {
        if (-not [string]::IsNullOrEmpty($secret)) { $safe = $safe.Replace($secret, '[SECRET_MASQUE]') }
    }
    $safe = [regex]::Replace($safe, '(?i)\bpostgres(?:ql)?://[^\s,"\x27)]+', 'postgresql://[URL_MASQUEE]')
    $safe = [regex]::Replace($safe, '(?i)(authorization\s*:\s*bearer\s+)[^\s]+', '$1[SECRET_MASQUE]')
    $safe = [regex]::Replace($safe, '(?i)(x-gf-key\s*[:=]\s*)[^\s,;]+', '$1[SECRET_MASQUE]')
    $safe = [regex]::Replace($safe, '(?i)(token|secret|password|api[_-]?key)(\s*[:=]\s*)(?:"|\x27)?[^\s,"\x27;]+', '$1$2[SECRET_MASQUE]')
    return $safe
}

function Write-GFStatus {
    [CmdletBinding()]
    param(
        [ValidateSet('OK', 'ATTENTION', 'ERREUR', 'IGNORE', 'ROLLBACK', 'INFO')]
        [string]$Kind,
        [Parameter(Mandatory = $true)][string]$Message,
        [switch]$NoReport
    )
    $label = if ($Kind -eq 'IGNORE') { 'IGNORÉ' } else { $Kind }
    $line = "[$label] $(Protect-LogText $Message)"
    switch ($Kind) {
        'OK' { Write-Host $line -ForegroundColor Green }
        'ATTENTION' { Write-Host $line -ForegroundColor Yellow }
        'ERREUR' { Write-Host $line -ForegroundColor Red }
        'ROLLBACK' { Write-Host $line -ForegroundColor Magenta }
        default { Write-Host $line }
    }
    if (-not $NoReport) { [void]$script:ReportLines.Add($line) }
}

function Write-GFStep {
    param([int]$Current, [int]$Total, [string]$Name)
    $line = "[$Current/$Total] $Name"
    Write-Host ''
    Write-Host $line -ForegroundColor Cyan
    [void]$script:ReportLines.Add($line)
}

function Get-ShortFingerprint {
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Value, [int]$Length = 8)
    if ($null -eq $Value) { return 'ABSENTE' }
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
    $hex = -join ($hash | ForEach-Object { $_.ToString('X2') })
    return $hex.Substring(0, [Math]::Min($Length, $hex.Length))
}

function New-CryptoRandomValue {
    [CmdletBinding()]
    param(
        [ValidateRange(16, 256)][int]$Bytes = 32,
        [ValidateSet('base64', 'base64url', 'hex')][string]$Format = 'base64'
    )
    $buffer = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    switch ($Format) {
        'hex' { return (-join ($buffer | ForEach-Object { $_.ToString('x2') })) }
        'base64url' { return ([Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')) }
        default { return [Convert]::ToBase64String($buffer) }
    }
}

function New-CandidateSecretSet {
    # GF_INTERNAL_EXPORT_KEY est volontairement absent : Electron la génère en
    # mémoire pour chaque processus et elle ne doit jamais être persistée.
    $set = @{
        NEXTAUTH_SECRET       = New-CryptoRandomValue -Bytes 32 -Format base64
        GARAGEFLOW_API_KEY    = New-CryptoRandomValue -Bytes 32 -Format hex
        DEVICE_TOKEN_PEPPER   = New-CryptoRandomValue -Bytes 32 -Format base64
        GF_PORTAL_SECRET      = New-CryptoRandomValue -Bytes 32 -Format base64
        GF_TOTP_ENC_KEY       = New-CryptoRandomValue -Bytes 32 -Format base64
        GF_SMTP_CIPHER_KEY    = New-CryptoRandomValue -Bytes 32 -Format base64
        GF_SIGNATURE_SECRET   = New-CryptoRandomValue -Bytes 32 -Format base64
        GF_BACKUP_KEY         = New-CryptoRandomValue -Bytes 32 -Format base64
        GF_DB_MAC_SECRET      = New-CryptoRandomValue -Bytes 32 -Format hex
    }
    foreach ($value in $set.Values) { Add-SecretToRegistry $value }
    return $set
}

function Test-WeakSecret {
    param([AllowNull()][string]$Value, [int]$Minimum = 16)
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Trim().Length -lt $Minimum) { return $true }
    $lower = $Value.ToLowerInvariant()
    foreach ($marker in @('change_me', 'change-me', 'placeholder', 'example', 'your-secret', 'votre_secret', 'replace_with', 'changeme')) {
        if ($lower.Contains($marker)) { return $true }
    }
    return $false
}

function Test-VariableValue {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Definition, [AllowNull()][string]$Value, [string]$Target = 'server')
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return [pscustomobject]@{ Ok = -not [bool]$Definition.requiredProduction; Problem = 'absente ou vide' }
    }
    $format = [string]$Definition.format
    $ok = $true
    $problem = ''
    switch -Wildcard ($format) {
        'database-url' {
            if ($Target -eq 'desktop') { $ok = $Value -eq 'file:./dev.db'; $problem = 'le desktop exige exactement file:./dev.db' }
            else { $ok = $Value -match '^postgres(?:ql)?://'; $problem = 'une URL PostgreSQL est requise' }
        }
        'postgres-url' { $ok = $Value -match '^postgres(?:ql)?://'; $problem = 'une URL PostgreSQL est requise' }
        'https-url' { $ok = $Value -match '^https://'; $problem = 'une URL HTTPS est requise' }
        'http-url' { $ok = $Value -match '^https?://'; $problem = 'une URL HTTP(S) est requise' }
        'hex64' { $ok = $Value -match '^[0-9a-fA-F]{64}$'; $problem = '64 caractères hexadécimaux sont requis' }
        'base64-32-bytes' {
            try { $ok = ([Convert]::FromBase64String($Value).Length -eq 32) } catch { $ok = $false }
            $problem = 'la valeur doit être un Base64 décodant exactement 32 octets'
        }
        'strong-secret' { $ok = -not (Test-WeakSecret -Value $Value -Minimum ([int]$Definition.minLength)); $problem = 'secret absent, faible ou générique' }
        'nonempty-secret' { $ok = $Value.Length -ge [int]$Definition.minLength; $problem = "longueur minimale $($Definition.minLength)" }
        'enum:*' {
            $allowed = $format.Substring(5).Split(',')
            $ok = $allowed -contains $Value
            $problem = "valeur autorisée : $($allowed -join ', ')"
        }
        'semver' { $ok = $Value -match '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$'; $problem = 'version SemVer attendue' }
        'rfc3339' { try { [void][DateTimeOffset]::Parse($Value); $ok = $true } catch { $ok = $false }; $problem = 'date RFC3339 attendue' }
        'positive-int' { $parsed = 0; $ok = [int]::TryParse($Value, [ref]$parsed) -and $parsed -gt 0; $problem = 'entier strictement positif attendu' }
        'hex-color' { $ok = $Value -match '^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'; $problem = 'couleur hexadécimale attendue' }
        'email' { $ok = $Value -match '^[^@\s]+@[^@\s]+\.[^@\s]+$'; $problem = 'adresse e-mail attendue' }
        'domain' { $ok = $Value -match '^[A-Za-z0-9.-]+$' -and $Value.Contains('.'); $problem = 'nom de domaine sans protocole attendu' }
        'base64-pem-p256' {
            try { $pem = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value)); $ok = $pem -match '-----BEGIN (?:EC |)PRIVATE KEY-----' -and $pem -match '-----END (?:EC |)PRIVATE KEY-----' } catch { $ok = $false }
            $problem = 'clé privée PEM P-256 encodée en Base64 attendue'
        }
        default { $ok = $Value.Length -ge [int]$Definition.minLength; $problem = 'format ou longueur invalide' }
    }
    return [pscustomobject]@{ Ok = $ok; Problem = if ($ok) { '' } else { $problem } }
}

function Test-LicensePrivateKeyMatch {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Base64PrivateKey)
    Add-SecretToRegistry $Base64PrivateKey
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { throw 'Node.js est requis pour vérifier la paire de clés de licence.' }
    $code = @'
const crypto = require('crypto');
const fs = require('fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const privatePem = Buffer.from(input.trim(), 'base64').toString('utf8');
    const privateKey = crypto.createPrivateKey({ key: privatePem, format: 'pem' });
    if (privateKey.asymmetricKeyType !== 'ec') throw new Error('type-not-ec');
    const source = fs.readFileSync('src/lib/license/public-key.ts', 'utf8');
    const block = source.match(/const\s+_LINES\s*=\s*\[([\s\S]*?)\]/);
    if (!block) throw new Error('embedded-public-key-not-found');
    const expected = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]).join('\n').trim();
    const actual = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString().trim();
    const normalize = value => value.replace(/\r/g, '').trim();
    if (normalize(actual) !== normalize(expected)) throw new Error('public-key-mismatch');
    process.stdout.write('LICENSE_KEY_PAIR_OK');
  } catch (error) {
    process.stderr.write(String(error && error.message ? error.message : error));
    process.exit(2);
  }
});
'@
    Push-Location $script:ProjectRoot
    try { $result = Invoke-NativeCommand -Executable $node.Source -Arguments @('-e', $code) -InputText $Base64PrivateKey -AllowFailure }
    finally { Pop-Location }
    if ($result.ExitCode -ne 0 -or $result.Output -notmatch 'LICENSE_KEY_PAIR_OK') {
        Write-GFStatus ERREUR 'GF_PRIVATE_KEY est invalide ou ne correspond pas à la clé publique intégrée au client.'
        return $false
    }
    Write-GFStatus OK "GF_PRIVATE_KEY correspond à la clé publique intégrée — empreinte $(Get-ShortFingerprint $Base64PrivateKey)."
    return $true
}

function Find-ProjectRoot {
    [CmdletBinding()]
    param([string]$StartPath = $script:ScriptDirectory)
    $current = [IO.Path]::GetFullPath($StartPath)
    while ($current) {
        if ((Test-Path (Join-Path $current 'package.json')) -and
            (Test-Path (Join-Path $current 'prisma/schema.prisma')) -and
            (Test-Path (Join-Path $current 'prisma/server/schema.prisma'))) { return $current }
        $parent = Split-Path -Parent $current
        if ([string]::IsNullOrEmpty($parent) -or $parent -eq $current) { break }
        $current = $parent
    }
    throw 'Racine GarageFlow introuvable (package.json et schémas Prisma requis).'
}

function Get-DesktopDirectory {
    $desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
    if ([string]::IsNullOrWhiteSpace($desktop)) { $desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop) }
    if ([string]::IsNullOrWhiteSpace($desktop)) { throw 'Le dossier Bureau Windows est introuvable.' }
    return $desktop
}

function Set-PrivateFileAcl {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    if (-not $script:IsWindows) { return }

    # Utiliser le SID évite les erreurs de traduction de comptes locaux, Microsoft
    # ou de règles ACL orphelines. L'échec du durcissement reste non bloquant.
    try {
        $resolvedPath = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).ProviderPath
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        if ([string]::IsNullOrWhiteSpace($sid)) { throw 'SID du compte Windows courant introuvable.' }

        $icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
        if (-not (Test-Path -LiteralPath $icacls -PathType Leaf)) { throw 'icacls.exe introuvable.' }

        $item = Get-Item -LiteralPath $resolvedPath -Force
        $grant = if ($item.PSIsContainer) { "*${sid}:(OI)(CI)F" } else { "*${sid}:(F)" }
        $output = & $icacls $resolvedPath '/inheritance:r' '/grant:r' $grant '/Q' 2>&1
        $code = $LASTEXITCODE
        if ($code -ne 0) {
            $detail = Protect-LogText (($output | ForEach-Object { [string]$_ }) -join ' ')
            if ([string]::IsNullOrWhiteSpace($detail)) { $detail = "code icacls $code" }
            throw $detail
        }
        return
    } catch {
        Write-GFStatus ATTENTION "Permissions privées non appliquées à $(Split-Path -Leaf $Path) : $($_.Exception.Message)"
        return
    }
}

function Initialize-RunDirectory {
    $base = $OutputDirectory
    if ([string]::IsNullOrWhiteSpace($base)) { $base = Join-Path (Get-DesktopDirectory) 'API générées' }
    $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
    $run = Join-Path $base $stamp
    $suffix = 0
    while (Test-Path -LiteralPath $run) { $suffix++; $run = Join-Path $base ("${stamp}_$suffix") }
    New-Item -ItemType Directory -Path $run -Force | Out-Null
    $script:RunDirectory = $run
    $script:BackupDirectory = Join-Path $run 'sauvegardes'
    $script:RollbackDirectory = Join-Path $run 'rollback'
    New-Item -ItemType Directory -Path $script:BackupDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path $script:RollbackDirectory -Force | Out-Null
    Set-PrivateFileAcl $run
    Set-PrivateFileAcl $script:BackupDirectory
    Set-PrivateFileAcl $script:RollbackDirectory
    return $run
}

function Get-TextFileDocument {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path, [switch]$AllowMissing)
    if (-not (Test-Path -LiteralPath $Path)) {
        if ($AllowMissing) {
            return [pscustomobject]@{ Path = $Path; Text = ''; Lines = @(); NewLine = "`r`n"; Encoding = $script:Utf8NoBom; HasTrailingNewLine = $true }
        }
        throw "Fichier introuvable : $Path"
    }
    $bytes = [IO.File]::ReadAllBytes($Path)
    $encoding = $script:Utf8NoBom
    $offset = 0
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $encoding = [Text.UTF8Encoding]::new($true); $offset = 3 }
    elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) { $encoding = [Text.Encoding]::Unicode; $offset = 2 }
    elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) { $encoding = [Text.Encoding]::BigEndianUnicode; $offset = 2 }
    else {
        try {
            $strictUtf8 = [Text.UTF8Encoding]::new($false, $true)
            [void]$strictUtf8.GetString($bytes)
            $encoding = $script:Utf8NoBom
        } catch { $encoding = [Text.Encoding]::Default }
    }
    $text = $encoding.GetString($bytes, $offset, $bytes.Length - $offset)
    $newline = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
    $trailing = $text.EndsWith("`n") -or $text.EndsWith("`r")
    $lines = if ($text.Length -eq 0) { @() } else { [regex]::Split($text, '\r\n|\n|\r') }
    if ($trailing -and $lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') { $lines = @($lines[0..($lines.Count - 2)]) }
    return [pscustomobject]@{ Path = $Path; Text = $text; Lines = @($lines); NewLine = $newline; Encoding = $encoding; HasTrailingNewLine = $trailing }
}

function ConvertFrom-DotEnvLiteral {
    param([AllowEmptyString()][string]$Raw)
    $value = $Raw.Trim()
    if ($value.Length -ge 2 -and $value[0] -eq '"') {
        $builder = New-Object Text.StringBuilder
        $escaped = $false
        for ($i = 1; $i -lt $value.Length; $i++) {
            $c = $value[$i]
            if ($escaped) {
                switch ($c) { 'n' { [void]$builder.Append("`n") }; 'r' { [void]$builder.Append("`r") }; 't' { [void]$builder.Append("`t") }; default { [void]$builder.Append($c) } }
                $escaped = $false
            } elseif ($c -eq '\') { $escaped = $true }
            elseif ($c -eq '"') { break }
            else { [void]$builder.Append($c) }
        }
        return $builder.ToString()
    }
    if ($value.Length -ge 2 -and $value[0] -eq "'") {
        $end = $value.IndexOf("'", 1)
        if ($end -gt 0) { return $value.Substring(1, $end - 1) }
    }
    $m = [regex]::Match($value, '^(.*?)(?:\s+#.*)?$')
    return $m.Groups[1].Value.Trim()
}

function ConvertTo-DotEnvLiteral {
    param([AllowEmptyString()][string]$Value)
    if ($null -eq $Value) { return '""' }
    $escaped = $Value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
    return '"' + $escaped + '"'
}

function Get-DotEnvEntries {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Document)

    # Utiliser un tableau PowerShell natif. Windows PowerShell 5.1 peut lever
    # "Les types des arguments ne correspondent pas" lorsqu'une List<T>
    # générique vide est enveloppée dans @() à la sortie d'une fonction.
    $entries = @()
    $lineCount = if ($null -eq $Document.Lines) { 0 } else { [int]$Document.Lines.Count }
    for ($i = 0; $i -lt $lineCount; $i++) {
        $line = [string]$Document.Lines[$i]
        $m = [regex]::Match($line, '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
        if ($m.Success) {
            $entries += [pscustomobject]@{
                Key   = $m.Groups[1].Value
                Value = ConvertFrom-DotEnvLiteral $m.Groups[2].Value
                Index = $i
                Raw   = $line
            }
        }
    }
    return $entries
}

function Get-DotEnvMap {
    param([Parameter(Mandatory = $true)]$Document)
    $map = @{}
    $entries = @(Get-DotEnvEntries -Document $Document)
    foreach ($entry in $entries) {
        if (-not $map.ContainsKey($entry.Key)) { $map[$entry.Key] = @() }
        $map[$entry.Key] += $entry
    }
    return $map
}

function Set-DotEnvValue {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)][string]$Name, [AllowEmptyString()][string]$Value)
    $map = Get-DotEnvMap -Document $Document
    $newLine = "$Name=$(ConvertTo-DotEnvLiteral $Value)"
    $lines = @()
    foreach ($line in @($Document.Lines)) { $lines += [string]$line }
    if ($map.ContainsKey($Name)) {
        $matches = @($map[$Name])
        $lines[[int]$matches[0].Index] = $newLine
        if ($matches.Count -gt 1) {
            for ($j = 1; $j -lt $matches.Count; $j++) {
                $lines[[int]$matches[$j].Index] = "# [configurer-api] doublon $Name supprimé"
            }
        }
    } else {
        if ($lines.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($lines[$lines.Count - 1])) { $lines += '' }
        $lines += $newLine
    }
    $Document.Lines = $lines
    return $Document
}

function Test-DotEnvDuplicates {
    param([Parameter(Mandatory = $true)]$Document)
    $duplicates = @()
    $map = Get-DotEnvMap $Document
    foreach ($key in $map.Keys) { if ($map[$key].Count -gt 1) { $duplicates += $key } }
    return @($duplicates | Sort-Object -Unique)
}

function Write-TextDocumentAtomic {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Document)
    $directory = Split-Path -Parent ([string]$Document.Path)
    if ([string]::IsNullOrWhiteSpace($directory)) { throw "Dossier parent invalide pour $($Document.Path)." }
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    $text = @($Document.Lines) -join [string]$Document.NewLine
    if ($Document.HasTrailingNewLine -or @($Document.Lines).Count -gt 0) { $text += [string]$Document.NewLine }
    $temp = Join-Path $directory ('.gf-env-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $replaceBackup = $temp + '.replace-backup'
    try {
        [IO.File]::WriteAllText($temp, $text, $Document.Encoding)
        [void](Set-PrivateFileAcl $temp)
        $expectedHash = Get-FileSha256 $temp

        if (Test-Path -LiteralPath $Document.Path) {
            try {
                # PowerShell 5.1 peut rejeter File.Replace lorsque le troisième
                # argument vaut $null. Toujours fournir un vrai chemin temporaire.
                [IO.File]::Replace($temp, [string]$Document.Path, $replaceBackup, $true)
            } catch {
                # Repli compatible FAT/OneDrive/antivirus : la sauvegarde
                # transactionnelle existe déjà avant tout appel à cette fonction.
                Copy-Item -LiteralPath $temp -Destination ([string]$Document.Path) -Force
            }
        } else {
            Move-Item -LiteralPath $temp -Destination ([string]$Document.Path) -Force
        }

        $actualHash = Get-FileSha256 ([string]$Document.Path)
        if ([string]::IsNullOrWhiteSpace($actualHash) -or $actualHash -ne $expectedHash) {
            throw "Écriture atomique non vérifiée pour $($Document.Path)."
        }
        [void](Set-PrivateFileAcl ([string]$Document.Path))
    } finally {
        foreach ($candidate in @($temp, $replaceBackup)) {
            if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue }
        }
    }
}

function Backup-GFFile {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    if ([string]::IsNullOrWhiteSpace($Label)) { $Label = Split-Path -Leaf $Path }
    $safe = $Label -replace '[^A-Za-z0-9._-]', '_'
    $dest = Join-Path $script:BackupDirectory ((Get-Date -Format 'HHmmssfff') + '_' + $safe)
    Copy-Item -LiteralPath $Path -Destination $dest -Force
    Set-PrivateFileAcl $dest
    return $dest
}

function Get-FileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return (-join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('X2') })) }
    finally { $sha.Dispose(); $stream.Dispose() }
}

function Register-LocalRollback {
    param([string]$Target, [AllowNull()][string]$Backup, [bool]$Existed)
    [void]$script:Transaction.Add([pscustomobject]@{ Type = 'local'; Target = $Target; Backup = $Backup; Existed = $Existed; Completed = $true })
}

function Restore-LocalTransactions {
    $actions = @($script:Transaction | Where-Object { $_.Type -eq 'local' })
    for ($i = $actions.Count - 1; $i -ge 0; $i--) {
        $action = $actions[$i]
        try {
            if ($action.Existed -and $action.Backup -and (Test-Path -LiteralPath $action.Backup)) {
                $expected = Get-FileSha256 $action.Backup
                Copy-Item -LiteralPath $action.Backup -Destination $action.Target -Force
                $actual = Get-FileSha256 $action.Target
                if ($actual -ne $expected) { throw 'empreinte restaurée différente de la sauvegarde' }
            } elseif (-not $action.Existed -and (Test-Path -LiteralPath $action.Target)) {
                Remove-Item -LiteralPath $action.Target -Force
                if (Test-Path -LiteralPath $action.Target) { throw 'le fichier créé existe encore' }
            }
            Write-GFStatus ROLLBACK "Restauration locale vérifiée : $(Split-Path -Leaf $action.Target)"
        } catch { Write-GFStatus ERREUR "Rollback local impossible pour $($action.Target) : $($_.Exception.Message)" }
    }
}

function Ensure-GitIgnoreProtection {
    param([Parameter(Mandatory = $true)][string]$Root)
    $path = Join-Path $Root '.gitignore'
    $required = @('.env', '.env.local', '.env.*.local', 'keys/*.json', 'keys/server_config.json', 'API générées/')
    $doc = Get-TextFileDocument -Path $path -AllowMissing
    $existing = @($doc.Lines | ForEach-Object { ([string]$_).Trim() })
    $changed = $false
    foreach ($pattern in $required) {
        if ($existing -notcontains $pattern) { $doc.Lines += $pattern; $changed = $true }
    }
    if ($changed) {
        $backup = Backup-GFFile $path '.gitignore'
        Register-LocalRollback -Target $path -Backup $backup -Existed:(Test-Path -LiteralPath $path)
        Write-TextDocumentAtomic $doc
        Write-GFStatus OK '.gitignore renforcé pour les fichiers sensibles.'
    } else { Write-GFStatus OK 'Les fichiers sensibles sont couverts par .gitignore.' }
}

function Test-GitIgnoredPath {
    param([Parameter(Mandatory = $true)][string]$Root, [Parameter(Mandatory = $true)][string]$RelativePath)
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git -and (Test-Path (Join-Path $Root '.git'))) {
        Push-Location $Root
        try { & $git.Source check-ignore -q -- $RelativePath 2>$null; return $LASTEXITCODE -eq 0 }
        finally { Pop-Location }
    }
    $ignore = Join-Path $Root '.gitignore'
    if (-not (Test-Path $ignore)) { return $false }
    $content = [IO.File]::ReadAllText($ignore)
    if ($RelativePath -eq '.env') { return $content -match '(?m)^\.env\s*$' }
    if ($RelativePath -eq 'keys/server_config.json') { return $content -match '(?m)^keys/(?:\*\.json|server_config\.json)\s*$' }
    return $false
}

function Read-SecretValue {
    param([Parameter(Mandatory = $true)][string]$Prompt, [switch]$AllowEmpty)
    while ($true) {
        $secure = Read-Host $Prompt -AsSecureString
        $plain = ConvertFrom-SecureStringPlain $secure
        if ($AllowEmpty -or -not [string]::IsNullOrWhiteSpace($plain)) { Add-SecretToRegistry $plain; return $plain }
        Write-GFStatus ATTENTION 'Une valeur est requise.'
    }
}

function Read-ConfirmedText {
    param([Parameter(Mandatory = $true)][string]$Prompt, [Parameter(Mandatory = $true)][string]$Expected)
    $answer = Read-Host $Prompt
    return $answer -ceq $Expected
}

function Confirm-GFAction {
    param([Parameter(Mandatory = $true)][string]$Prompt, [switch]$DefaultYes)
    if ($Force) { return $true }
    $suffix = if ($DefaultYes) { '[O/n]' } else { '[o/N]' }
    $answer = Read-Host "$Prompt $suffix"
    if ([string]::IsNullOrWhiteSpace($answer)) { return [bool]$DefaultYes }
    return $answer.Trim().ToLowerInvariant() -in @('o', 'oui', 'y', 'yes')
}

function Get-EnvironmentManifest {
    $path = Join-Path $script:ScriptDirectory 'garageflow-env-manifest.json'
    if (-not (Test-Path -LiteralPath $path)) { throw "Manifeste des variables introuvable : $path" }
    return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Get-CodeEnvironmentVariables {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Root)
    $names = New-Object 'System.Collections.Generic.HashSet[string]'
    $extensions = @('.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.prisma')
    $files = Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
        $extensions -contains $_.Extension -and $_.FullName -notmatch '[\\/](node_modules|\.next|dist|coverage|\.git)[\\/]'
    }
    $patterns = @(
        'process\.env\.([A-Z][A-Z0-9_]*)',
        'process\.env\[(?:"|\x27)([A-Z][A-Z0-9_]*)(?:"|\x27)\]',
        '\be\.([A-Z][A-Z0-9_]*)',
        'env(?:Int|String)?\((?:"|\x27)([A-Z][A-Z0-9_]*)(?:"|\x27)',
        'os\.environ(?:\.get)?\((?:"|\x27)([A-Z][A-Z0-9_]*)(?:"|\x27)'
    )
    foreach ($file in $files) {
        try { $text = [IO.File]::ReadAllText($file.FullName) } catch { continue }
        foreach ($pattern in $patterns) {
            foreach ($match in [regex]::Matches($text, $pattern)) { [void]$names.Add($match.Groups[1].Value) }
        }
    }
    return @($names | Sort-Object)
}

function Resolve-VercelCommand {
    $global = Get-Command vercel -ErrorAction SilentlyContinue
    if ($global) { return [pscustomobject]@{ Executable = $global.Source; Prefix = @(); Description = 'Vercel CLI globale' } }
    $npx = Get-Command npx -ErrorAction SilentlyContinue
    if (-not $npx) { throw 'Vercel CLI absente et npx introuvable.' }
    $probe = Invoke-NativeCommand -Executable $npx.Source -Arguments @('--no-install', 'vercel', '--version') -AllowFailure
    if ($probe.ExitCode -eq 0) { return [pscustomobject]@{ Executable = $npx.Source; Prefix = @('--no-install', 'vercel'); Description = 'Vercel CLI via npx local' } }
    if (-not (Confirm-GFAction 'Vercel CLI n-est pas installée. Autoriser npx à la télécharger officiellement ?')) { throw 'Vercel CLI requise.' }
    return [pscustomobject]@{ Executable = $npx.Source; Prefix = @('--yes', 'vercel'); Description = 'Vercel CLI via npx' }
}

function Invoke-NativeCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [string[]]$Arguments = @(),
        [AllowNull()][string]$InputText,
        [hashtable]$EnvironmentVariables,
        [switch]$Interactive,
        [switch]$AllowFailure
    )
    $saved = @{}
    if ($EnvironmentVariables) {
        foreach ($key in $EnvironmentVariables.Keys) {
            $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, [string]$EnvironmentVariables[$key], 'Process')
        }
    }
    try {
        if ($Interactive) {
            & $Executable @Arguments
            $code = $LASTEXITCODE
            if ($code -ne 0 -and -not $AllowFailure) { throw "Commande externe en échec (code $code)." }
            return [pscustomobject]@{ ExitCode = $code; Output = '' }
        }
        # Windows PowerShell 5.1 transforme parfois une sortie stderr d-un programme natif
        # en ErrorRecord. Avec ErrorActionPreference=Stop, une commande pourtant réussie
        # (notamment `vercel --version` et `vercel whoami`) déclenchait alors une exception.
        # On se fie exclusivement au code de sortie natif et on restaure immédiatement
        # la préférence globale après la capture stdout/stderr.
        $raw = $null
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            if ($PSBoundParameters.ContainsKey('InputText')) { $raw = @($InputText | & $Executable @Arguments 2>&1) }
            else { $raw = @(& $Executable @Arguments 2>&1) }
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        $output = Protect-LogText (($raw | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
        if ($code -ne 0 -and -not $AllowFailure) { throw "Commande externe en échec (code $code) : $output" }
        return [pscustomobject]@{ ExitCode = $code; Output = $output }
    } finally {
        if ($EnvironmentVariables) {
            foreach ($key in $EnvironmentVariables.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
        }
    }
}

function Invoke-VercelCommand {
    [CmdletBinding()]
    param([string[]]$Arguments = @(), [AllowNull()][string]$InputText, [switch]$Interactive, [switch]$AllowFailure)
    if ($null -eq $script:Vercel) { $script:Vercel = Resolve-VercelCommand }
    # Toutes les commandes Vercel doivent cibler explicitement la racine du projet.
    # Le lanceur CMD s'exécute depuis scripts\ ; sans --cwd, la CLI ne retrouve pas
    # .vercel/project.json même si `vercel link` a correctement lié la racine.
    $cwdArguments = @()
    $hasExplicitCwd = $false
    foreach ($argument in @($Arguments)) {
        if ([string]$argument -eq '--cwd' -or ([string]$argument).StartsWith('--cwd=')) {
            $hasExplicitCwd = $true
            break
        }
    }
    if (-not $hasExplicitCwd -and -not [string]::IsNullOrWhiteSpace($script:ProjectRoot)) {
        $cwdArguments = @('--cwd', $script:ProjectRoot)
    }
    $all = @($script:Vercel.Prefix) + $cwdArguments + @($Arguments)
    $extra = @{}
    if (-not [string]::IsNullOrEmpty($script:VercelTokenPlain)) { $extra['VERCEL_TOKEN'] = $script:VercelTokenPlain }
    if ($PSBoundParameters.ContainsKey('InputText')) {
        return Invoke-NativeCommand -Executable $script:Vercel.Executable -Arguments $all -InputText $InputText -EnvironmentVariables $extra -Interactive:$Interactive -AllowFailure:$AllowFailure
    }
    return Invoke-NativeCommand -Executable $script:Vercel.Executable -Arguments $all -EnvironmentVariables $extra -Interactive:$Interactive -AllowFailure:$AllowFailure
}

function Ensure-VercelConnection {
    $who = Invoke-VercelCommand -Arguments @('whoami', '--no-color') -AllowFailure
    if ($who.ExitCode -ne 0) {
        if (-not [string]::IsNullOrEmpty($script:VercelTokenPlain)) { throw 'Le token Vercel fourni n-a pas été accepté via VERCEL_TOKEN. Connexion interactive requise.' }
        Write-GFStatus ATTENTION 'Aucune session Vercel active. Ouverture de la connexion officielle.'
        [void](Invoke-VercelCommand -Arguments @('login') -Interactive)
        $who = Invoke-VercelCommand -Arguments @('whoami', '--no-color')
    }
    Write-GFStatus OK "Connexion Vercel active : $($who.Output.Trim())"
}

function Ensure-VercelLink {
    $projectFile = Join-Path $script:ProjectRoot '.vercel/project.json'
    if (-not (Test-Path -LiteralPath $projectFile)) {
        Write-GFStatus ATTENTION 'Le dossier local n-est lié à aucun projet Vercel.'
        # --cwd est ajouté centralement par Invoke-VercelCommand. Ne pas utiliser
        # l'ancienne syntaxe dépréciée `vercel link <directory>`.
        $args = @('link')
        if (-not [string]::IsNullOrWhiteSpace($Project)) { $args += @('--project', $Project) }
        [void](Invoke-VercelCommand -Arguments $args -Interactive)
    }
    if (-not (Test-Path -LiteralPath $projectFile)) { throw 'La liaison Vercel n-a pas créé .vercel/project.json.' }
    $projectJson = Get-Content -LiteralPath $projectFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $name = if ($projectJson.PSObject.Properties.Name -contains 'projectName') { [string]$projectJson.projectName } elseif ($Project) { $Project } else { [string]$projectJson.projectId }
    $scope = if ($projectJson.PSObject.Properties.Name -contains 'orgId') { [string]$projectJson.orgId } else { 'scope inconnu' }
    $script:VercelProject = [pscustomobject]@{ Name = $name; ProjectId = [string]$projectJson.projectId; Scope = $scope }
    Write-GFStatus OK "Projet Vercel ciblé : $name ; scope : $scope"
    if (-not [string]::IsNullOrWhiteSpace($Project) -and $name -ne $Project) {
        Write-GFStatus ATTENTION "Le projet déjà lié ($name) diffère du projet demandé ($Project)."
        if (-not (Confirm-GFAction "Autoriser explicitement les modifications sur le projet lié $name malgré cette différence ?")) {
            throw 'Projet Vercel différent de -Project ; modification refusée.'
        }
    }
    if (-not (Confirm-GFAction "Confirmer ce projet Vercel : $name ?" -DefaultYes)) { throw 'Projet Vercel non confirmé.' }
}

function New-SecureTemporaryDirectory {
    [CmdletBinding()]
    param([string]$Prefix = 'gf-temp')
    $parent = if ($script:RollbackDirectory -and (Test-Path -LiteralPath $script:RollbackDirectory)) {
        $script:RollbackDirectory
    } else {
        [IO.Path]::GetTempPath()
    }
    $path = Join-Path $parent ($Prefix + '-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    Set-PrivateFileAcl $path
    return $path
}

function Get-VercelEnvironmentSnapshot {
    [CmdletBinding()]
    param([ValidateSet('production', 'preview', 'development')][string]$Target)
    $list = Invoke-VercelCommand -Arguments @('env', 'ls', $Target, '--no-color') -AllowFailure
    if ($list.ExitCode -ne 0) { throw "Lecture des variables Vercel impossible pour $Target : $($list.Output)" }
    $knownNames = @((Get-EnvironmentManifest).variables | ForEach-Object { [string]$_.name })
    $present = @{}
    foreach ($name in $knownNames) { $present[$name] = [regex]::IsMatch($list.Output, "(?m)(^|\s)$([regex]::Escape($name))(\s|$)") }
    $tempDirectory = New-SecureTemporaryDirectory -Prefix 'gf-vercel'
    $temp = Join-Path $tempDirectory 'environment.env'
    $values = @{}
    try {
        $pull = Invoke-VercelCommand -Arguments @('env', 'pull', $temp, "--environment=$Target", '--yes', '--no-color') -AllowFailure
        if ($pull.ExitCode -eq 0 -and (Test-Path -LiteralPath $temp)) {
            Set-PrivateFileAcl $temp
            $doc = Get-TextFileDocument -Path $temp
            foreach ($entry in Get-DotEnvEntries $doc) { if (-not $values.ContainsKey($entry.Key)) { $values[$entry.Key] = $entry.Value; Add-SecretToRegistry $entry.Value } }
        }
    } finally {
        if (Test-Path -LiteralPath $tempDirectory) { Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue }
    }
    return [pscustomobject]@{ Target = $Target; Present = $present; Values = $values; Listing = $list.Output }
}

function Set-VercelVariable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value,
        [ValidateSet('production', 'preview', 'development')][string]$Target,
        [Parameter(Mandatory = $true)]$Snapshot,
        [switch]$Sensitive
    )
    Add-SecretToRegistry $Value
    $exists = [bool]$Snapshot.Present[$Name]
    $oldKnown = $Snapshot.Values.ContainsKey($Name)
    $oldValue = if ($oldKnown) { [string]$Snapshot.Values[$Name] } else { $null }
    if ($exists -and -not $oldKnown) {
        $safeOld = Get-SafeRemoteRollbackValue -Name $Name -Target $Target
        if (-not [string]::IsNullOrEmpty($safeOld)) { $oldKnown = $true; $oldValue = $safeOld }
    }
    if ($exists -and -not $oldKnown) {
        throw "$Name existe déjà dans Vercel/$Target mais sa valeur sensible est non lisible et aucune copie locale n-est disponible. Rotation refusée car le rollback ne serait pas garanti."
    }
    $action = if ($exists) { 'update' } else { 'add' }
    $args = @('env', $action, $Name, $Target, '--no-color')
    if ($action -eq 'update') { $args += '--yes' }
    if ($Sensitive -and $Target -ne 'development') { $args += '--sensitive' }
    $result = Invoke-VercelCommand -Arguments $args -InputText $Value -AllowFailure
    if ($result.ExitCode -ne 0) { throw "Vercel $action a échoué pour $Name/$Target : $($result.Output)" }
    [void]$script:Transaction.Add([pscustomobject]@{ Type = 'vercel'; Name = $Name; Target = $Target; Existed = $exists; OldKnown = $oldKnown; OldValue = $oldValue; Sensitive = [bool]$Sensitive; Completed = $true })
    [void]$script:ManifestEntries.Add([pscustomobject]@{ name = $Name; environment = $Target; origin = Get-ValueOrigin $Name $Target; fingerprint = Get-ShortFingerprint $Value; status = $action; verification = 'accusé CLI' })
    Write-GFStatus OK "$Name/$Target : $action réussi — empreinte $(Get-ShortFingerprint $Value)"
}

function Confirm-VercelAppliedVariables {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][hashtable]$ExpectedByTarget)
    foreach ($target in $ExpectedByTarget.Keys) {
        $expected = [hashtable]$ExpectedByTarget[$target]
        if ($expected.Count -eq 0) { continue }
        $snapshot = Get-VercelEnvironmentSnapshot -Target $target
        foreach ($name in $expected.Keys) {
            $value = [string]$expected[$name]
            if (-not [bool]$snapshot.Present[$name]) {
                throw "Vérification Vercel échouée : $name est absente de $target après écriture."
            }
            $isSecret = $name -notin @('NEXTAUTH_URL', 'GF_APP_URL', 'GF_LICENSE_SERVER', 'GF_UPDATE_SERVER', 'GF_UPDATE_CHANNEL')
            if ($isSecret) {
                # Vercel ne garantit pas la réexportation en clair des variables sensibles.
                # Une valeur masquée ou un jeton interne ne doit jamais être comparé à la valeur attendue.
                # La validation forte est effectuée après déploiement par le test authentifié de l'API.
                $verification = 'présence relue ; valeur sensible validée après déploiement'
            } elseif ($snapshot.Values.ContainsKey($name)) {
                $actual = [string]$snapshot.Values[$name]
                if ((Get-ShortFingerprint $actual) -ne (Get-ShortFingerprint $value)) {
                    throw "Vérification Vercel échouée : empreinte différente pour $name/$target."
                }
                $verification = 'présence et empreinte relues'
            } else {
                throw "Vérification Vercel échouée : valeur publique non relisible pour $name/$target."
            }
            [void]$script:ManifestEntries.Add([pscustomobject]@{
                name = $name
                environment = $target
                origin = Get-ValueOrigin $name $target
                fingerprint = Get-ShortFingerprint $value
                status = 'vérifiée'
                verification = $verification
            })
            Write-GFStatus OK "$name/$target : $verification — empreinte $(Get-ShortFingerprint $value)"
        }
    }
}

function Restore-VercelTransactions {
    $actions = @($script:Transaction | Where-Object { $_.Type -eq 'vercel' })
    for ($i = $actions.Count - 1; $i -ge 0; $i--) {
        $action = $actions[$i]
        try {
            if ($action.Existed) {
                if (-not $action.OldKnown) { Write-GFStatus ERREUR "Rollback Vercel impossible pour $($action.Name)/$($action.Target) : ancienne valeur inconnue."; continue }
                $args = @('env', 'update', $action.Name, $action.Target, '--yes', '--no-color')
                if ($action.Sensitive -and $action.Target -ne 'development') { $args += '--sensitive' }
                $res = Invoke-VercelCommand -Arguments $args -InputText ([string]$action.OldValue) -AllowFailure
            } else {
                $res = Invoke-VercelCommand -Arguments @('env', 'rm', $action.Name, $action.Target, '--yes', '--no-color') -AllowFailure
            }
            if ($res.ExitCode -ne 0) { Write-GFStatus ERREUR "Rollback Vercel en échec : $($action.Name)/$($action.Target)"; continue }
            $list = Invoke-VercelCommand -Arguments @('env', 'ls', $action.Target, '--no-color') -AllowFailure
            $present = $list.ExitCode -eq 0 -and [regex]::IsMatch($list.Output, "(?m)(^|\s)$([regex]::Escape([string]$action.Name))(\s|$)")
            if (($action.Existed -and -not $present) -or (-not $action.Existed -and $present)) {
                Write-GFStatus ERREUR "Rollback Vercel non vérifié : $($action.Name)/$($action.Target)"
                continue
            }
            if ($action.Existed -and -not $action.Sensitive -and $action.OldKnown) {
                $check = Get-VercelEnvironmentSnapshot -Target $action.Target
                if (-not $check.Values.ContainsKey($action.Name) -or (Get-ShortFingerprint ([string]$check.Values[$action.Name])) -ne (Get-ShortFingerprint ([string]$action.OldValue))) {
                    Write-GFStatus ERREUR "Rollback Vercel : ancienne empreinte non confirmée pour $($action.Name)/$($action.Target)."
                    continue
                }
                Write-GFStatus ROLLBACK "Vercel restauré ; présence et ancienne empreinte vérifiées : $($action.Name)/$($action.Target)"
            } elseif ($action.Existed) {
                Write-GFStatus ROLLBACK "Vercel restauré ; présence vérifiée, ancienne valeur sensible non relisible : $($action.Name)/$($action.Target)"
            } else {
                Write-GFStatus ROLLBACK "Variable Vercel créée pendant l-exécution puis supprimée et absence vérifiée : $($action.Name)/$($action.Target)"
            }
        } catch { Write-GFStatus ERREUR "Rollback Vercel impossible : $($_.Exception.Message)" }
    }
}

function Get-LocalEnvDocument {
    $path = Join-Path $script:ProjectRoot '.env'
    return Get-TextFileDocument -Path $path -AllowMissing
}

function Get-KnownLocalValue {
    param([Parameter(Mandatory = $true)][string]$Name)
    $envPath = Join-Path $script:ProjectRoot '.env'
    if (Test-Path -LiteralPath $envPath) {
        $doc = Get-TextFileDocument $envPath
        $map = Get-DotEnvMap $doc
        if ($map.ContainsKey($Name) -and $map[$Name].Count -gt 0) {
            $knownValue = [string]$map[$Name][0].Value
            Add-SecretToRegistry $knownValue
            return $knownValue
        }
    }
    if ($Name -eq 'GARAGEFLOW_API_KEY') {
        $cfgPath = Join-Path $script:ProjectRoot 'keys/server_config.json'
        if (Test-Path -LiteralPath $cfgPath) {
            try {
                $cfg = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($cfg.api_key) {
                    $knownValue = [string]$cfg.api_key
                    Add-SecretToRegistry $knownValue
                    return $knownValue
                }
            } catch { }
        }
    }
    return $null
}

function Update-LocalEnv {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][hashtable]$Values)
    $path = Join-Path $script:ProjectRoot '.env'
    $existed = Test-Path -LiteralPath $path
    $backup = Backup-GFFile $path '.env'
    Register-LocalRollback -Target $path -Backup $backup -Existed:$existed
    $doc = Get-TextFileDocument -Path $path -AllowMissing
    foreach ($name in $Values.Keys) {
        $value = [string]$Values[$name]
        Add-SecretToRegistry $value
        $doc = Set-DotEnvValue -Document $doc -Name $name -Value $value
    }
    Write-TextDocumentAtomic $doc
    $verify = Get-TextFileDocument $path
    $dupes = @(Test-DotEnvDuplicates -Document $verify)
    if ($dupes.Count -gt 0) { throw "Doublons .env après écriture : $($dupes -join ', ')" }
    $map = Get-DotEnvMap $verify
    foreach ($name in $Values.Keys) {
        if (-not $map.ContainsKey($name) -or $map[$name][0].Value -ne [string]$Values[$name]) { throw "Vérification .env échouée pour $name" }
        $origin = Get-ValueOrigin $name 'local'
        [void]$script:ManifestEntries.Add([pscustomobject]@{ name = $name; environment = 'local'; origin = $origin; fingerprint = Get-ShortFingerprint ([string]$Values[$name]); status = 'écrite'; verification = 'relecture locale' })
        Write-GFStatus OK "$name local : configurée — empreinte $(Get-ShortFingerprint ([string]$Values[$name]))"
    }
}

function Update-KeygenConfiguration {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ServerUrl, [Parameter(Mandatory = $true)][string]$ApiKey)
    $path = Join-Path $script:ProjectRoot 'keys/server_config.json'
    $directory = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    $existed = Test-Path -LiteralPath $path
    $backup = Backup-GFFile $path 'server_config.json'
    Register-LocalRollback -Target $path -Backup $backup -Existed:$existed
    $obj = [ordered]@{ url = $ServerUrl.Trim().TrimEnd('/'); api_key = $ApiKey.Trim() }
    Add-SecretToRegistry $ApiKey
    $json = $obj | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText($path, $json + [Environment]::NewLine, $script:Utf8NoBom)
    Set-PrivateFileAcl $path
    $check = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($check.url -ne $obj.url -or $check.api_key -ne $obj.api_key) { throw 'Vérification de keys/server_config.json échouée.' }
    Write-GFStatus OK "Keygen synchronisé — empreinte $(Get-ShortFingerprint $ApiKey)"
}

function Get-ServerBaseUrl {
    $candidates = @('GF_LICENSE_SERVER', 'GF_APP_URL', 'NEXTAUTH_URL')
    foreach ($name in $candidates) {
        $value = Get-KnownLocalValue $name
        if ($value -match '^https?://') { return $value.TrimEnd('/') }
    }
    $value = Read-Host 'URL HTTPS publique du serveur GarageFlow (ex. https://app.garageflows.fr)'
    if ($value -notmatch '^https://') { throw 'Une URL HTTPS est requise.' }
    return $value.TrimEnd('/')
}

function Test-HealthEndpoint {
    param([Parameter(Mandatory = $true)][string]$BaseUrl)
    try {
        $response = Invoke-WebRequest -Uri ($BaseUrl.TrimEnd('/') + '/api/health') -Method Get -UseBasicParsing -TimeoutSec 20
        if ([int]$response.StatusCode -ne 200) {
            Write-GFStatus ERREUR "/api/health répond HTTP $($response.StatusCode), attendu 200."
            return $false
        }
        try { $payload = $response.Content | ConvertFrom-Json } catch { $payload = $null }
        if ($payload -and $payload.PSObject.Properties.Name -contains 'status' -and [string]$payload.status -eq 'ok') {
            Write-GFStatus OK '/api/health répond HTTP 200 avec status=ok.'
            return $true
        }
        Write-GFStatus ERREUR '/api/health répond 200 mais sans status=ok.'
        return $false
    } catch {
        Write-GFStatus ERREUR "Test /api/health impossible : $($_.Exception.Message)"
        return $false
    }
}

function Test-ApiKeyEndpoint {
    param([Parameter(Mandatory = $true)][string]$BaseUrl, [Parameter(Mandatory = $true)][string]$ApiKey)
    Add-SecretToRegistry $ApiKey
    $headers = @{ 'x-gf-key' = $ApiKey; 'Content-Type' = 'application/json' }
    # Un UUID neuf avec status=active suit la branche not_registered et ne crée
    # ni ne modifie de licence. Une collision avec un licenseId réel est négligeable.
    $licenseId = 'config-test-' + [Guid]::NewGuid().ToString('N')
    $body = @{ licenseId = $licenseId; status = 'active' } | ConvertTo-Json -Compress
    try {
        $response = Invoke-WebRequest -Uri ($BaseUrl.TrimEnd('/') + '/api/admin/licenses/revoke-by-key') -Method Post -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 20
        if ([int]$response.StatusCode -ne 200) { Write-GFStatus ERREUR "Endpoint clé API : HTTP $($response.StatusCode), attendu 200."; return $false }
        try { $payload = $response.Content | ConvertFrom-Json } catch { $payload = $null }
        if ($payload -and $payload.ok -eq $true -and [string]$payload.note -eq 'not_registered') {
            Write-GFStatus OK 'GARAGEFLOW_API_KEY authentifiée par un test distant non destructif.'
            return $true
        }
        Write-GFStatus ERREUR 'La clé a reçu HTTP 200 mais la réponse non destructive attendue est absente.'
        return $false
    } catch {
        $status = $null
        if ($_.Exception.Response) { try { $status = [int]$_.Exception.Response.StatusCode } catch { } }
        Write-GFStatus ERREUR "Test authentifié de GARAGEFLOW_API_KEY en échec$(if ($status) { " (HTTP $status)" } else { '' })."
        return $false
    }
}

function Invoke-ProjectCommand {
    param([string]$Name, [string]$Executable, [string[]]$Arguments, [hashtable]$EnvironmentVariables, [switch]$Optional)
    Write-GFStatus INFO "Validation : $Name"
    Push-Location $script:ProjectRoot
    try {
        $res = Invoke-NativeCommand -Executable $Executable -Arguments $Arguments -EnvironmentVariables $EnvironmentVariables -AllowFailure
        if ($res.ExitCode -eq 0) { Write-GFStatus OK "$Name réussi."; return $true }
        if ($Optional) { Write-GFStatus ATTENTION "$Name non concluant : $($res.Output)"; return $false }
        Write-GFStatus ERREUR "$Name échoué : $($res.Output)"; return $false
    } finally { Pop-Location }
}

function Get-LocalNodeTool {
    param([Parameter(Mandatory = $true)][string]$Name)
    $bin = Join-Path $script:ProjectRoot 'node_modules/.bin'
    $candidates = if ($script:IsWindows) {
        @((Join-Path $bin ($Name + '.cmd')), (Join-Path $bin ($Name + '.exe')), (Join-Path $bin $Name))
    } else { @((Join-Path $bin $Name)) }
    foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate } }
    return $null
}

function Ensure-ProjectDependencies {
    $prisma = Get-LocalNodeTool 'prisma'
    $next = Get-LocalNodeTool 'next'
    $tsc = Get-LocalNodeTool 'tsc'
    if ($prisma -and $next -and $tsc) {
        Write-GFStatus OK 'Dépendances Node locales présentes (Prisma, Next.js, TypeScript).'
        return
    }
    if (-not (Confirm-GFAction 'Les dépendances Node sont absentes ou incomplètes. Exécuter npm ci maintenant ?' -DefaultYes)) {
        throw 'Dépendances Node requises. Aucun téléchargement implicite ne sera lancé pendant les validations.'
    }
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) { throw 'npm est introuvable.' }
    Push-Location $script:ProjectRoot
    try {
        $install = Invoke-NativeCommand -Executable $npm.Source -Arguments @('ci') -AllowFailure
        if ($install.ExitCode -ne 0) { throw "npm ci a échoué : $($install.Output)" }
    } finally { Pop-Location }
    foreach ($tool in @('prisma', 'next', 'tsc')) {
        if (-not (Get-LocalNodeTool $tool)) { throw "Dépendance locale introuvable après npm ci : $tool" }
    }
    Write-GFStatus OK 'Dépendances Node installées et vérifiées.'
}

function Test-UpstashConnection {
    param([hashtable]$Values)
    if (-not $Values -or -not $Values.ContainsKey('UPSTASH_REDIS_REST_URL') -or -not $Values.ContainsKey('UPSTASH_REDIS_REST_TOKEN')) {
        Write-GFStatus ATTENTION 'Test Upstash impossible : URL ou token non disponible en clair.'
        return $false
    }
    $url = ([string]$Values['UPSTASH_REDIS_REST_URL']).TrimEnd('/') + '/ping'
    $token = [string]$Values['UPSTASH_REDIS_REST_TOKEN']
    Add-SecretToRegistry $token
    Add-SecretToRegistry ([string]$Values['UPSTASH_REDIS_REST_URL'])
    try {
        $response = Invoke-RestMethod -Uri $url -Method Get -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 20
        if ($response.result -eq 'PONG') { Write-GFStatus OK 'Connexion Upstash validée par PING non destructif.'; return $true }
        Write-GFStatus ERREUR 'Upstash a répondu sans résultat PONG.'
        return $false
    } catch {
        Write-GFStatus ERREUR "Test Upstash en échec : $($_.Exception.Message)"
        return $false
    }
}

function Test-TrackedSecrets {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git -or -not (Test-Path (Join-Path $script:ProjectRoot '.git'))) {
        Write-GFStatus ATTENTION 'Dépôt Git non disponible : recherche des secrets limitée aux fichiers présents.'
        return $true
    }
    Push-Location $script:ProjectRoot
    try {
        $tracked = @(& $git.Source ls-files 2>$null)
        if ($LASTEXITCODE -ne 0) { Write-GFStatus ATTENTION 'git ls-files a échoué.'; return $true }
        $leaks = New-Object 'System.Collections.Generic.List[string]'
        foreach ($relative in $tracked) {
            $path = Join-Path $script:ProjectRoot $relative
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
            try {
                $bytes = [IO.File]::ReadAllBytes($path)
                if ($bytes.Length -gt 5MB -or $bytes -contains 0) { continue }
                $text = [Text.Encoding]::UTF8.GetString($bytes)
                foreach ($secret in $script:SecretRegistry) {
                    if ($secret.Length -ge 12 -and $text.Contains($secret)) { [void]$leaks.Add($relative); break }
                }
            } catch { }
        }
        if ($leaks.Count -gt 0) {
            Write-GFStatus ERREUR "Secret détecté dans des fichiers suivis par Git : $(@($leaks | Sort-Object -Unique) -join ', ')"
            return $false
        }
        Write-GFStatus OK 'Aucune valeur secrète connue détectée dans les fichiers suivis par Git.'
        return $true
    } finally { Pop-Location }
}

function Test-PostgreSqlSelectOne {
    param([hashtable]$ServerValues)
    if (-not $ServerValues -or -not $ServerValues.ContainsKey('DATABASE_URL')) {
        Write-GFStatus ATTENTION 'SELECT 1 impossible : DATABASE_URL serveur non disponible en clair.'
        return $false
    }
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Write-GFStatus ERREUR 'Node.js introuvable pour SELECT 1.'; return $false }
    $code = @'
const { PrismaClient } = require('./src/generated/server-client');
const db = new PrismaClient();
(async () => {
  try { await db.$queryRawUnsafe('SELECT 1'); process.stdout.write('SELECT_1_OK'); }
  finally { await db.$disconnect(); }
})().catch(() => process.exit(2));
'@
    $result = Invoke-ProjectCommand 'Connexion PostgreSQL SELECT 1' $node.Source @('-e', $code) $ServerValues
    return [bool]$result
}

function Invoke-TechnicalValidations {
    param([hashtable]$ServerValues, [switch]$AllowMigration)
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) { Write-GFStatus ERREUR 'npm introuvable pour les validations.'; return $false }
    $prisma = Get-LocalNodeTool 'prisma'
    $next = Get-LocalNodeTool 'next'
    $tsc = Get-LocalNodeTool 'tsc'
    if (-not $prisma -or -not $next -or -not $tsc) {
        Write-GFStatus ERREUR 'node_modules est absent ou incomplet ; validations impossibles sans dépendances locales.'
        return $false
    }

    $ok = $true
    $desktopEnv = @{ DATABASE_URL = 'file:./dev.db'; NEXTAUTH_URL = 'http://localhost:3000'; ELECTRON = '1'; NODE_ENV = 'development' }
    $localSecret = Get-KnownLocalValue 'NEXTAUTH_SECRET'
    if (-not (Test-WeakSecret $localSecret)) { $desktopEnv['NEXTAUTH_SECRET'] = $localSecret }

    if (-not (Invoke-ProjectCommand 'Prisma desktop validate' $prisma @('validate', '--schema', 'prisma/schema.prisma') $desktopEnv)) { $ok = $false }
    if (-not (Invoke-ProjectCommand 'Prisma desktop generate' $prisma @('generate', '--schema', 'prisma/schema.prisma') $desktopEnv)) { $ok = $false }

    $serverReady = $ServerValues -and $ServerValues.ContainsKey('DATABASE_URL') -and $ServerValues.ContainsKey('DIRECT_URL')
    if ($serverReady) {
        $serverEnv = @{}
        foreach ($k in $ServerValues.Keys) { $serverEnv[$k] = [string]$ServerValues[$k] }
        $serverEnv['NODE_ENV'] = 'production'
        if (-not (Invoke-ProjectCommand 'Prisma serveur validate' $prisma @('validate', '--schema', 'prisma/server/schema.prisma') $serverEnv)) { $ok = $false }
        if (-not (Invoke-ProjectCommand 'Prisma serveur generate' $prisma @('generate', '--schema', 'prisma/server/schema.prisma') $serverEnv)) { $ok = $false }
        if (-not (Invoke-ProjectCommand 'État des migrations serveur (lecture seule)' $prisma @('migrate', 'status', '--schema', 'prisma/server/schema.prisma') $serverEnv)) { $ok = $false }
        if (-not (Test-PostgreSqlSelectOne -ServerValues $serverEnv)) { $ok = $false }
        if (-not (Test-UpstashConnection -Values $serverEnv)) { $ok = $false }
        if ($AllowMigration -and -not $NoDatabaseMigration) {
            if (Confirm-GFAction 'scripts/validate-server-db.js peut appliquer des migrations et écrire temporairement dans la base. L-exécuter ?') {
                if (-not (Invoke-ProjectCommand 'Validation DB avec migrations/écriture contrôlée' $npm.Source @('run', 'db:server:check') $serverEnv)) { $ok = $false }
            } else { Write-GFStatus IGNORE 'Migration et test avec écriture contrôlée non autorisés.' }
        }
    } else {
        Write-GFStatus ATTENTION 'Validations PostgreSQL/Upstash ignorées : valeurs serveur non disponibles en clair.'
        if (-not $CheckOnly) { $ok = $false }
    }

    if (-not (Invoke-ProjectCommand 'Validation TypeScript' $tsc @('--noEmit', '--pretty', 'false') $desktopEnv)) { $ok = $false }
    $testEnv = @{} + $desktopEnv
    $testEnv['NODE_ENV'] = 'test'
    if (-not (Invoke-ProjectCommand 'Tests unitaires' $npm.Source @('test', '--', '--reporter=dot') $testEnv)) { $ok = $false }

    if (-not $NoBuild) {
        if ($serverReady) {
            if (-not (Invoke-ProjectCommand 'Build Next.js PWA' $next @('build') $serverEnv)) { $ok = $false }
        } else {
            $desktopBuildEnv = @{} + $desktopEnv
            $desktopBuildEnv['NODE_ENV'] = 'production'
            if (-not (Invoke-ProjectCommand 'Build Next.js Electron' $next @('build') $desktopBuildEnv)) { $ok = $false }
        }
    } else { Write-GFStatus IGNORE 'Build désactivé par -NoBuild.' }

    if (-not (Test-TrackedSecrets)) { $ok = $false }
    return $ok
}

function Write-SecureEnvExport {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Values, [string]$Header)
    $lines = New-Object 'System.Collections.Generic.List[string]'
    [void]$lines.Add('# HAUTEMENT CONFIDENTIEL — ne pas partager, ne pas committer.')
    if ($Header) { [void]$lines.Add("# $Header") }
    foreach ($key in @($Values.Keys | Sort-Object)) { [void]$lines.Add("$key=$(ConvertTo-DotEnvLiteral ([string]$Values[$key]))") }
    [IO.File]::WriteAllText($Path, ($lines -join "`r`n") + "`r`n", $script:Utf8NoBom)
    Set-PrivateFileAcl $Path
}

function Protect-FileWithPassword {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputPath,
        [Parameter(Mandatory = $true)][System.Security.SecureString]$Password
    )
    $plainPassword = ConvertFrom-SecureStringPlain $Password
    Add-SecretToRegistry $plainPassword
    try {
        $salt = New-Object byte[] 16
        $iv = New-Object byte[] 16
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($salt); $rng.GetBytes($iv) } finally { $rng.Dispose() }
        $kdf = [Security.Cryptography.Rfc2898DeriveBytes]::new($plainPassword, $salt, 200000)
        try { $material = $kdf.GetBytes(64) } finally { $kdf.Dispose() }
        $encKey = New-Object byte[] 32
        $macKey = New-Object byte[] 32
        [Array]::Copy($material, 0, $encKey, 0, 32)
        [Array]::Copy($material, 32, $macKey, 0, 32)
        $aes = [Security.Cryptography.Aes]::Create()
        try {
            $aes.KeySize = 256
            $aes.Mode = [Security.Cryptography.CipherMode]::CBC
            $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
            $aes.Key = $encKey
            $aes.IV = $iv
            $encryptor = $aes.CreateEncryptor()
            $inputBytes = [IO.File]::ReadAllBytes($InputPath)
            try { $cipher = $encryptor.TransformFinalBlock($inputBytes, 0, [int]$inputBytes.Length) }
            finally { $encryptor.Dispose() }
        } finally { $aes.Dispose() }
        $magic = [Text.Encoding]::ASCII.GetBytes('GFSEC1')
        $authenticated = New-Object byte[] ($magic.Length + $salt.Length + $iv.Length + $cipher.Length)
        $offset = 0
        foreach ($part in @($magic, $salt, $iv, $cipher)) { [Array]::Copy($part, 0, $authenticated, $offset, $part.Length); $offset += $part.Length }
        $hmac = [Security.Cryptography.HMACSHA256]::new($macKey)
        try { $tag = $hmac.ComputeHash($authenticated) } finally { $hmac.Dispose() }
        $final = New-Object byte[] ($authenticated.Length + $tag.Length)
        [Array]::Copy($authenticated, 0, $final, 0, $authenticated.Length)
        [Array]::Copy($tag, 0, $final, $authenticated.Length, $tag.Length)
        [IO.File]::WriteAllBytes($OutputPath, $final)
        Set-PrivateFileAcl $OutputPath
    } finally {
        $plainPassword = $null
    }
}

function Test-ByteArrayEqual {
    param([byte[]]$Left, [byte[]]$Right)
    if ($null -eq $Left -or $null -eq $Right -or $Left.Length -ne $Right.Length) { return $false }
    $diff = 0
    for ($i = 0; $i -lt $Left.Length; $i++) { $diff = $diff -bor ($Left[$i] -bxor $Right[$i]) }
    return $diff -eq 0
}

function Unprotect-FileWithPassword {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputPath,
        [Parameter(Mandatory = $true)][System.Security.SecureString]$Password
    )
    $data = [IO.File]::ReadAllBytes($InputPath)
    $magic = [Text.Encoding]::ASCII.GetBytes('GFSEC1')
    $minimum = $magic.Length + 16 + 16 + 1 + 32
    if ($data.Length -lt $minimum) { throw 'Fichier GFSEC1 tronqué ou invalide.' }
    for ($i = 0; $i -lt $magic.Length; $i++) { if ($data[$i] -ne $magic[$i]) { throw 'Format GFSEC1 invalide.' } }
    $salt = New-Object byte[] 16; [Array]::Copy($data, $magic.Length, $salt, 0, 16)
    $iv = New-Object byte[] 16; [Array]::Copy($data, $magic.Length + 16, $iv, 0, 16)
    $cipherLength = $data.Length - $magic.Length - 16 - 16 - 32
    $authenticated = New-Object byte[] ($data.Length - 32)
    [Array]::Copy($data, 0, $authenticated, 0, $authenticated.Length)
    $cipher = New-Object byte[] $cipherLength
    [Array]::Copy($data, $magic.Length + 32, $cipher, 0, $cipherLength)
    $tag = New-Object byte[] 32; [Array]::Copy($data, $data.Length - 32, $tag, 0, 32)
    $plainPassword = ConvertFrom-SecureStringPlain $Password
    Add-SecretToRegistry $plainPassword
    try {
        $kdf = [Security.Cryptography.Rfc2898DeriveBytes]::new($plainPassword, $salt, 200000)
        try { $material = $kdf.GetBytes(64) } finally { $kdf.Dispose() }
        $encKey = New-Object byte[] 32; $macKey = New-Object byte[] 32
        [Array]::Copy($material, 0, $encKey, 0, 32); [Array]::Copy($material, 32, $macKey, 0, 32)
        $hmac = [Security.Cryptography.HMACSHA256]::new($macKey)
        try { $expected = $hmac.ComputeHash($authenticated) } finally { $hmac.Dispose() }
        if (-not (Test-ByteArrayEqual $tag $expected)) { throw 'Mot de passe incorrect ou fichier altéré.' }
        $aes = [Security.Cryptography.Aes]::Create()
        try {
            $aes.KeySize = 256; $aes.Mode = [Security.Cryptography.CipherMode]::CBC; $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
            $aes.Key = $encKey; $aes.IV = $iv
            $decryptor = $aes.CreateDecryptor()
            try { $plain = $decryptor.TransformFinalBlock($cipher, 0, $cipher.Length) } finally { $decryptor.Dispose() }
        } finally { $aes.Dispose() }
        [IO.File]::WriteAllBytes($OutputPath, $plain)
        Set-PrivateFileAcl $OutputPath
    } finally { $plainPassword = $null }
}

function Write-Utf8LinesSafe {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [AllowNull()][object]$Lines
    )

    # Ne pas utiliser ToArray(), [string[]]@(...) ou une surcharge prenant
    # IEnumerable ici. Windows PowerShell 5.1 peut lever l'erreur générique
    # "Les types des arguments ne correspondent pas" avec une List<T> vide.
    $builder = New-Object System.Text.StringBuilder
    if ($null -ne $Lines) {
        foreach ($line in $Lines) {
            [void]$builder.Append([string]$line)
            [void]$builder.Append([Environment]::NewLine)
        }
    }
    [IO.File]::WriteAllText([string]$Path, [string]$builder.ToString(), $script:Utf8NoBom)
}

function Write-RunArtifacts {
    param(
        [AllowNull()][System.Collections.IDictionary]$Missing,
        [AllowNull()][System.Collections.IDictionary]$EnvironmentExports
    )
    if ($null -eq $Missing) { $Missing = @{} }
    if ($null -eq $EnvironmentExports) { $EnvironmentExports = @{} }

    $secrets = @{}
    foreach ($key in $script:AppliedValues.Keys) { $secrets[$key] = [string]$script:AppliedValues[$key] }
    if ($secrets.Count -gt 0) {
        $secretsPath = Join-Path $script:RunDirectory 'secrets.env'
        Write-SecureEnvExport -Path $secretsPath -Values $secrets -Header 'Valeurs générées ou réellement appliquées pendant cette exécution.'
        if (-not $Force -and $env:GF_CONFIGURER_API_TEST_MODE -ne '1' -and (Confirm-GFAction 'Chiffrer également secrets.env avec un mot de passe ?')) {
            $password1 = Read-Host 'Mot de passe de chiffrement' -AsSecureString
            $password2 = Read-Host 'Confirmez le mot de passe' -AsSecureString
            $plain1 = ConvertFrom-SecureStringPlain $password1
            $plain2 = ConvertFrom-SecureStringPlain $password2
            try {
                if ($plain1 -ne $plain2 -or $plain1.Length -lt 12) { throw 'Les mots de passe diffèrent ou contiennent moins de 12 caractères.' }
            } finally { $plain1 = $null; $plain2 = $null }
            $encryptedPath = Join-Path $script:RunDirectory 'secrets.env.gfsec'
            Protect-FileWithPassword -InputPath $secretsPath -OutputPath $encryptedPath -Password $password1
            Write-GFStatus OK 'Copie chiffrée créée : secrets.env.gfsec.'
            if (Confirm-GFAction 'Supprimer maintenant la copie en clair secrets.env ?') { Remove-Item -LiteralPath $secretsPath -Force; Write-GFStatus OK 'secrets.env en clair supprimé.' }
        }
    }

    foreach ($target in $EnvironmentExports.Keys) {
        $sourceValues = $EnvironmentExports[$target]
        if ($sourceValues -isnot [System.Collections.IDictionary]) {
            throw "Export Vercel/$target invalide : dictionnaire attendu."
        }
        if ($sourceValues.Count -gt 0) {
            Write-SecureEnvExport -Path (Join-Path $script:RunDirectory ("vercel-$target.env")) -Values $sourceValues -Header "Configuration appliquée à Vercel/$target."
        }
    }

    $missingLines = New-Object System.Collections.ArrayList
    foreach ($key in ($Missing.Keys | Sort-Object)) { [void]$missingLines.Add("$key : $($Missing[$key])") }
    Write-Utf8LinesSafe -Path (Join-Path $script:RunDirectory 'variables-manquantes.txt') -Lines $missingLines

    $readme = @(
        'DOSSIER HAUTEMENT CONFIDENTIEL',
        '',
        'Ce dossier peut contenir des clés API, des tokens et des URLs de base de données.',
        'Ne le partagez pas, ne le placez pas dans Git et ne l-envoyez pas par e-mail.',
        'Les fichiers ont reçu des permissions limitées au compte Windows courant lorsque possible.',
        'Les rapports ne contiennent que des empreintes SHA-256 tronquées.',
        'Dans secrets.env, les suffixes __LOCAL et __VERCEL_ENVIRONNEMENT indiquent la destination exacte.',
        '',
        'Après vérification et sauvegarde chiffrée, supprimez secrets.env si vous ne souhaitez pas conserver les valeurs en clair.'
    )
    Write-Utf8LinesSafe -Path (Join-Path $script:RunDirectory 'README_SECURITE.txt') -Lines $readme

    # Construire les tableaux explicitement. Cela évite le bug du binder PS 5.1
    # lorsque la source est une System.Collections.Generic.List<T> vide.
    $manifestVariables = New-Object System.Collections.ArrayList
    foreach ($entry in $script:ManifestEntries) { [void]$manifestVariables.Add($entry) }

    $validationLines = New-Object System.Collections.ArrayList
    foreach ($reportLine in $script:ReportLines) {
        $textLine = [string]$reportLine
        if ($textLine -match '^\[(OK|ERREUR|ATTENTION)\]') { [void]$validationLines.Add($textLine) }
    }

    $targetEnvironmentList = New-Object System.Collections.ArrayList
    foreach ($targetEnvironment in $script:TargetEnvironments) { [void]$targetEnvironmentList.Add([string]$targetEnvironment) }

    $manifest = [ordered]@{
        dateIso = [DateTimeOffset]::Now.ToString('o')
        scriptVersion = $script:ScriptVersion
        projectPath = $script:ProjectRoot
        vercelProject = if ($script:VercelProject) { $script:VercelProject.Name } else { $null }
        vercelScope = if ($script:VercelProject) { $script:VercelProject.Scope } else { $null }
        environments = $targetEnvironmentList
        variables = $manifestVariables
        validations = $validationLines
        result = $script:RunResult
    }

    $rollbackView = New-Object System.Collections.ArrayList
    foreach ($transactionEntry in $script:Transaction) {
        if ($transactionEntry.Type -eq 'local') {
            $rollbackEntry = [ordered]@{
                type = 'local'
                target = $transactionEntry.Target
                existed = $transactionEntry.Existed
                backup = $transactionEntry.Backup
                oldFingerprint = if ($transactionEntry.Backup) { Get-FileSha256 $transactionEntry.Backup } else { $null }
            }
        } else {
            $rollbackEntry = [ordered]@{
                type = 'vercel'
                name = $transactionEntry.Name
                environment = $transactionEntry.Target
                existed = $transactionEntry.Existed
                oldKnown = $transactionEntry.OldKnown
                oldFingerprint = if ($transactionEntry.OldKnown) { Get-ShortFingerprint ([string]$transactionEntry.OldValue) } else { $null }
            }
        }
        [void]$rollbackView.Add($rollbackEntry)
    }

    # ConvertTo-Json accepte directement ArrayList et OrderedDictionary. Ne pas
    # forcer de cast [object[]] autour d'une collection vide sous PS 5.1.
    $rollbackJson = ConvertTo-Json -InputObject $rollbackView -Depth 6
    [IO.File]::WriteAllText([string](Join-Path $script:RollbackDirectory 'transaction.json'), [string]$rollbackJson, $script:Utf8NoBom)

    $manifestJson = ConvertTo-Json -InputObject $manifest -Depth 8
    [IO.File]::WriteAllText([string](Join-Path $script:RunDirectory 'manifest.json'), [string]$manifestJson, $script:Utf8NoBom)

    $reportOutput = New-Object System.Collections.ArrayList
    foreach ($reportLine in $script:ReportLines) { [void]$reportOutput.Add([string](Protect-LogText ([string]$reportLine))) }
    Write-Utf8LinesSafe -Path (Join-Path $script:RunDirectory 'rapport-validation.txt') -Lines $reportOutput

    foreach ($file in Get-ChildItem -LiteralPath $script:RunDirectory -File -Recurse) { [void](Set-PrivateFileAcl $file.FullName) }
}

function Show-Menu {
    Write-Host ''
    Write-Host '1. Première configuration complète'
    Write-Host '2. Vérifier et réparer la configuration existante (recommandé)'
    Write-Host '3. Générer un nouveau lot de clés candidates'
    Write-Host '4. Faire tourner uniquement GARAGEFLOW_API_KEY'
    Write-Host '5. Faire tourner les secrets de session (protégé — refusé par sécurité, voir docs/ROTATION_SECRETS.md)'
    Write-Host '6. Configurer Neon'
    Write-Host '7. Configurer Upstash'
    Write-Host '8. Configurer Anthropic'
    Write-Host '9. Synchroniser le .env vers Vercel'
    Write-Host '10. Synchroniser Vercel vers un fichier local sécurisé'
    Write-Host '11. Tester la configuration sans rien modifier'
    Write-Host '12. Restaurer une sauvegarde'
    Write-Host '13. Quitter'
    do { $choice = Read-Host 'Choix [2]' ; if ([string]::IsNullOrWhiteSpace($choice)) { $choice = '2' } } while ($choice -notmatch '^(?:[1-9]|1[0-3])$')
    return [int]$choice
}

function Select-TargetEnvironments {
    if ($Environment -and $Environment.Count -gt 0) { return @($Environment | Sort-Object -Unique) }
    $answer = Read-Host 'Environnements Vercel (production,preview,development) [production,preview,development]'
    if ([string]::IsNullOrWhiteSpace($answer)) { return @('production', 'preview', 'development') }
    $items = @($answer.Split(',') | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
    foreach ($item in $items) { if ($item -notin @('production', 'preview', 'development')) { throw "Environnement invalide : $item" } }
    return @($items | Sort-Object -Unique)
}

function Import-ConfigurationValue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Fichier d-import introuvable : $Path" }
    $extension = [IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($Name -eq 'GF_PRIVATE_KEY' -and $extension -eq '.pem') {
        $bytes = [IO.File]::ReadAllBytes($Path)
        return [Convert]::ToBase64String($bytes)
    }
    if ($extension -eq '.json') {
        $json = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($json.PSObject.Properties.Name -contains $Name) { return [string]$json.$Name }
        if ($Name -eq 'GARAGEFLOW_API_KEY' -and $json.PSObject.Properties.Name -contains 'api_key') { return [string]$json.api_key }
        if ($Name -in @('GF_LICENSE_SERVER', 'GF_APP_URL', 'NEXTAUTH_URL') -and $json.PSObject.Properties.Name -contains 'url') { return [string]$json.url }
        throw "$Name est absente du fichier JSON sélectionné."
    }
    $doc = Get-TextFileDocument -Path $Path
    $map = Get-DotEnvMap $doc
    if (-not $map.ContainsKey($Name) -or $map[$Name].Count -eq 0) { throw "$Name est absente du fichier sélectionné." }
    return [string]$map[$Name][0].Value
}

function Collect-ExternalValue {
    param(
        [Parameter(Mandatory = $true)]$Definition,
        [AllowNull()][string]$Existing,
        [switch]$Optional,
        [string]$Target = 'server',
        [string]$EnvironmentLabel = 'local',
        [switch]$ForcePrompt
    )
    $name = [string]$Definition.name
    if (-not $ForcePrompt -and -not [string]::IsNullOrWhiteSpace($Existing)) {
        $test = Test-VariableValue $Definition $Existing $Target
        if ($test.Ok) { Set-ValueOrigin $name $EnvironmentLabel 'conservée'; return $Existing }
    }

    Write-Host ''
    Write-Host "$name doit être fourni depuis une source externe." -ForegroundColor Cyan
    Write-Host '  1. Saisir la valeur de façon masquée'
    Write-Host '  2. Importer la valeur depuis un fichier .env ou .json'
    if ($Optional) { Write-Host '  3. Laisser cette variable désactivée' }
    $allowed = if ($Optional) { '^[123]$' } else { '^[12]$' }
    do { $choice = Read-Host 'Choix [1]'; if ([string]::IsNullOrWhiteSpace($choice)) { $choice = '1' } } while ($choice -notmatch $allowed)
    if ($choice -eq '3') { return $null }
    if ($choice -eq '2') {
        $path = Read-Host 'Chemin complet du fichier sécurisé à importer'
        $value = Import-ConfigurationValue -Path $path -Name $name
        Add-SecretToRegistry $value
        Set-ValueOrigin $name $EnvironmentLabel 'importée'
    } else {
        $value = Read-SecretValue -Prompt "Saisissez $name" -AllowEmpty:$Optional
        if ([string]::IsNullOrWhiteSpace($value) -and $Optional) { return $null }
        Set-ValueOrigin $name $EnvironmentLabel 'saisie'
    }
    $validation = Test-VariableValue $Definition $value $Target
    if (-not $validation.Ok) { throw "$name invalide : $($validation.Problem)" }
    return $value
}

function Get-KeygenStoredApiKey {
    $path = Join-Path $script:ProjectRoot 'keys/server_config.json'
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try {
        $json = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($json.PSObject.Properties.Name -contains 'api_key' -and -not [string]::IsNullOrWhiteSpace([string]$json.api_key)) { return [string]$json.api_key }
    } catch { throw "Le fichier keys/server_config.json est illisible : $($_.Exception.Message)" }
    return $null
}

function Get-SafeRemoteRollbackValue {
    param([Parameter(Mandatory = $true)][string]$Name, [string]$Target = 'production')
    # Seule GARAGEFLOW_API_KEY possède une copie locale contractuellement synchronisée
    # avec le Keygen. Les autres valeurs locales peuvent appartenir au desktop et ne
    # doivent jamais être supposées identiques à Production.
    if ($Name -ne 'GARAGEFLOW_API_KEY' -or $Target -ne 'production') { return $null }
    $envValue = Get-KnownLocalValue -Name $Name
    $keygenValue = Get-KeygenStoredApiKey
    $candidates = @($envValue, $keygenValue) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
    $known = @($candidates | Select-Object -Unique)
    if ($known.Count -gt 1) { throw 'GARAGEFLOW_API_KEY diffère entre .env et keys/server_config.json ; corrigez cette divergence avant toute rotation.' }
    if ($known.Count -eq 1) { return [string]$known[0] }
    return $null
}

function Ensure-RemoteRollbackValue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Target,
        [Parameter(Mandatory = $true)]$Snapshot,
        [Parameter(Mandatory = $true)]$Definition
    )
    if (-not [bool]$Snapshot.Present[$Name] -or $Snapshot.Values.ContainsKey($Name)) { return }
    $old = Get-SafeRemoteRollbackValue -Name $Name -Target $Target
    if ([string]::IsNullOrWhiteSpace($old)) {
        Write-GFStatus ATTENTION "$Name existe dans Vercel/$Target mais sa valeur sensible n-est plus lisible. L-ancienne valeur est obligatoire pour garantir le rollback."
        $old = Read-SecretValue -Prompt "Ancienne valeur ACTUELLE de $Name dans Vercel/$Target"
    }
    $test = Test-VariableValue $Definition $old server
    if (-not $test.Ok) { throw "Ancienne valeur $Name invalide : $($test.Problem)" }
    Add-SecretToRegistry $old
    $Snapshot.Values[$Name] = $old
    Write-GFStatus OK "Sauvegarde logique de $Name/$Target prête — empreinte $(Get-ShortFingerprint $old)."
}

function Get-DefinitionMap {
    $map = @{}
    foreach ($definition in (Get-EnvironmentManifest).variables) { $map[[string]$definition.name] = $definition }
    return $map
}

function Build-ConfigurationPlan {
    param([int]$Mode, [object[]]$Targets, [hashtable]$Snapshots)
    $defs = Get-DefinitionMap
    $local = @{}
    $remote = @{}
    foreach ($target in $Targets) { $remote[$target] = @{} }
    $missing = @{}
    $apiKeyForKeygen = $null
    $serverUrlForKeygen = $null

    if ($Mode -in @(1, 2)) {
        $currentDesktopDb = Get-KnownLocalValue 'DATABASE_URL'
        $local['DATABASE_URL'] = 'file:./dev.db'
        Set-ValueOrigin 'DATABASE_URL' 'local' $(if ($currentDesktopDb -eq 'file:./dev.db') { 'conservée' } else { 'générée' })

        $currentLocalUrl = Get-KnownLocalValue 'NEXTAUTH_URL'
        $local['NEXTAUTH_URL'] = 'http://localhost:3000'
        Set-ValueOrigin 'NEXTAUTH_URL' 'local' $(if ($currentLocalUrl -eq 'http://localhost:3000') { 'conservée' } else { 'générée' })

        $localSecret = Get-KnownLocalValue 'NEXTAUTH_SECRET'
        if (Test-WeakSecret $localSecret) {
            $canInitialize = $AllowDangerousKeyInitialization -or (Read-ConfirmedText 'NEXTAUTH_SECRET locale est absente ou faible. Tapez exactement INSTALLATION NEUVE pour la créer sans migration' 'INSTALLATION NEUVE')
            if ($canInitialize) {
                $localSecret = [string]$script:CandidateSecrets['NEXTAUTH_SECRET']
                $local['NEXTAUTH_SECRET'] = $localSecret
                Set-ValueOrigin 'NEXTAUTH_SECRET' 'local' 'générée'
            } else { $missing['NEXTAUTH_SECRET/local'] = 'initialisation dangereuse non confirmée' }
        } else {
            $local['NEXTAUTH_SECRET'] = $localSecret
            Set-ValueOrigin 'NEXTAUTH_SECRET' 'local' 'conservée'
        }
    }

    if ($Mode -eq 3) {
        return [pscustomobject]@{ Local = @{}; Remote = @{}; Missing = @{}; CandidatesOnly = $true }
    }

    if ($Mode -eq 4) {
        $api = [string]$script:CandidateSecrets['GARAGEFLOW_API_KEY']
        foreach ($target in $Targets) {
            Ensure-RemoteRollbackValue -Name 'GARAGEFLOW_API_KEY' -Target $target -Snapshot $Snapshots[$target] -Definition $defs['GARAGEFLOW_API_KEY']
            $remote[$target]['GARAGEFLOW_API_KEY'] = $api
            Set-ValueOrigin 'GARAGEFLOW_API_KEY' $target 'générée'
        }
        $local['GARAGEFLOW_API_KEY'] = $api
        Set-ValueOrigin 'GARAGEFLOW_API_KEY' 'local' 'générée'
        return [pscustomobject]@{ Local = $local; Remote = $remote; Missing = $missing; ApiKey = $api; ServerUrl = Get-ServerBaseUrl }
    }

    if ($Mode -eq 5) {
        # Refus VOLONTAIRE (fail-closed) : ne jamais faire tourner NEXTAUTH_SECRET à
        # l-aveugle. Les valeurs TOTP/SMTP/signatures dérivées avec le keyId d1
        # deviendraient illisibles sans migration multi-clé prouvée. Voir
        # docs/ROTATION_SECRETS.md (section « secrets à ne jamais faire tourner »).
        throw 'Rotation des secrets de session (NEXTAUTH_SECRET) REFUSÉE par sécurité : aucune migration multi-clé prouvée pour les données TOTP/SMTP/signatures (keyId d1). Procédure sûre décrite dans docs/ROTATION_SECRETS.md.'
    }

    if ($Mode -eq 6) {
        foreach ($target in $Targets) {
            if ($target -ne 'production' -and -not (Confirm-GFAction "Configurer une base PostgreSQL DISTINCTE pour $target ?")) {
                Write-GFStatus IGNORE "Configuration Neon ignorée pour $target."
                continue
            }
            $snap = $Snapshots[$target]
            foreach ($name in @('DATABASE_URL', 'DIRECT_URL')) {
                if ([bool]$snap.Present[$name]) { Ensure-RemoteRollbackValue -Name $name -Target $target -Snapshot $snap -Definition $defs[$name] }
                $existing = if ($snap.Values.ContainsKey($name)) { [string]$snap.Values[$name] } else { $null }
                $remote[$target][$name] = Collect-ExternalValue -Definition $defs[$name] -Existing $existing -Target server -EnvironmentLabel $target -ForcePrompt
            }
        }
        return [pscustomobject]@{ Local = $local; Remote = $remote; Missing = $missing }
    }

    if ($Mode -eq 7) {
        foreach ($target in $Targets) {
            $snap = $Snapshots[$target]
            foreach ($name in @('UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN')) {
                if ([bool]$snap.Present[$name]) { Ensure-RemoteRollbackValue -Name $name -Target $target -Snapshot $snap -Definition $defs[$name] }
                $existing = if ($snap.Values.ContainsKey($name)) { [string]$snap.Values[$name] } else { $null }
                $remote[$target][$name] = Collect-ExternalValue -Definition $defs[$name] -Existing $existing -Target server -EnvironmentLabel $target -ForcePrompt
            }
        }
        return [pscustomobject]@{ Local = $local; Remote = $remote; Missing = $missing }
    }

    if ($Mode -eq 8) {
        foreach ($target in $Targets) {
            $snap = $Snapshots[$target]
            if ([bool]$snap.Present['ANTHROPIC_API_KEY']) { Ensure-RemoteRollbackValue -Name 'ANTHROPIC_API_KEY' -Target $target -Snapshot $snap -Definition $defs['ANTHROPIC_API_KEY'] }
            $existing = if ($snap.Values.ContainsKey('ANTHROPIC_API_KEY')) { [string]$snap.Values['ANTHROPIC_API_KEY'] } else { $null }
            $value = Collect-ExternalValue -Definition $defs['ANTHROPIC_API_KEY'] -Existing $existing -Optional -EnvironmentLabel $target -ForcePrompt
            if ($value) { $remote[$target]['ANTHROPIC_API_KEY'] = $value }
        }
        return [pscustomobject]@{ Local = $local; Remote = $remote; Missing = $missing }
    }

    if ($Mode -eq 9) {
        $localDoc = Get-LocalEnvDocument
        $localMap = Get-DotEnvMap $localDoc
        foreach ($target in $Targets) {
            $snap = $Snapshots[$target]
            foreach ($definition in $defs.Values) {
                $name = [string]$definition.name
                if ($definition.PSObject.Properties.Name -contains 'autoManage' -and -not [bool]$definition.autoManage) { continue }
                if ([string]$definition.scope -in @('desktop', 'desktop-runtime', 'publisher-only', 'development', 'runtime-system', 'build-time', 'build-time-public', 'maintenance-tool', 'server-publisher')) { continue }
                if (-not $localMap.ContainsKey($name) -or $localMap[$name].Count -eq 0) { continue }
                $value = [string]$localMap[$name][0].Value
                if ($name -eq 'DATABASE_URL' -and $value -match '^file:') {
                    Write-GFStatus IGNORE 'DATABASE_URL SQLite locale ne sera jamais envoyée à Vercel.'
                    continue
                }
                if ($name -eq 'NEXTAUTH_URL' -and $target -ne 'development' -and $value -notmatch '^https://') {
                    Write-GFStatus IGNORE "NEXTAUTH_URL locale non HTTPS ignorée pour Vercel/$target."
                    continue
                }
                $test = Test-VariableValue $definition $value server
                if (-not $test.Ok) { Write-GFStatus ATTENTION "$name locale ignorée : $($test.Problem)"; continue }
                $exists = [bool]$snap.Present[$name]
                if ($exists -and $snap.Values.ContainsKey($name) -and [string]$snap.Values[$name] -eq $value) {
                    Write-GFStatus OK "$name/$target déjà synchronisée — empreinte $(Get-ShortFingerprint $value)."
                    continue
                }
                if ($exists -and -not $snap.Values.ContainsKey($name)) {
                    Ensure-RemoteRollbackValue -Name $name -Target $target -Snapshot $snap -Definition $definition
                    if (-not (Confirm-GFAction "$name est sensible et non comparable dans Vercel/$target. La remplacer par la valeur locale ?")) { continue }
                }
                $remote[$target][$name] = $value
                Set-ValueOrigin $name $target 'conservée'
            }
        }
        return [pscustomobject]@{ Local = $local; Remote = $remote; Missing = $missing }
    }

    if ($Mode -in @(1, 2)) {
        $required = @('DATABASE_URL', 'DIRECT_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'DEVICE_TOKEN_PEPPER', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'GARAGEFLOW_API_KEY', 'GF_DB_MAC_SECRET')
        foreach ($target in $Targets) {
            $snap = $Snapshots[$target]
            $configureNonProdDatabase = $true
            if ($target -ne 'production') {
                $configureNonProdDatabase = Confirm-GFAction "Configurer maintenant une base PostgreSQL propre à $target ?"
            }
            foreach ($name in $required) {
                if ($name -in @('DATABASE_URL', 'DIRECT_URL') -and -not $configureNonProdDatabase) {
                    if (-not [bool]$snap.Present[$name]) { $missing["$name/$target"] = 'base non-production laissée volontairement non configurée' }
                    continue
                }
                $definition = $defs[$name]
                $present = [bool]$snap.Present[$name]
                $readable = $snap.Values.ContainsKey($name)
                $existing = if ($readable) { [string]$snap.Values[$name] } else { $null }

                if ($present -and -not $readable) {
                    # Une valeur sensible existante est conservée : aucune rotation aveugle.
                    Write-GFStatus OK "$name existe dans Vercel/$target et sera conservée sans lecture ni réécriture."
                    if ($name -eq 'GARAGEFLOW_API_KEY' -and $target -eq 'production') {
                        $knownApi = Get-SafeRemoteRollbackValue -Name $name
                        if ($knownApi) {
                            $apiKeyForKeygen = $knownApi
                            $serverUrlForKeygen = Get-ServerBaseUrl
                        } else { $missing['GARAGEFLOW_API_KEY/keygen'] = 'clé Vercel sensible non récupérable ; utilisez l-option 4 pour la resynchroniser' }
                    }
                    continue
                }

                if ($present -and $readable) {
                    $validation = Test-VariableValue $definition $existing server
                    if ($validation.Ok) {
                        Write-GFStatus OK "$name/$target valide et conservée — empreinte $(Get-ShortFingerprint $existing)."
                        if ($name -eq 'GARAGEFLOW_API_KEY' -and $target -eq 'production') {
                            $apiKeyForKeygen = $existing
                            $serverUrlForKeygen = Get-ServerBaseUrl
                            $local['GARAGEFLOW_API_KEY'] = $existing
                            Set-ValueOrigin 'GARAGEFLOW_API_KEY' 'local' 'conservée'
                        }
                        continue
                    }
                    Write-GFStatus ATTENTION "$name/$target est présente mais invalide : $($validation.Problem)."
                    Ensure-RemoteRollbackValue -Name $name -Target $target -Snapshot $snap -Definition $definition
                }

                if ([string]$definition.classification -eq 'external') {
                    $remote[$target][$name] = Collect-ExternalValue -Definition $definition -Existing $existing -Target server -EnvironmentLabel $target -ForcePrompt:($present)
                } else {
                    $dangerous = [string]$definition.classification -eq 'dangerous'
                    if ($dangerous) {
                        if ($present) {
                            $missing["$name/$target"] = 'rotation refusée : clé dangereuse existante invalide sans migration prouvée'
                            Write-GFStatus ERREUR "$name/$target ne sera pas remplacée automatiquement : une migration des données dépendantes est requise."
                            continue
                        }
                        if (-not $AllowDangerousKeyInitialization -and -not (Read-ConfirmedText "$name est une clé dangereuse absente. Tapez exactement INSTALLATION NEUVE" 'INSTALLATION NEUVE')) {
                            $missing["$name/$target"] = 'initialisation dangereuse non confirmée'
                            continue
                        }
                    }
                    $remote[$target][$name] = [string]$script:CandidateSecrets[$name]
                    Set-ValueOrigin $name $target 'générée'
                }

                if ($name -eq 'GARAGEFLOW_API_KEY' -and $target -eq 'production') {
                    $apiKeyForKeygen = [string]$remote[$target][$name]
                    $local['GARAGEFLOW_API_KEY'] = $apiKeyForKeygen
                    Set-ValueOrigin 'GARAGEFLOW_API_KEY' 'local' (Get-ValueOrigin $name $target 'générée')
                }
                if ($name -eq 'NEXTAUTH_URL' -and $target -eq 'production') { $serverUrlForKeygen = [string]$remote[$target][$name] }
            }
        }

        # Les clés dédiées sont proposées seulement à la première configuration et
        # uniquement lorsqu-elles sont absentes. Elles ne sont jamais rotées ici.
        if ($Mode -eq 1 -and $Snapshots.ContainsKey('production')) {
            $prod = $Snapshots['production']
            foreach ($name in @('GF_TOTP_ENC_KEY', 'GF_SMTP_CIPHER_KEY', 'GF_SIGNATURE_SECRET', 'GF_BACKUP_KEY', 'GF_PORTAL_SECRET')) {
                if ([bool]$prod.Present[$name]) { continue }
                if (Confirm-GFAction "Configurer la clé dédiée optionnelle $name pour une nouvelle installation ?") {
                    if (-not (Read-ConfirmedText "$name ne doit être créée que si aucune donnée existante n-en dépend. Tapez exactement INSTALLATION NEUVE" 'INSTALLATION NEUVE')) {
                        $missing["$name/production"] = 'confirmation installation neuve non fournie'
                        continue
                    }
                    $remote['production'][$name] = [string]$script:CandidateSecrets[$name]
                    Set-ValueOrigin $name 'production' 'générée'
                }
            }
        }

        if ($Snapshots.ContainsKey('production')) {
            $prod = $Snapshots['production']
            $privatePresent = [bool]$prod.Present['GF_PRIVATE_KEY']
            if (-not $privatePresent) {
                Write-GFStatus ATTENTION 'GF_PRIVATE_KEY est absente de Production. Elle ne sera jamais générée automatiquement.'
                if ($Mode -eq 1 -and (Confirm-GFAction 'Importer une clé privée de licence existante et vérifier sa correspondance avec la clé publique intégrée ?')) {
                    $privateValue = Collect-ExternalValue -Definition $defs['GF_PRIVATE_KEY'] -Existing $null -Target server -EnvironmentLabel production -ForcePrompt
                    if (-not (Test-LicensePrivateKeyMatch -Base64PrivateKey $privateValue)) { throw 'Import de GF_PRIVATE_KEY refusé : paire de clés non conforme.' }
                    $remote['production']['GF_PRIVATE_KEY'] = $privateValue
                    Set-ValueOrigin 'GF_PRIVATE_KEY' 'production' (Get-ValueOrigin 'GF_PRIVATE_KEY' 'production' 'importée')
                } else {
                    $missing['GF_PRIVATE_KEY/production'] = 'clé privée de signature absente ; import manuel contrôlé requis pour activer la génération serveur de licences'
                }
            } elseif ($prod.Values.ContainsKey('GF_PRIVATE_KEY')) {
                $privateValue = [string]$prod.Values['GF_PRIVATE_KEY']
                $basicValidation = Test-VariableValue $defs['GF_PRIVATE_KEY'] $privateValue server
                if (-not $basicValidation.Ok -or -not (Test-LicensePrivateKeyMatch -Base64PrivateKey $privateValue)) {
                    $missing['GF_PRIVATE_KEY/production'] = 'clé présente mais invalide ou différente de la clé publique intégrée ; rotation automatique refusée'
                    Write-GFStatus ERREUR 'GF_PRIVATE_KEY présente mais non conforme. Elle ne sera pas remplacée automatiquement.'
                }
            } else {
                Write-GFStatus OK 'GF_PRIVATE_KEY existe dans Production et sera conservée sans lecture ni rotation.'
            }
        }

        if ($apiKeyForKeygen) {
            if (-not $serverUrlForKeygen) { $serverUrlForKeygen = Get-ServerBaseUrl }
            return [pscustomobject]@{ Local = $local; Remote = $remote; Missing = $missing; ApiKey = $apiKeyForKeygen; ServerUrl = $serverUrlForKeygen }
        }
        return [pscustomobject]@{ Local = $local; Remote = $remote; Missing = $missing }
    }

    return [pscustomobject]@{ Local = $local; Remote = $remote; Missing = $missing }
}

function Show-PlanSummary {
    param($Plan)
    Write-Host ''
    Write-Host 'Résumé des changements prévus' -ForegroundColor Cyan
    foreach ($name in @($Plan.Local.Keys | Sort-Object)) { Write-Host "  LOCAL  $name — empreinte $(Get-ShortFingerprint ([string]$Plan.Local[$name]))" }
    foreach ($target in $Plan.Remote.Keys) {
        foreach ($name in @($Plan.Remote[$target].Keys | Sort-Object)) { Write-Host "  VERCEL/$target  $name — empreinte $(Get-ShortFingerprint ([string]$Plan.Remote[$target][$name]))" }
    }
    if ($Plan.Missing.Count -gt 0) { foreach ($name in $Plan.Missing.Keys) { Write-Host "  MANQUANTE  $name — $($Plan.Missing[$name])" -ForegroundColor Yellow } }
}

function Invoke-ConfigurationPlan {
    param($Plan, [hashtable]$Snapshots)
    $exports = @{}
    foreach ($target in $Plan.Remote.Keys) { $exports[$target] = @{} }
    foreach ($target in $Plan.Remote.Keys) {
        foreach ($name in @($Plan.Remote[$target].Keys | Sort-Object)) {
            $value = [string]$Plan.Remote[$target][$name]
            $isSecret = $name -notin @('NEXTAUTH_URL', 'GF_APP_URL', 'GF_LICENSE_SERVER', 'GF_UPDATE_SERVER', 'GF_UPDATE_CHANNEL')
            Set-VercelVariable -Name $name -Value $value -Target $target -Snapshot $Snapshots[$target] -Sensitive:$isSecret
            $exports[$target][$name] = $value
            $exportName = $name + '__VERCEL_' + $target.ToUpperInvariant()
            $script:AppliedValues[$exportName] = $value
            if ($target -eq 'production') { $script:ProductionVariablesChanged = $true }
        }
    }
    Confirm-VercelAppliedVariables -ExpectedByTarget $exports

    if ($Plan.Local.Count -gt 0) {
        Update-LocalEnv -Values $Plan.Local
        foreach ($key in $Plan.Local.Keys) { if ($key -ne 'DATABASE_URL' -and $key -ne 'NEXTAUTH_URL') { $script:AppliedValues[$key + '__LOCAL'] = [string]$Plan.Local[$key] } }
    }
    if ($Plan.PSObject.Properties.Name -contains 'ApiKey' -and $Plan.ApiKey) {
        Update-KeygenConfiguration -ServerUrl $Plan.ServerUrl -ApiKey $Plan.ApiKey
    } elseif ($Plan.Local.ContainsKey('GARAGEFLOW_API_KEY')) {
        Update-KeygenConfiguration -ServerUrl (Get-ServerBaseUrl) -ApiKey ([string]$Plan.Local['GARAGEFLOW_API_KEY'])
    }
    return $exports
}

function Invoke-VercelProductionDeployment {
    param($Plan)
    if (-not $script:ProductionVariablesChanged) { return $false }
    if ($NoDeploy) {
        Write-GFStatus ATTENTION 'Variables Production mises à jour, mais déploiement volontairement désactivé par -NoDeploy.'
        return $false
    }
    if (-not $Force -and -not (Confirm-GFAction 'Déployer maintenant en Production pour activer et tester les nouvelles variables ?' -DefaultYes)) {
        $apiChanged = $Plan.Remote.ContainsKey('production') -and $Plan.Remote['production'].ContainsKey('GARAGEFLOW_API_KEY')
        if ($apiChanged) { throw 'Déploiement Production obligatoire pour une rotation GARAGEFLOW_API_KEY ; rollback déclenché pour éviter de désynchroniser le Keygen.' }
        Write-GFStatus ATTENTION 'Déploiement Production non autorisé ; validation distante des nouvelles valeurs impossible.'
        return $false
    }
    Push-Location $script:ProjectRoot
    try { $res = Invoke-VercelCommand -Arguments @('--prod', '--yes', '--no-color') -AllowFailure }
    finally { Pop-Location }
    if ($res.ExitCode -ne 0) { throw "Déploiement Vercel Production en échec : $($res.Output)" }
    $script:DeploymentPerformed = $true
    Write-GFStatus OK 'Déploiement Vercel Production terminé.'
    return $true
}

function Restore-VercelDeploymentState {
    if (-not $script:DeploymentPerformed) { return }
    Write-GFStatus ROLLBACK 'Redéploiement Production après restauration des anciennes variables.'
    try {
        Push-Location $script:ProjectRoot
        try { $res = Invoke-VercelCommand -Arguments @('--prod', '--yes', '--no-color') -AllowFailure }
        finally { Pop-Location }
        if ($res.ExitCode -eq 0) { Write-GFStatus ROLLBACK 'Production redéployée avec les variables restaurées.' }
        else { Write-GFStatus ERREUR 'Redéploiement de rollback Vercel en échec.' }
    } catch { Write-GFStatus ERREUR "Redéploiement de rollback impossible : $($_.Exception.Message)" }
}

function Invoke-CheckOnly {
    param([hashtable]$Snapshots)
    $ok = $true
    $defs = Get-DefinitionMap
    $envDoc = Get-LocalEnvDocument
    $dupes = @(Test-DotEnvDuplicates -Document $envDoc)
    if ($dupes.Count -gt 0) { Write-GFStatus ERREUR "Doublons .env : $($dupes -join ', ')"; $ok = $false } else { Write-GFStatus OK 'Aucun doublon dans .env.' }
    $map = Get-DotEnvMap $envDoc
    if ($map.ContainsKey('DATABASE_URL') -and $map['DATABASE_URL'][0].Value -eq 'file:./dev.db') { Write-GFStatus OK 'DATABASE_URL desktop est correctement fixé à file:./dev.db.' }
    else { Write-GFStatus ERREUR 'DATABASE_URL desktop doit être exactement file:./dev.db.'; $ok = $false }
    foreach ($name in @('NEXTAUTH_SECRET')) {
        $value = if ($map.ContainsKey($name)) { [string]$map[$name][0].Value } else { $null }
        $test = Test-VariableValue $defs[$name] $value desktop
        if ($test.Ok) { Write-GFStatus OK "$name local valide — empreinte $(Get-ShortFingerprint $value)" } else { Write-GFStatus ERREUR "$name local invalide : $($test.Problem)"; $ok = $false }
    }
    foreach ($target in $Snapshots.Keys) {
        $snap = $Snapshots[$target]
        $requiredServer = @($defs.Values | Where-Object { [bool]$_.requiredProduction -and [string]$_.scope -notin @('desktop', 'desktop-runtime') } | ForEach-Object { [string]$_.name } | Sort-Object -Unique)
        foreach ($name in $requiredServer) {
            if (-not $snap.Present[$name]) { Write-GFStatus ERREUR "$name absente de Vercel/$target"; $ok = $false }
            elseif ($snap.Values.ContainsKey($name)) {
                $test = Test-VariableValue $defs[$name] ([string]$snap.Values[$name]) server
                if ($test.Ok) { Write-GFStatus OK "$name présente et valide dans Vercel/$target — empreinte $(Get-ShortFingerprint ([string]$snap.Values[$name]))" }
                else { Write-GFStatus ERREUR "$name invalide dans Vercel/$target : $($test.Problem)"; $ok = $false }
            } else { Write-GFStatus OK "$name présente dans Vercel/$target (valeur sensible non lisible par conception)." }
        }
    }
    return $ok
}

function Get-ServerValidationValues {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Target,
        [Parameter(Mandatory = $true)]$Snapshot,
        [hashtable]$Applied
    )
    $defs = Get-DefinitionMap
    $values = @{}
    foreach ($name in $Snapshot.Values.Keys) { $values[$name] = [string]$Snapshot.Values[$name] }
    if ($Applied) { foreach ($name in $Applied.Keys) { $values[$name] = [string]$Applied[$name] } }
    $required = @($defs.Values | Where-Object { [bool]$_.requiredProduction -and [string]$_.scope -notin @('desktop', 'desktop-runtime') } | ForEach-Object { [string]$_.name } | Sort-Object -Unique)
    foreach ($name in $required) {
        if ($values.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace([string]$values[$name])) { continue }
        $presentButHidden = [bool]$Snapshot.Present[$name]
        if ($presentButHidden) {
            Write-GFStatus ATTENTION "$name est présente mais non lisible dans Vercel/$Target. Sa valeur est nécessaire uniquement en mémoire pour les validations locales."
            if (Confirm-GFAction "Fournir $name maintenant pour exécuter les validations complètes ?" -DefaultYes) {
                $values[$name] = Collect-ExternalValue -Definition $defs[$name] -Existing $null -Target server -EnvironmentLabel "validation-$Target"
            }
        }
    }
    $missing = @($required | Where-Object { -not $values.ContainsKey($_) -or [string]::IsNullOrWhiteSpace([string]$values[$_]) })
    return [pscustomobject]@{ Values = $values; Missing = $missing; Complete = ($missing.Count -eq 0) }
}

function Restore-FromBackupPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { throw "Sauvegarde introuvable : $Path" }
    # Garde-fou : la restauration ÉCRASE le .env et keys/server_config.json courants.
    if (-not (Confirm-GFAction "ATTENTION : restaurer depuis « $Path » va ÉCRASER le .env et keys/server_config.json actuels. Continuer ?")) { Write-GFStatus IGNORE 'Restauration annulée par l-utilisateur.'; return }
    $items = if ((Get-Item -LiteralPath $Path).PSIsContainer) { Get-ChildItem -LiteralPath $Path -File } else { @(Get-Item -LiteralPath $Path) }
    foreach ($item in $items) {
        if ($item.Name -match '\.env$|_\.env$') { Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $script:ProjectRoot '.env') -Force; Write-GFStatus ROLLBACK '.env restauré.' }
        elseif ($item.Name -match 'server_config\.json$') {
            $dest = Join-Path $script:ProjectRoot 'keys/server_config.json'
            New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
            Copy-Item -LiteralPath $item.FullName -Destination $dest -Force
            Write-GFStatus ROLLBACK 'server_config.json restauré.'
        }
    }
}

function Invoke-Main {
    $exitCode = 1
    $environmentExports = @{}
    $missing = @{}
    try {
        [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
        Write-Host '================================================================'
        Write-Host 'GarageFlow - Configuration automatisée des API et variables'
        Write-Host '================================================================'
        Write-GFStep 0 10 'Initialisation'
        $script:ProjectRoot = Find-ProjectRoot
        [void](Initialize-RunDirectory)
        $script:CandidateSecrets = New-CandidateSecretSet
        if ($VercelToken) {
            $script:VercelTokenPlain = ConvertFrom-SecureStringPlain $VercelToken
            Add-SecretToRegistry $script:VercelTokenPlain
        } elseif (-not [string]::IsNullOrWhiteSpace($env:VERCEL_TOKEN)) {
            $script:VercelTokenPlain = [string]$env:VERCEL_TOKEN
            Add-SecretToRegistry $script:VercelTokenPlain
            Write-GFStatus INFO 'Token Vercel détecté dans l-environnement du processus ; il ne sera pas enregistré dans le dépôt.'
        }
        Write-GFStatus OK "Projet détecté : $script:ProjectRoot"
        Write-GFStatus OK "Dossier sécurisé : $script:RunDirectory"

        $mode = $null
        if ($CheckOnly) { $mode = 11 }
        elseif ($Repair) { $mode = 2 }
        elseif ($RotateApiKey -or $AutoRotateApiKey) { $mode = 4 }
        elseif ($BackupOnly) { $mode = 14 }
        elseif ($Restore) { $mode = 12 }
        else { $mode = Show-Menu }

        if ($mode -eq 13) {
            $script:RunResult = 'ANNULE'
            $exitCode = 0
            return $exitCode
        }

        Write-GFStep 1 10 'Vérification des prérequis'
        $requiresNodeToolchain = $mode -in @(1, 2, 4, 6, 7, 8, 9, 10, 11)
        if ($requiresNodeToolchain) {
            foreach ($tool in @('node', 'npm', 'npx')) {
                $cmd = Get-Command $tool -ErrorAction SilentlyContinue
                if ($cmd) { Write-GFStatus OK "$tool disponible." } else { throw "$tool est introuvable." }
            }
        } else {
            Write-GFStatus IGNORE 'Ce mode ne nécessite pas Node.js, npm ni Vercel.'
        }
        $writesConfiguration = $mode -in @(1, 2, 4, 6, 7, 8, 9)
        if ($writesConfiguration) {
            Ensure-GitIgnoreProtection $script:ProjectRoot
        } else {
            Write-GFStatus INFO 'Mode sans écriture de configuration : .gitignore sera uniquement contrôlé si nécessaire.'
        }
        if ($mode -in @(1, 2, 3, 4, 6, 7, 8, 9, 10, 11)) {
            if (-not (Test-GitIgnoredPath $script:ProjectRoot '.env')) { throw '.env n-est pas correctement ignoré par Git.' }
            if (-not (Test-GitIgnoredPath $script:ProjectRoot 'keys/server_config.json')) { throw 'keys/server_config.json n-est pas correctement ignoré par Git.' }
        }

        Write-GFStep 2 10 'Connexion Vercel'
        if ($mode -eq 12) {
            $restorePath = $Restore
            if ([string]::IsNullOrWhiteSpace($restorePath)) { $restorePath = Read-Host 'Chemin de la sauvegarde à restaurer' }
            Restore-FromBackupPath $restorePath
            $script:RunResult = 'RESTAURE'
            $exitCode = 0
            return $exitCode
        }
        if ($mode -eq 14) {
            [void](Backup-GFFile (Join-Path $script:ProjectRoot '.env') '.env')
            [void](Backup-GFFile (Join-Path $script:ProjectRoot 'keys/server_config.json') 'server_config.json')
            $script:RunResult = 'SAUVEGARDE_SEULEMENT'
            Write-GFStatus OK 'Sauvegarde locale créée sans modification.'
            $exitCode = 0
            return $exitCode
        }

        $needsVercel = $mode -notin @(3, 14)
        $targets = @()
        $snapshots = @{}
        if ($needsVercel) {
            $script:Vercel = Resolve-VercelCommand
            Write-GFStatus OK $script:Vercel.Description
            Ensure-VercelConnection
            Ensure-VercelLink
            $targets = Select-TargetEnvironments
            $script:TargetEnvironments = @($targets)
        } else { Write-GFStatus IGNORE 'Mode candidates : aucune connexion Vercel nécessaire.' }

        Write-GFStep 3 10 'Analyse du projet'
        $manifest = Get-EnvironmentManifest
        $detected = @(Get-CodeEnvironmentVariables -Root $script:ProjectRoot)
        $managed = @($manifest.variables | ForEach-Object { [string]$_.name })
        Write-GFStatus OK "$($detected.Count) variables d-environnement détectées dans le code ; $($managed.Count) classifiées par le manifeste."
        $unmanaged = @($detected | Where-Object { $_ -notin $managed -and $_ -notin @('NODE_ENV','VERCEL','CI','ELECTRON','ELECTRON_DEV','APPDATA','HOSTNAME','NEXT_RUNTIME','NODE_INSPECTOR_IPC','TEST_POSTGRES_URL','TEST_REDIS_URL','GF_E2E_CHROMIUM') })
        if ($unmanaged.Count -gt 0) { Write-GFStatus ATTENTION "Variables détectées mais non gérées automatiquement : $($unmanaged -join ', ')" }

        Write-GFStep 4 10 'Collecte des informations'
        foreach ($target in $targets) { $snapshots[$target] = Get-VercelEnvironmentSnapshot $target; Write-GFStatus OK "Variables Vercel/$target inventoriées sans affichage des secrets." }

        if ($mode -eq 10) {
            foreach ($target in $targets) {
                $environmentExports[$target] = @{}
                foreach ($name in $snapshots[$target].Values.Keys) {
                    $environmentExports[$target][$name] = [string]$snapshots[$target].Values[$name]
                    [void]$script:ManifestEntries.Add([pscustomobject]@{ name=$name; environment=$target; origin='importée'; fingerprint=Get-ShortFingerprint ([string]$snapshots[$target].Values[$name]); status='exportée localement'; verification='lecture Vercel' })
                }
                foreach ($name in $snapshots[$target].Present.Keys) {
                    if ($snapshots[$target].Present[$name] -and -not $snapshots[$target].Values.ContainsKey($name)) { $missing["$name/$target"] = 'variable sensible présente mais non exportable en clair par Vercel' }
                }
            }
            $script:RunResult = 'VERCEL_EXPORTE_VERS_DOSSIER_SECURISE'
            Write-GFStatus OK 'Les valeurs Vercel lisibles seront enregistrées uniquement dans le dossier sécurisé, jamais dans .env desktop.'
            $exitCode = 0
            return $exitCode
        }
        if ($mode -eq 11) {
            $configurationOk = Invoke-CheckOnly -Snapshots $snapshots
            if (-not $configurationOk) { throw 'La vérification de configuration a détecté des erreurs.' }
            $validationTarget = if ($snapshots.ContainsKey('production')) { 'production' } else { [string]@($snapshots.Keys)[0] }
            $validationInput = Get-ServerValidationValues -Target $validationTarget -Snapshot $snapshots[$validationTarget] -Applied @{}
            if (-not $validationInput.Complete) { throw "Validations complètes impossibles ; valeurs non disponibles : $($validationInput.Missing -join ', ')" }
            Ensure-ProjectDependencies
            $technicalOk = Invoke-TechnicalValidations -ServerValues $validationInput.Values
            if (-not $technicalOk) { throw 'Une ou plusieurs validations techniques ont échoué.' }
            $script:RunResult = 'VERIFICATION_SEULEMENT_REUSSIE'
            $exitCode = 0
            return $exitCode
        }

        Write-GFStep 5 10 'Génération des secrets'
        Write-GFStatus OK 'Un nouveau lot cryptographique de clés candidates a été créé en mémoire.'
        $plan = Build-ConfigurationPlan -Mode $mode -Targets $targets -Snapshots $snapshots
        if (($plan.PSObject.Properties.Name -contains 'CandidatesOnly') -and $plan.CandidatesOnly) {
            foreach ($key in $script:CandidateSecrets.Keys) { $script:AppliedValues[$key] = [string]$script:CandidateSecrets[$key]; [void]$script:ManifestEntries.Add([pscustomobject]@{ name=$key; environment='candidate'; origin='générée'; fingerprint=Get-ShortFingerprint ([string]$script:CandidateSecrets[$key]); status='non appliquée'; verification='génération cryptographique' }) }
            $script:RunResult = 'CANDIDATS_GENERES_NON_APPLIQUES'
            $exitCode = 0
            return $exitCode
        }
        $missing = $plan.Missing
        if ($NoDeploy -and $plan.Remote.ContainsKey('production') -and $plan.Remote['production'].ContainsKey('GARAGEFLOW_API_KEY')) {
            throw '-NoDeploy est incompatible avec une rotation de GARAGEFLOW_API_KEY en Production : le Keygen serait désynchronisé du déploiement actif.'
        }
        Show-PlanSummary $plan
        if (-not (Confirm-GFAction 'Appliquer exactement ces changements ?')) { throw 'Modifications annulées par l-utilisateur.' }

        Write-GFStep 6 10 'Sauvegarde'
        Write-GFStatus OK 'Les fichiers locaux seront sauvegardés avant leur première modification.'

        Write-GFStep 7 10 'Synchronisation'
        $environmentExports = Invoke-ConfigurationPlan -Plan $plan -Snapshots $snapshots

        Write-GFStep 8 10 'Validation'
        if (-not $AutoRotateApiKey) {
            $validationTarget = if ($snapshots.ContainsKey('production')) { 'production' } else { [string]@($snapshots.Keys)[0] }
            $appliedForValidation = if ($environmentExports.ContainsKey($validationTarget)) { [hashtable]$environmentExports[$validationTarget] } else { @{} }
            $validationInput = Get-ServerValidationValues -Target $validationTarget -Snapshot $snapshots[$validationTarget] -Applied $appliedForValidation
            if (-not $validationInput.Complete) { throw "Validations complètes impossibles ; valeurs non disponibles : $($validationInput.Missing -join ', ')" }
            $serverValues = $validationInput.Values
            Ensure-ProjectDependencies
            $technicalOk = Invoke-TechnicalValidations -ServerValues $serverValues -AllowMigration
            if (-not $technicalOk) { throw 'Une ou plusieurs validations techniques obligatoires ont échoué.' }
        } else {
            Write-GFStatus OK 'Mode automatique : cohérence Vercel, .env et Keygen vérifiée sans build ni migration.'
        }

        $deployed = Invoke-VercelProductionDeployment -Plan $plan
        if ($plan.PSObject.Properties.Name -contains 'ServerUrl' -and $plan.ServerUrl) {
            if ($script:ProductionVariablesChanged -and -not $deployed) {
                Write-GFStatus ATTENTION 'Tests distants ignorés : les nouvelles variables Production ne sont pas encore actives dans un déploiement.'
            } else {
                if (-not (Test-HealthEndpoint $plan.ServerUrl)) { throw 'La route /api/health n-est pas saine.' }
                if ($plan.ApiKey -and -not (Test-ApiKeyEndpoint $plan.ServerUrl $plan.ApiKey)) { throw 'La nouvelle GARAGEFLOW_API_KEY n-a pas été validée à distance.' }
            }
        }

        Write-GFStep 9 10 'Création du dossier sécurisé'
        if ($script:ProductionVariablesChanged -and -not $deployed) {
            $script:RunResult = 'CONFIGURATION_ECRITE_DEPLOIEMENT_REQUIS'
        } elseif ($missing.Count -eq 0) { $script:RunResult = 'SUCCES' }
        else { $script:RunResult = 'SUCCES_PARTIEL_VARIABLES_OPTIONNELLES_MANQUANTES' }
        $exitCode = 0
        if ($script:RunResult -eq 'CONFIGURATION_ECRITE_DEPLOIEMENT_REQUIS') { Write-GFStatus ATTENTION 'Configuration écrite, mais un nouveau déploiement Production reste requis.' }
        else { Write-GFStatus OK 'Configuration et validations terminées.' }
    } catch {
        $script:RunResult = 'ECHEC'
        Write-GFStatus ERREUR $_.Exception.Message
        if ($script:Transaction.Count -gt 0) {
            Write-GFStatus ROLLBACK 'Début du rollback transactionnel.'
            Restore-LocalTransactions
            Restore-VercelTransactions
            Restore-VercelDeploymentState
        }
        $exitCode = 1
    } finally {
        if ($script:RunDirectory) {
            Write-GFStep 10 10 'Résultat final'
            Write-GFStatus INFO "Résultat : $script:RunResult"
            Write-GFStatus INFO "Rapport : $script:RunDirectory"
            try {
                Write-RunArtifacts -Missing $missing -EnvironmentExports $environmentExports
            } catch {
                Write-GFStatus ERREUR "Création des rapports incomplète : $($_.Exception.Message)"
                # Dernier filet de sécurité : produire au minimum le rapport texte,
                # même si le manifeste ou les ACL ont échoué.
                try {
                    $fallback = [string[]]@($script:ReportLines | ForEach-Object { [string](Protect-LogText $_) })
                    Write-Utf8LinesSafe -Path (Join-Path $script:RunDirectory 'rapport-validation.txt') -Lines $fallback
                } catch {
                    Write-Host "[ERREUR] Impossible de créer même le rapport minimal : $(Protect-LogText $_.Exception.Message)" -ForegroundColor Red
                }
            }
        }
        $script:VercelTokenPlain = $null
    }
    return $exitCode
}

if ($env:GF_CONFIGURER_API_TEST_MODE -ne '1') {
    $code = Invoke-Main
    exit $code
}
