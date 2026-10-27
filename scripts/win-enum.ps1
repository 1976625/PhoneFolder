<#
  枚举可见顶层窗口（标题包含 -Filter），输出 title|widthxheight|位置，供 E2E 脚本核对多瓦片窗口
#>
param([string]$Filter = 'PhoneFolder')

$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinState2 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder t, int c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static string Dump(string filter) {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      if (t.Length == 0 || !t.ToString().Contains(filter)) return true;
      RECT r; GetWindowRect(h, out r);
      sb.AppendLine(string.Format("{0}|{1}x{2}|at {3},{4}", t, r.Right - r.Left, r.Bottom - r.Top, r.Left, r.Top));
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
'@

Add-Type -TypeDefinition $sig -Language CSharp
[WinState2]::Dump($Filter)
