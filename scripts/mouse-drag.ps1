param(
  [int]$X1,
  [int]$Y1,
  [int]$X2,
  [int]$Y2
)
$sig = @'
using System;
using System.Runtime.InteropServices;
public class MouseInput {
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
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  const uint MOUSEEVENTF_MOVE = 0x0001;
  const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  const uint MOUSEEVENTF_LEFTUP = 0x0004;
  const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;

  static void Send(uint flags, int x, int y) {
    var input = new INPUT();
    input.type = 0; // INPUT_MOUSE
    input.mi.dwFlags = flags;
    input.mi.dx = x;
    input.mi.dy = y;
    input.mi.mouseData = 0;
    input.mi.time = 0;
    input.mi.dwExtraInfo = IntPtr.Zero;
    SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }

  static int AbsX(int x, int width) { return (int)Math.Round(x * 65535.0 / (width - 1)); }
  static int AbsY(int y, int height) { return (int)Math.Round(y * 65535.0 / (height - 1)); }

  public static void MoveTo(int x, int y) {
    int w = GetSystemMetrics(78); // SM_CXVIRTUALSCREEN
    int h = GetSystemMetrics(79); // SM_CYVIRTUALSCREEN
    int ox = GetSystemMetrics(76); // SM_XVIRTUALSCREEN
    int oy = GetSystemMetrics(77); // SM_YVIRTUALSCREEN
    Send(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, AbsX(x - ox, w), AbsY(y - oy, h));
  }
  public static void Down() { Send(MOUSEEVENTF_LEFTDOWN, 0, 0); }
  public static void Up() { Send(MOUSEEVENTF_LEFTUP, 0, 0); }
}
'@
Add-Type -TypeDefinition $sig -Language CSharp
[MouseInput]::MoveTo($X1, $Y1)
Start-Sleep -Milliseconds 250
[MouseInput]::Down()
Start-Sleep -Milliseconds 120

$steps = 26
for ($i = 1; $i -le $steps; $i++) {
  $tx = [int]($X1 + ($X2 - $X1) * $i / $steps)
  $ty = [int]($Y1 + ($Y2 - $Y1) * $i / $steps)
  [MouseInput]::MoveTo($tx, $ty)
  Start-Sleep -Milliseconds 35
}
Start-Sleep -Milliseconds 250
[MouseInput]::Up()
Write-Host "dragged $X1,$Y1 -> $X2,$Y2"
