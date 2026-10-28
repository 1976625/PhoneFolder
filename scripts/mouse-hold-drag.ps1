param(
  [int]$X1,
  [int]$Y1,
  [int]$X2,
  [int]$Y2,
  [int]$HoldMs = 1500
)
$sig = @'
using System;
using System.Runtime.InteropServices;
public class HoldMouseInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public MOUSEINPUT mi;
  }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  const uint MOVE = 0x0001, DOWN = 0x0002, UP = 0x0004, ABS = 0x8000, VDESK = 0x4000;
  static void Send(uint flags, int x, int y) {
    var input = new INPUT();
    input.type = 0;
    input.mi.dwFlags = flags;
    input.mi.dx = x;
    input.mi.dy = y;
    SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void MoveTo(int x, int y) {
    int w = GetSystemMetrics(78), h = GetSystemMetrics(79);
    int ox = GetSystemMetrics(76), oy = GetSystemMetrics(77);
    Send(MOVE | ABS | VDESK, (int)Math.Round((x - ox) * 65535.0 / (w - 1)), (int)Math.Round((y - oy) * 65535.0 / (h - 1)));
  }
  public static void Down() { Send(DOWN, 0, 0); }
  public static void Up() { Send(UP, 0, 0); }
}
'@
Add-Type -TypeDefinition $sig -Language CSharp
[HoldMouseInput]::MoveTo($X1, $Y1)
Start-Sleep -Milliseconds 250
[HoldMouseInput]::Down()
Start-Sleep -Milliseconds 150
$steps = 24
for ($i = 1; $i -le $steps; $i++) {
  $tx = [int]($X1 + ($X2 - $X1) * $i / $steps)
  $ty = [int]($Y1 + ($Y2 - $Y1) * $i / $steps)
  [HoldMouseInput]::MoveTo($tx, $ty)
  Start-Sleep -Milliseconds 30
}
Start-Sleep -Milliseconds $HoldMs
[HoldMouseInput]::Up()
Write-Host "hold-drag done"
