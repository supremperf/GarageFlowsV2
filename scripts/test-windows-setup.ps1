# Real per-user install test, ONLY on a disposable GitHub-hosted Windows runner.
# Never shipped to customers; no production licence or security bypass.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:GF_WINDOWS_SMOKE_ISOLATED -ne '1') {
  throw 'Refused: an explicitly approved disposable Windows CI runner is required.'
}
$Root = Split-Path -Parent $PSScriptRoot
$Setup = Join-Path $Root 'release/GarageFlows-Setup.exe'
$LegacyDataName = & node -p "require('./electron/user-data-path').LEGACY_DATA_DIR_NAME"
if ($LASTEXITCODE -ne 0 -or -not $LegacyDataName) { throw 'Historical data path could not be determined' }
$UserData = Join-Path ([Environment]::GetFolderPath('ApplicationData')) $LegacyDataName
if (Test-Path $UserData) { throw 'Refused: userData already exists; no existing profile may be modified by this test.' }
$InstallDir = Join-Path $env:RUNNER_TEMP ('GarageFlows installed ' + [guid]::NewGuid().ToString('N'))
$EmptyCwd = Join-Path $env:RUNNER_TEMP ('gf-empty-cwd-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $EmptyCwd | Out-Null
$Exe = Join-Path $InstallDir 'GarageFlows.exe'
$ReportDir = Join-Path $Root 'artifacts/windows-delivery'
New-Item -ItemType Directory -Force $ReportDir | Out-Null
$Result = [ordered]@{ success = $false; stage = 'install'; installExecuted = $false; activationWindowOpened = $false; restrictedPathLaunch = $false; sqliteSentinelWritten = $false; installedServerComponentsPassed = $false; reinstallPreservedData = $false; uninstallPreservedData = $false; licensedBusinessWorkflowTested = $false; cleanOSWithoutBuildToolsTested = $false }
function Install-Setup {
  $p = Start-Process -FilePath $Setup -ArgumentList @('/S', "/D=$InstallDir") -PassThru
  $null = $p.Handle # Cache the OS handle before the process exits (ExitCode stays observable).
  if (-not $p.WaitForExit(120000)) { throw 'Installer timeout' }
  if ($p.ExitCode -ne 0 -or -not (Test-Path $Exe)) { throw 'Installer failed' }
}
function Open-And-CloseInstalled {
  $previous = $env:PATH
  try {
    # Prove the actual installed application starts with no Node/npm/Python on PATH,
    # from an empty CWD. Electron must use its own packaged runtime/resources.
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
    $p = Start-Process -FilePath $Exe -WorkingDirectory $EmptyCwd -PassThru
  } finally { $env:PATH = $previous }
  $deadline = [DateTime]::UtcNow.AddSeconds(75)
  $activation = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    $activation = Get-Process -Name 'GarageFlows' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe -and $_.MainWindowTitle -match 'Activation' } | Select-Object -First 1
    if ($activation) { break }
    if ($p.HasExited) { throw 'Installed application exited before activation window' }
    Start-Sleep -Milliseconds 250
  }
  if (-not $activation) { throw 'Activation window did not appear (integrity/bootstrap/resource failure possible)' }
  $Result.activationWindowOpened = $true
  $Result.restrictedPathLaunch = $true
  if (-not $activation.CloseMainWindow()) { throw 'Activation window could not be closed normally' }
  if (-not $p.WaitForExit(20000)) { throw 'Installed application did not exit cleanly' }
  # No utility/server process is allowed to remain after normal shutdown.
  Start-Sleep -Milliseconds 500
  $remaining = @(Get-Process -Name 'GarageFlows' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe })
  if ($remaining.Count -ne 0) { throw 'Application child process remained after shutdown' }
}
try {
  $Result['authenticodeStatus'] = [string](Get-AuthenticodeSignature $Setup).Status
  Install-Setup
  $Result.installExecuted = $true
  $Result.stage = 'first-launch'
  Open-And-CloseInstalled
  $DB = Join-Path $UserData 'garageflow.db'
  if (-not (Test-Path $DB)) { throw 'Persistent SQLite was not initialized from installed resources' }
  $Result.stage = 'sqlite-sentinel'
  $env:GF_SETUP_SMOKE_DB = $DB
  # Node here is a CI inspection tool, NOT a dependency of the installed child.
  & node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.env.GF_SETUP_SMOKE_DB);if(d.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")throw Error("integrity");d.exec("CREATE TABLE __gf_setup_smoke(value TEXT NOT NULL); INSERT INTO __gf_setup_smoke VALUES(''preserve-on-update'')");d.close()'
  if ($LASTEXITCODE -ne 0) { throw 'SQLite sentinel creation failed' }
  $Result.sqliteSentinelWritten = $true
  $Result.stage = 'installed-standalone-components'
  & node (Join-Path $PSScriptRoot 'test-installed-server.cjs') $InstallDir $DB
  if ($LASTEXITCODE -ne 0) { throw 'Installed standalone component tests failed' }
  $Result.installedServerComponentsPassed = $true
  $before = (Get-FileHash $DB -Algorithm SHA256).Hash
  $secretFiles = @(Get-ChildItem $UserData -Filter '*.key' | ForEach-Object { @{ name = $_.Name; hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash } })
  Open-And-CloseInstalled
  if ((Get-FileHash $DB -Algorithm SHA256).Hash -ne $before) { throw 'Unlicensed restart changed database unexpectedly' }
  $Result.stage = 'reinstall'
  Install-Setup
  Open-And-CloseInstalled
  if ((Get-FileHash $DB -Algorithm SHA256).Hash -ne $before) { throw 'Reinstall overwrote persistent data' }
  foreach ($item in $secretFiles) {
    if ((Get-FileHash (Join-Path $UserData $item.name) -Algorithm SHA256).Hash -ne $item.hash) { throw 'Reinstall changed an installation secret' }
  }
  $Result.reinstallPreservedData = $true
  $Result.stage = 'uninstall'
  $uninstaller = @(Get-ChildItem $InstallDir -Filter 'Uninstall*.exe')
  if ($uninstaller.Count -ne 1) { throw 'Expected exactly one installed uninstaller' }
  $uninstall = Start-Process $uninstaller[0].FullName -ArgumentList '/S' -PassThru
  if (-not $uninstall.WaitForExit(60000)) { throw 'Uninstaller timeout' }
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ((Test-Path $Exe) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (Test-Path $Exe) { throw 'Installed application executable remains after uninstall' }
  if (-not (Test-Path $DB) -or (Get-FileHash $DB -Algorithm SHA256).Hash -ne $before) { throw 'Uninstall deleted or altered user data' }
  & node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.env.GF_SETUP_SMOKE_DB,{readOnly:true});if(d.prepare("SELECT value FROM __gf_setup_smoke").get().value!=="preserve-on-update")throw Error("sentinel");d.close()'
  if ($LASTEXITCODE -ne 0) { throw 'Persisted SQLite sentinel could not be read' }
  $Result.uninstallPreservedData = $true
  $Result.stage = 'complete'
  $Result.success = $true
} finally {
  # Never publish the userData folder, secrets, licence tokens, log contents or paths.
  $json = $Result | ConvertTo-Json -Compress
  Set-Content -Encoding utf8 (Join-Path $ReportDir 'windows-install-smoke.json') $json
  Write-Output "::notice title=Windows installed Setup smoke::$json"
}
