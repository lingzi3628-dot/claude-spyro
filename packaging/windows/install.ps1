# Spyro Studio — Windows installer (PowerShell).
# Installs to %LOCALAPPDATA%\Programs\Spyro Studio and adds it to PATH.
$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA "Programs\Spyro Studio"

Write-Host "Installing Spyro Studio -> $dest"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Get-ChildItem -Path $src -Force | Where-Object { $_.Name -ne 'install.ps1' } | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force
}

# Put it on PATH for this and future shells.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dest*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$dest", "User")
  Write-Host "Added to your PATH (restart your terminal)."
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  Write-Host "Installed. Run: Spyro Studio.cmd"
} else {
  Write-Warning "Node.js 18+ not found. Install from https://nodejs.org/ before launching."
}
