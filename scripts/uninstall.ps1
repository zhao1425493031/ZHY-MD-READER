<#
.SYNOPSIS
  Remove the ZHY MD Reader context menu registration, the install directory and user data.
#>
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\ZhyMdReader'),
    [switch]$KeepSettings
)

$ErrorActionPreference = 'Stop'
$exe = Join-Path $InstallDir 'ZhyMdReader.exe'

Get-Process ZhyMdReader -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

if (Test-Path $exe) {
    Start-Process $exe -ArgumentList '--unregister', '--quiet' -Wait
    Remove-Item $InstallDir -Recurse -Force
    Write-Host "Removed $InstallDir"
} else {
    Write-Warning "$exe not found, skipping unregistration."
}

$dataDir = Join-Path $env:LOCALAPPDATA 'ZhyMdReader'
if (-not $KeepSettings -and (Test-Path $dataDir)) {
    Remove-Item $dataDir -Recurse -Force
    Write-Host "Removed user data $dataDir"
}

Write-Host 'Uninstalled.' -ForegroundColor Green
