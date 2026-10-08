param([Parameter(Mandatory=$true)][int]$TargetProcessId)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HeroWindowDiagnostics {
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
}
'@
$target = Get-Process -Id $TargetProcessId
if ($target.MainWindowHandle -eq 0) { throw 'The capture process has no main window.' }
$scale = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Accessibility' -Name TextScaleFactor -ErrorAction SilentlyContinue).TextScaleFactor
if ($null -eq $scale) { $scale = 100 }
[PSCustomObject]@{
  windowDpi = [HeroWindowDiagnostics]::GetDpiForWindow($target.MainWindowHandle)
  textScalePercent = [int]$scale
} | ConvertTo-Json -Compress
