$ErrorActionPreference = "Stop"

function Normalize-PathEntry([string]$PathEntry) {
  if (-not $PathEntry) {
    return ""
  }
  return $PathEntry.Trim().TrimEnd('\')
}

function Test-PathContainsEntry([string]$PathValue, [string]$Entry) {
  $needle = Normalize-PathEntry $Entry
  foreach ($part in ($PathValue -split ';')) {
    if ((Normalize-PathEntry $part) -ieq $needle) {
      return $true
    }
  }
  return $false
}

function Get-RegistryDefaultValue([string]$SubKey) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKey)
  if (-not $key) {
    return $null
  }
  try {
    return $key.GetValue("", $null)
  } finally {
    $key.Close()
  }
}

function Get-RegistryNamedValue([string]$SubKey, [string]$Name) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKey)
  if (-not $key) {
    return $null
  }
  try {
    return $key.GetValue($Name, $null)
  } finally {
    $key.Close()
  }
}

function Set-RegistryDefaultValue([string]$SubKey, $Value) {
  if ($null -eq $Value) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKey, $true)
    if ($key) {
      try {
        $key.DeleteValue("", $false)
      } finally {
        $key.Close()
      }
    }
    return
  }

  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($SubKey)
  try {
    $key.SetValue("", $Value, [Microsoft.Win32.RegistryValueKind]::String)
  } finally {
    $key.Close()
  }
}

function Set-RegistryNamedValue([string]$SubKey, [string]$Name, $Value) {
  if ($null -eq $Value) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKey, $true)
    if ($key) {
      try {
        $key.DeleteValue($Name, $false)
      } finally {
        $key.Close()
      }
    }
    return
  }

  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($SubKey)
  try {
    $key.SetValue($Name, $Value)
  } finally {
    $key.Close()
  }
}

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
$originalUserPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
$nsisInstallDirSubKey = "Software\soundoer\PLVS"
$originalNsisInstallDir = Get-RegistryDefaultValue $nsisInstallDirSubKey
$originalNsisInstallerLanguage = Get-RegistryNamedValue $nsisInstallDirSubKey "Installer Language"
$uninstalled = $false

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

  $userPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
  if (Test-PathContainsEntry $userPath $installRoot) {
    throw "Installer should not add installed directory to the user PATH: $installRoot"
  }

  $uninstaller = Join-Path $installRoot "uninstall.exe"
  if (Test-Path $uninstaller) {
    Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -WindowStyle Hidden
    $uninstalled = $true
  }

  $userPathAfterUninstall = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
  if (Test-PathContainsEntry $userPathAfterUninstall $installRoot) {
    throw "Uninstaller did not remove installed directory from user PATH: $installRoot"
  }
} finally {
  $uninstaller = Join-Path $installRoot "uninstall.exe"
  if ((-not $uninstalled) -and (Test-Path $uninstaller)) {
    Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -WindowStyle Hidden
  }
  foreach ($registryKey in @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PLVS",
    "HKCU:\Software\soundoer\PLVS"
  )) {
    if (Test-Path $registryKey) {
      $entry = Get-ItemProperty $registryKey -ErrorAction SilentlyContinue
      $defaultValue = (Get-Item -LiteralPath $registryKey).GetValue("", $null)
      $location = ($entry.InstallLocation -as [string]).Trim('"')
      if (
        $location -eq $installRoot -or
        $location -like "*plvs-installer-smoke-*" -or
        $defaultValue -eq $installRoot -or
        $defaultValue -like "*plvs-installer-smoke-*"
      ) {
        Remove-Item -LiteralPath $registryKey -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }
  Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
  [Environment]::SetEnvironmentVariable("Path", $originalUserPath, [EnvironmentVariableTarget]::User)
  Set-RegistryDefaultValue $nsisInstallDirSubKey $originalNsisInstallDir
  Set-RegistryNamedValue $nsisInstallDirSubKey "Installer Language" $originalNsisInstallerLanguage
}

Write-Host "Windows installer smoke check passed: $($installer.FullName)"
