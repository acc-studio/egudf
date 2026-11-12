param([string]$udf, [string]$keys, [string]$png, [int]$wait = 40)
# Opens a .udf in the official editor, sends keystrokes (SendKeys syntax, '|' separates steps
# with a pause), screenshots, closes. Used to make UYAP itself write test files.
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W2 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  public struct RECT { public int L, T, R, B; }
}
"@
$exe = (Get-ChildItem 'C:\Uyap\Uyap Kelime Islemci\Uyap Dok*Edit*.exe' | Where-Object { $_.Name -notmatch 'x86|Sablon' } | Select-Object -First 1).FullName
$p = Start-Process -FilePath $exe -ArgumentList "`"$udf`"" -WorkingDirectory 'C:\Uyap\Uyap Kelime Islemci' -PassThru
$h = [IntPtr]::Zero
$name = [IO.Path]::GetFileNameWithoutExtension($udf)
for ($i = 0; $i -lt $wait; $i++) {
  Start-Sleep -Seconds 1
  $procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match [regex]::Escape($name) }
  if ($procs) { $h = $procs[0].MainWindowHandle; break }
}
if ($h -eq [IntPtr]::Zero) { "no window"; exit 1 }
# the first window with the title can be the splash: wait for the full editor window
for ($i = 0; $i -lt $wait; $i++) {
  $procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match [regex]::Escape($name) }
  if ($procs) { $h = $procs[0].MainWindowHandle; [W2]::ShowWindow($h, 3) | Out-Null; $rr = New-Object W2+RECT; [W2]::GetWindowRect($h, [ref]$rr) | Out-Null; if (($rr.R - $rr.L) -gt 900) { break } }
  Start-Sleep -Seconds 1
}
Start-Sleep -Seconds 4
[W2]::ShowWindow($h, 3) | Out-Null
Start-Sleep -Seconds 1
foreach ($k in $keys.Split('|')) {
  [W2]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 400
  [System.Windows.Forms.SendKeys]::SendWait($k)
  Start-Sleep -Milliseconds 900
}
Start-Sleep -Seconds 2
$r = New-Object W2+RECT; [W2]::GetWindowRect($h, [ref]$r) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc(); [W2]::PrintWindow($h, $dc, 2) | Out-Null; $g.ReleaseHdc($dc)
$bmp.Save($png)
# any dialog left open?
$title = (Get-Process | Where-Object { $_.MainWindowHandle -eq $h }).MainWindowTitle
"title: $title"
Get-Process | Where-Object { $_.MainWindowHandle -eq $h } | Stop-Process -Force
