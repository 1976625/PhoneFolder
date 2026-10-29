param([int]$X, [int]$Y)
$sig = @'
using System;
using System.Runtime.InteropServices;
public class PfClickMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
}
'@
Add-Type -TypeDefinition $sig -Language CSharp
[PfClickMouse]::SetCursorPos($X, $Y) | Out-Null
Start-Sleep -Milliseconds 250
[PfClickMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 110
[PfClickMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Write-Host "clicked $X,$Y"
