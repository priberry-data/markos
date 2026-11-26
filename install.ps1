# MarkOS in one command on Windows. In PowerShell, from the MarkOS folder:
#   powershell -ExecutionPolicy Bypass -File install.ps1
# Checks this computer, installs, sets up the database (no Docker) and puts MarkOS on your
# Desktop. Safe to run again.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host 'MarkOS needs Node 22 or newer: https://nodejs.org (or: winget install OpenJS.NodeJS.LTS)'; exit 1 }
$major = [int](& node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) { Write-Host "MarkOS needs Node 22 or newer; this is $(& node --version). https://nodejs.org"; exit 1 }

Write-Host 'Installing (a minute or two)...'
& npm install --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node scripts/markos.mjs install
exit $LASTEXITCODE
