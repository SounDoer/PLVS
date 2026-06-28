$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseDir = Join-Path $repoRoot "src-tauri\target\release"
$installer = Get-ChildItem (Join-Path $releaseDir "bundle\nsis") -Filter "*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "NSIS installer not found"
}

$appBinary = Join-Path $releaseDir "plvs.exe"
if (-not (Test-Path $appBinary)) {
  throw "Missing app binary: $appBinary"
}

$diagnosticBinary = Join-Path $releaseDir "vad_compare.exe"
if (Test-Path $diagnosticBinary) {
  throw "Diagnostic binary should not be produced by the app bundle build: $diagnosticBinary"
}

$installRoot = Join-Path $env:TEMP ("plvs-installer-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $installRoot | Out-Null

try {
  $proc = Start-Process -FilePath $installer.FullName -ArgumentList @("/S", "/D=$installRoot") -Wait -PassThru -WindowStyle Hidden
  if ($proc.ExitCode -ne 0) {
    throw "Installer exited with code $($proc.ExitCode)"
  }

  $installedApp = Join-Path $installRoot "plvs.exe"
  if (-not (Test-Path $installedApp)) {
    $files = Get-ChildItem $installRoot -File -Recurse | Select-Object -ExpandProperty FullName
    throw "Installed app binary missing: $installedApp`nInstalled files:`n$($files -join "`n")"
  }

  $installedDiagnostic = Join-Path $installRoot "vad_compare.exe"
  if (Test-Path $installedDiagnostic) {
    throw "Installer included diagnostic binary: $installedDiagnostic"
  }
} finally {
  $uninstaller = Join-Path $installRoot "uninstall.exe"
  if (Test-Path $uninstaller) {
    Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -WindowStyle Hidden
  }
  Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Windows installer smoke check passed: $($installer.FullName)"
