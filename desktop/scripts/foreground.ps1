# Returns: processName|windowTitle|pid|valid
# valid = a normal, large, activatable window. Notification toasts / tool windows are ignored.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TubbyForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint id);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$h = [TubbyForeground]::GetForegroundWindow()
$procId = 0
[TubbyForeground]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
$sb = New-Object System.Text.StringBuilder 512
[TubbyForeground]::GetWindowText($h, $sb, 512) | Out-Null
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
if ($null -eq $p) { exit 0 }

$ex = [TubbyForeground]::GetWindowLong($h, -20)
$tool = (($ex -band 0x80) -ne 0) -or (($ex -band 0x08000000) -ne 0)   # WS_EX_TOOLWINDOW / WS_EX_NOACTIVATE
$rect = New-Object TubbyForeground+RECT
[TubbyForeground]::GetWindowRect($h, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$hh = $rect.Bottom - $rect.Top
$valid = (-not $tool) -and ($w -ge 400) -and ($hh -ge 300)

$name = $p.ProcessName
$title = $sb.ToString().Replace("|", " ")
Write-Output ("{0}|{1}|{2}|{3}" -f $name, $title, $procId, $(if ($valid) { "1" } else { "0" }))
