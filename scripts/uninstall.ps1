<#
.SYNOPSIS
  Remove the SmartMdReader context menu registration, the install directory and user data.
#>
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\SmartMdReader'),
    [switch]$KeepSettings
)

$ErrorActionPreference = 'Stop'
$exe = Join-Path $InstallDir 'SmartMdReader.exe'

Get-Process SmartMdReader -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

if (Test-Path $exe) {
    Start-Process $exe -ArgumentList '--unregister', '--quiet' -Wait
    Remove-Item $InstallDir -Recurse -Force
    Write-Host "Removed $InstallDir"
} else {
    Write-Warning "$exe not found, skipping unregistration."
}

$dataDir = Join-Path $env:LOCALAPPDATA 'SmartMdReader'
if (-not $KeepSettings -and (Test-Path $dataDir)) {
    Remove-Item $dataDir -Recurse -Force
    Write-Host "Removed user data $dataDir"
}

Write-Host 'Uninstalled.' -ForegroundColor Green
