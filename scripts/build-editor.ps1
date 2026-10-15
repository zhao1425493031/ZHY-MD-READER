<#
.SYNOPSIS
  Bundle the CodeMirror 6 editor (editor/src/editor.js) into src/SmartMdReader/assets/vendor/editor.js,
  and copy Mermaid / KaTeX into src/SmartMdReader/assets/vendor.
#>
$ErrorActionPreference = 'Stop'
$editorDir = Join-Path $PSScriptRoot '..\editor'
$vendor = Join-Path $PSScriptRoot '..\src\SmartMdReader\assets\vendor'
$out = Join-Path $vendor 'editor.js'

Push-Location $editorDir
try {
    if (-not (Test-Path 'node_modules')) {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    }
    npx esbuild src/editor.js --bundle --minify --format=iife --target=es2020 --legal-comments=none "--outfile=$out"
    if ($LASTEXITCODE -ne 0) { throw 'esbuild failed' }

    Copy-Item 'node_modules\mermaid\dist\mermaid.min.js' (Join-Path $vendor 'mermaid.min.js') -Force

    $katexDir = Join-Path $vendor 'katex'
    if (Test-Path $katexDir) { Remove-Item $katexDir -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $katexDir 'fonts') | Out-Null
    Copy-Item 'node_modules\katex\dist\katex.min.js', 'node_modules\katex\dist\katex.min.css' $katexDir
    # 只带 woff2，WebView2 (Chromium) 用不到 woff/ttf
    Copy-Item 'node_modules\katex\dist\fonts\*.woff2' (Join-Path $katexDir 'fonts')
}
finally {
    Pop-Location
}
Write-Host "Editor bundle: $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"
