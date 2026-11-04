# Installs the packaged portable build into %LOCALAPPDATA%\TubbyBuddy and creates shortcuts.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $root 'release\TubbyBuddy-win32-x64'
if (-not (Test-Path (Join-Path $src 'TubbyBuddy.exe'))) {
  throw "Build the app first: cd desktop; npm run pack. Missing $src\TubbyBuddy.exe"
}
$dest = Join-Path $env:LOCALAPPDATA 'TubbyBuddy'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Copy-Item $src $dest -Recurse -Force
$exe = Join-Path $dest 'TubbyBuddy.exe'
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
foreach ($dir in @($desktop, $startMenu)) {
  $lnk = $ws.CreateShortcut((Join-Path $dir 'TubbyBuddy.lnk'))
  $lnk.TargetPath = $exe
  $lnk.WorkingDirectory = $dest
  $lnk.IconLocation = "$exe,0"
  $lnk.Description = 'TubbyBuddy desktop focus guard'
  $lnk.Save()
}
Write-Host "Installed to $dest"
Start-Process $exe
