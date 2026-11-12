param([string]$udf, [string]$png, [int]$wait = 25)
# Opens a .udf in the official UYAP Doküman Editörü, screenshots its window, closes it.
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W {
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
for ($i = 0; $i -lt $wait; $i++) {
  Start-Sleep -Seconds 1
  $procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -match 'UDF|Dok|Edit|\.udf') -and ($_.ProcessName -match 'java|Uyap|Dok') }
  if ($procs) { $h = $procs[0].MainWindowHandle; $title = $procs[0].MainWindowTitle; if ($title -match [regex]::Escape([IO.Path]::GetFileNameWithoutExtension($udf))) { break } }
}
if ($h -eq [IntPtr]::Zero) { "no window"; exit 1 }
Start-Sleep -Seconds 4
[W]::ShowWindow($h, 3) | Out-Null   # maximize
Start-Sleep -Seconds 2
$r = New-Object W+RECT; [W]::GetWindowRect($h, [ref]$r) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc(); [W]::PrintWindow($h, $dc, 2) | Out-Null; $g.ReleaseHdc($dc)
$bmp.Save($png)
"title: $title  size: $($bmp.Width)x$($bmp.Height)"
Get-Process | Where-Object { $_.MainWindowHandle -eq $h } | Stop-Process -Force
