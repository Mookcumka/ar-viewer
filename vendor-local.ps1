# Run locally on Windows (PowerShell 7) or macOS/Linux (pwsh).
# No GitHub Actions, no npm, no paid services.
$ErrorActionPreference = 'Stop'
$dest = Join-Path $PSScriptRoot 'vendor'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$files = [ordered]@{
  'aframe.min.js' = 'https://aframe.io/releases/1.6.0/aframe.min.js'
  'jsQR.js' = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
  'aframe-ar.js' = 'https://raw.githubusercontent.com/AR-js-org/AR.js/3.4.7/aframe/build/aframe-ar.js'
  'patt.hiro' = 'https://raw.githubusercontent.com/AR-js-org/AR.js/3.4.7/data/data/patt.hiro'
  'camera_para.dat' = 'https://raw.githubusercontent.com/AR-js-org/AR.js/3.4.7/data/data/camera_para.dat'
}
foreach ($name in $files.Keys) {
  $path = Join-Path $dest $name
  Invoke-WebRequest -Uri $files[$name] -OutFile $path -MaximumRedirection 5
  if ((Get-Item $path).Length -lt 100) { throw "Downloaded file too small: $name" }
  Write-Host "$name : $((Get-Item $path).Length) bytes"
}
Write-Host 'Dependencies downloaded. Review and commit ar-poc/vendor/ to feature/ar-qr-cube-poc.'
