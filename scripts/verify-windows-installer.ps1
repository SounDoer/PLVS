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

function Assert-NoUnexpectedExe([string]$Directory, [string[]]$AllowedNames, [string]$Context) {
  $unexpected = Get-ChildItem -LiteralPath $Directory -File -Filter "*.exe" |
    Where-Object { $AllowedNames -notcontains $_.Name }
  if ($unexpected) {
    $names = $unexpected | Select-Object -ExpandProperty Name
    throw "$Context contains unexpected executable(s): $($names -join ', ')"
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageVersion = (Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json).version
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

Assert-NoUnexpectedExe $releaseDir @("plvs.exe", "plvs-cli.exe", "ffmpeg.exe", "ffprobe.exe") "Release directory"

$installRoot = Join-Path $env:TEMP ("plvs-installer-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $installRoot | Out-Null
$originalUserPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
$nsisInstallDirSubKey = "Software\soundoer\PLVS"
$originalNsisInstallDir = Get-RegistryDefaultValue $nsisInstallDirSubKey
$originalNsisInstallerLanguage = Get-RegistryNamedValue $nsisInstallDirSubKey "Installer Language"
$agentDiscoverySubKey = "Software\SounDoer\PLVS"
$agentDiscoveryValueNames = @("ProductName", "Identifier", "Version", "InstallDir", "CliPath")
$originalAgentDiscoveryValues = @{}
foreach ($name in $agentDiscoveryValueNames) {
  $originalAgentDiscoveryValues[$name] = Get-RegistryNamedValue $agentDiscoverySubKey $name
}
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

  Assert-NoUnexpectedExe $installRoot @("plvs.exe", "plvs-cli.exe", "ffmpeg.exe", "ffprobe.exe", "uninstall.exe") "Install directory"

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

  $discovery = Get-ItemProperty "HKCU:\$agentDiscoverySubKey" -ErrorAction SilentlyContinue
  if (-not $discovery) {
    throw "Missing PLVS agent discovery registry key: HKCU:\$agentDiscoverySubKey"
  }
  if ($discovery.ProductName -ne "PLVS") {
    throw "Unexpected PLVS discovery ProductName: $($discovery.ProductName)"
  }
  if ($discovery.Identifier -ne "com.soundoer.plvs") {
    throw "Unexpected PLVS discovery Identifier: $($discovery.Identifier)"
  }
  if ($discovery.Version -ne $packageVersion) {
    throw "Unexpected PLVS discovery Version: $($discovery.Version)"
  }
  if ($discovery.InstallDir -ne $installRoot) {
    throw "Unexpected PLVS discovery InstallDir: $($discovery.InstallDir)"
  }
  if ($discovery.CliPath -ne $installedCli) {
    throw "Unexpected PLVS discovery CliPath: $($discovery.CliPath)"
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

  $discoveryAfterUninstall = Get-ItemProperty "HKCU:\$agentDiscoverySubKey" -ErrorAction SilentlyContinue
  if ($discoveryAfterUninstall -and $discoveryAfterUninstall.InstallDir -eq $installRoot) {
    throw "Uninstaller did not remove PLVS agent discovery registry key: HKCU:\$agentDiscoverySubKey"
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
  foreach ($name in $agentDiscoveryValueNames) {
    Set-RegistryNamedValue $agentDiscoverySubKey $name $originalAgentDiscoveryValues[$name]
  }
  $agentKey = Get-Item "HKCU:\$agentDiscoverySubKey" -ErrorAction SilentlyContinue
  if ($agentKey) {
    $remainingValues = $agentKey.GetValueNames() | Where-Object { $agentDiscoveryValueNames -notcontains $_ }
    if (($remainingValues.Count -eq 0) -and ($originalAgentDiscoveryValues.Values | Where-Object { $null -ne $_ }).Count -eq 0) {
      Remove-Item -LiteralPath "HKCU:\$agentDiscoverySubKey" -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

Write-Host "Windows installer smoke check passed: $($installer.FullName)"
