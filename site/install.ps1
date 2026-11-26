# MarkOS one-line install for Windows. In PowerShell:
#   irm https://markos.priberry.com/install.ps1 | iex
# Gets the code into %USERPROFILE%\markos (git if you have it, else a download from GitHub),
# then runs its installer. Run it again to update. Source: https://github.com/priberry-data/markos
$ErrorActionPreference = 'Stop'
$dir = if ($env:MARKOS_DIR) { $env:MARKOS_DIR } else { Join-Path $HOME 'markos' }
$repo = 'https://github.com/priberry-data/markos'
$ref = if ($env:MARKOS_REF) { $env:MARKOS_REF } else { 'main' }   # a branch to test

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'MarkOS needs Node 22 or newer: https://nodejs.org  (or: winget install OpenJS.NodeJS.LTS, then open a new PowerShell)'
  return
}

if (Test-Path (Join-Path $dir '.git')) {
  Write-Host "Updating MarkOS in $dir..."
  git -C $dir pull --ff-only -q
} elseif (-not $env:MARKOS_NO_GIT -and (Get-Command git -ErrorAction SilentlyContinue) -and -not (Test-Path $dir)) {
  Write-Host "Getting MarkOS into $dir..."
  git clone -q -b $ref $repo $dir
} else {
  Write-Host "Downloading MarkOS into $dir..."
  $zip = Join-Path ([IO.Path]::GetTempPath()) 'markos-download.zip'
  $tmp = Join-Path ([IO.Path]::GetTempPath()) 'markos-download'
  Invoke-WebRequest "$repo/archive/refs/heads/$ref.zip" -OutFile $zip -UseBasicParsing
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Copy-Item -Path (Join-Path (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName '*') -Destination $dir -Recurse -Force
  Remove-Item $zip, $tmp -Recurse -Force
  Remove-Item (Join-Path $dir '.next\markos-build-stamp') -ErrorAction SilentlyContinue
}

Set-Location $dir
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'install.ps1')
