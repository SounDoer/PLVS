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

$cliBinary = Join-Path $releaseDir "plvs-cli.exe"
if (-not (Test-Path $cliBinary)) {
  throw "Missing CLI binary: $cliBinary"
}

foreach ($sidecar in @("ffmpeg.exe", "ffprobe.exe")) {
  $sidecarPath = Join-Path $releaseDir $sidecar
  if (-not (Test-Path $sidecarPath)) {
    throw "Missing portable sidecar: $sidecarPath"
  }
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

  $installedCli = Join-Path $installRoot "plvs-cli.exe"
  if (-not (Test-Path $installedCli)) {
    $files = Get-ChildItem $installRoot -File -Recurse | Select-Object -ExpandProperty FullName
    throw "Installed CLI binary missing: $installedCli`nInstalled files:`n$($files -join "`n")"
  }

  foreach ($sidecar in @("ffmpeg.exe", "ffprobe.exe")) {
    $installedSidecar = Join-Path $installRoot $sidecar
    if (-not (Test-Path $installedSidecar)) {
      $files = Get-ChildItem $installRoot -File -Recurse | Select-Object -ExpandProperty FullName
      throw "Installed sidecar missing: $installedSidecar`nInstalled files:`n$($files -join "`n")"
    }
  }

  $installedDiagnostic = Join-Path $installRoot "vad_compare.exe"
  if (Test-Path $installedDiagnostic) {
    throw "Installer included diagnostic binary: $installedDiagnostic"
  }

  $doctorOutput = & $installedCli doctor --json
  if ($LASTEXITCODE -ne 0) {
    throw "Installed CLI doctor failed with exit code $LASTEXITCODE`n$doctorOutput"
  }
  $doctor = $doctorOutput | ConvertFrom-Json
  if ($doctor.schemaVersion -ne 1) {
    throw "Installed CLI doctor returned unexpected schema version: $($doctor.schemaVersion)"
  }
} finally {
  $uninstaller = Join-Path $installRoot "uninstall.exe"
  if (Test-Path $uninstaller) {
    Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -WindowStyle Hidden
  }
  foreach ($registryKey in @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PLVS",
    "HKCU:\Software\soundoer\PLVS"
  )) {
    if (Test-Path $registryKey) {
      $entry = Get-ItemProperty $registryKey -ErrorAction SilentlyContinue
      $location = ($entry.InstallLocation -as [string]).Trim('"')
      if ($location -eq $installRoot -or $location -like "*plvs-installer-smoke-*") {
        Remove-Item -LiteralPath $registryKey -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }
  Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Windows installer smoke check passed: $($installer.FullName)"
