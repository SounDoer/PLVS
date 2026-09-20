param(
  [Parameter(Mandatory = $true)]
  [string]$ZipPath
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedZip = (Resolve-Path -LiteralPath $ZipPath).Path
$extractRoot = Join-Path $env:TEMP ("plvs-portable-smoke-" + [guid]::NewGuid().ToString("N"))

try {
  New-Item -ItemType Directory -Path $extractRoot | Out-Null
  Expand-Archive -LiteralPath $resolvedZip -DestinationPath $extractRoot

  foreach ($name in @("plvs.exe", "plvs-cli.exe", "ffmpeg.exe", "ffprobe.exe")) {
    $path = Join-Path $extractRoot $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Portable ZIP is missing $name"
    }
    if ((Get-Item -LiteralPath $path).Length -eq 0) {
      throw "Portable ZIP contains an empty $name"
    }
  }

  & node (Join-Path $repoRoot "scripts\verify-license-assets.mjs") $extractRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Portable license asset verification failed with exit code $LASTEXITCODE"
  }
} finally {
  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
  }
}

Write-Host "Windows Portable ZIP smoke check passed: $resolvedZip"
