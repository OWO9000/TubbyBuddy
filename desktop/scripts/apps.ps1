# Lists installed desktop apps that have an .exe target.
# Sources: Start Menu shortcuts, uninstall registry entries, and currently running windows.
# Output: JSON array [{name, exe, path, source}]
$ErrorActionPreference = "SilentlyContinue"

$exclude = @(
  "tubbybuddy", "electron", "explorer", "applicationframehost", "textinputhost",
  "shellexperiencehost", "searchhost", "startmenuexperiencehost", "runtimebroker",
  "backgroundtaskhost", "systemsettings", "taskmgr", "cmd", "powershell", "pwsh",
  "conhost", "dllhost", "svchost", "registry", "userinit", "winlogon", "lockapp",
  "sihost", "ctfmon", "msedgewebview2"
)
$map = @{}

function Add-App([string]$exe, [string]$name, [string]$path, [string]$source) {
  if (-not $exe) { return }
  $exe = $exe.Trim()
  if ($exe -match '\.exe$') { $exe = $exe.Substring(0, $exe.Length - 4) }
  if (-not $exe -or $exclude -contains $exe.ToLower()) { return }
  if ($name -match '(?i)uninstall|readme|help|website|documentation|license|runtime|redistributable') { return }
  if ($path -and ($path -match '(?i)^[a-z]:\\Windows\\' -or $path -match '(?i)\\Package Cache\\')) { return }
  if ($exe -match '(?i)^(unins|uninst|setup|remove|update|install|uninstall|vcredist|vc_redist|python-.*-amd64|windowsdesktop-runtime|winsdksetup|recoverydrive|amdbugreporttool|amdinstallmanager|appverif|appcertui|odbcad32|iscsicpl|mdsched|psr|msconfig|msinfo32|perfmon|regedit|charmap|cleanmgr|dfrgui|magnify|narrator|osk|voiceaccess|livecaptions|control|mstsc|wsl|powershell|pwsh|cmd|conhost|7zfm)$') { return }
  $key = $exe.ToLower()
  $name = ($name -replace '\s+', ' ').Trim()
  if (-not $name) { $name = $exe }
  if ($name.Length -gt 70) { $name = $name.Substring(0, 70) }
  if (-not $map.ContainsKey($key)) {
    $map[$key] = [pscustomobject]@{ name = $name; exe = $exe; path = $path; source = $source }
  } elseif ($source -eq "start-menu") {
    # Prefer a friendly Start Menu name over a process description.
    $map[$key].name = $name
    $map[$key].path = $path
    $map[$key].source = $source
  }
}

# 1. Start Menu shortcuts (most reliable friendly names and targets).
$shell = New-Object -ComObject WScript.Shell
$menus = @(
  (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs")
)
foreach ($menu in $menus) {
  if (-not (Test-Path $menu)) { continue }
  Get-ChildItem -Path $menu -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $target = $null
    try { $target = $shell.CreateShortcut($_.FullName).TargetPath } catch { }
    if ($target -and $target -match '\.exe$') {
      Add-App -exe ([IO.Path]::GetFileName($target)) -name $_.BaseName -path $target -source "start-menu"
    }
  }
}

# 2. Running apps with a visible top-level window.
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
  $name = $_.FileVersionInfo.FileDescription
  if (-not $name) { $name = $_.ProcessName }
  $path = $_.Path
  Add-App -exe $_.ProcessName -name $name -path $path -source "running"
}

$list = @($map.Values | Sort-Object name | Select-Object -First 300)
if ($list.Count -eq 0) {
  Write-Output "[]"
} else {
  Write-Output ($list | ConvertTo-Json -Compress -Depth 4)
}
