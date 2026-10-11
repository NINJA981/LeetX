# LeetX Squads installer for Windows (Chromium browsers, unpacked).
# Installs the latest *released* build, never unreleased code from main.
#   irm https://raw.githubusercontent.com/NINJA981/LeetX/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$repo = 'NINJA981/LeetX'
$installDir = if ($env:LEETX_INSTALL_DIR) { $env:LEETX_INSTALL_DIR } else { Join-Path $env:USERPROFILE 'leetx-squads' }
$zipUrl = "https://github.com/$repo/releases/latest/download/leetx-chrome.zip"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("leetx-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
    Write-Host 'LeetX Squads installer'
    Write-Host '-> Downloading the latest release...'
    $zip = Join-Path $tmp 'leetx.zip'
    Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing

    $extract = Join-Path $tmp 'x'
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    if (-not (Test-Path (Join-Path $extract 'manifest.json'))) {
        throw 'Downloaded package is missing manifest.json - aborting.'
    }

    Write-Host "-> Installing to $installDir"
    if (Test-Path $installDir) { Remove-Item -Path $installDir -Recurse -Force }
    Move-Item -Path $extract -Destination $installDir

    Set-Clipboard -Value $installDir
    Write-Host '-> Folder path copied to clipboard'
    Write-Host ''
    Write-Host 'Done. To finish:'
    Write-Host '  1. Open chrome://extensions (or edge://extensions)'
    Write-Host '  2. Turn on Developer mode'
    Write-Host '  3. Click "Load unpacked" and paste the folder path (Ctrl+V)'
    Write-Host ''
    Write-Host 'Re-run this script any time to update.'
}
finally {
    Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
