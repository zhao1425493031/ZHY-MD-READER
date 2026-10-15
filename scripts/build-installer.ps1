<#
.SYNOPSIS
  Build the SmartMdReader installer: dist\SmartMdReader-Setup-<version>.exe
.DESCRIPTION
  1. dotnet publish (self-contained, win-x64) to publish\app
  2. Compile installer\SmartMdReader.iss with Inno Setup 6 (https://jrsoftware.org/isinfo.php)
#>
param(
    [string]$Iscc
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$project = Join-Path $root 'src\SmartMdReader\SmartMdReader.csproj'
$publishDir = Join-Path $root 'publish\app'
$iss = Join-Path $root 'installer\SmartMdReader.iss'

if (-not $Iscc) {
    $candidates = @(
        (Get-Command iscc.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    ) | Where-Object { $_ -and (Test-Path $_) }
    $Iscc = $candidates | Select-Object -First 1
}
if (-not $Iscc) {
    throw 'Inno Setup 6 (ISCC.exe) not found. Install it with: winget install JRSoftware.InnoSetup'
}

$version = ([xml](Get-Content $project)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
if (-not $version) { $version = '1.0.0' }

Write-Host "Publishing SmartMdReader $version (self-contained) ..."
if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
dotnet publish $project -c Release -r win-x64 --self-contained true -o $publishDir -p:DebugType=none
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

Write-Host 'Compiling installer ...'
& $Iscc "/DAppVersion=$version" "/DPublishDir=$publishDir" $iss
if ($LASTEXITCODE -ne 0) { throw 'ISCC failed' }

$setup = Join-Path $root "dist\SmartMdReader-Setup-$version.exe"
Write-Host ''
Write-Host "Installer created: $setup" -ForegroundColor Green
Write-Host ("Size: {0:N1} MB" -f ((Get-Item $setup).Length / 1MB))
