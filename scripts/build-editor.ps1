<#
.SYNOPSIS
  Bundle the CodeMirror 6 editor (editor/src/editor.js) into src/SmartMdReader/assets/vendor/editor.js
#>
$ErrorActionPreference = 'Stop'
$editorDir = Join-Path $PSScriptRoot '..\editor'
$out = Join-Path $PSScriptRoot '..\src\SmartMdReader\assets\vendor\editor.js'

Push-Location $editorDir
try {
    if (-not (Test-Path 'node_modules')) {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    }
    npx esbuild src/editor.js --bundle --minify --format=iife --target=es2020 --legal-comments=none "--outfile=$out"
    if ($LASTEXITCODE -ne 0) { throw 'esbuild failed' }
}
finally {
    Pop-Location
}
Write-Host "Editor bundle: $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"
