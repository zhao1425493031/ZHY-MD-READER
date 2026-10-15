<#
.SYNOPSIS
  Build and install SmartMdReader for the current user, and register the .md context menu (no admin rights needed).
.PARAMETER InstallDir
  Install location. Default: %LOCALAPPDATA%\Programs\SmartMdReader
.PARAMETER SelfContained
  Bundle the .NET runtime (larger, but the target machine does not need the .NET 10 Desktop Runtime).
#>
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\SmartMdReader'),
    [switch]$SelfContained
)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot '..\src\SmartMdReader\SmartMdReader.csproj'

$running = Get-Process SmartMdReader -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
    Write-Host 'Closing running SmartMdReader instances...'
    $running | Stop-Process -Force
    Start-Sleep -Milliseconds 500
}

Write-Host "Publishing to $InstallDir ..."
$sc = if ($SelfContained) { 'true' } else { 'false' }
dotnet publish $project -c Release -r win-x64 --self-contained $sc -o $InstallDir -p:DebugType=none
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

$exe = Join-Path $InstallDir 'SmartMdReader.exe'
$proc = Start-Process $exe -ArgumentList '--register', '--quiet' -Wait -PassThru
if ($proc.ExitCode -ne 0) { throw 'Failed to register the context menu' }

Write-Host ''
Write-Host 'Installed:' -ForegroundColor Green
Write-Host "  Program: $exe"
Write-Host '  Right-click a .md file -> "Open with SmartMdReader" (Windows 11: under "Show more options")'
Write-Host '  Or right-click -> Open with -> SmartMdReader'
Write-Host '  To open on double-click: right-click a .md file -> Open with -> Choose another app -> SmartMdReader -> Always'
Write-Host '  Change the UI language (English / 中文 / 日本語) in the app via the gear button (Ctrl+,)'
