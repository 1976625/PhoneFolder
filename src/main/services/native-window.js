'use strict';

// Win32 辅助（通过常驻 PowerShell）：
//  - bottom/topmost/normal：控制瓦片窗口 z-order
//  - 轮询前台窗口 + 其它可见窗口数：判断「是不是显示桌面状态」
//    （桌面聚焦且没有别的可见窗口 → 瓦片临时置顶保持可见；否则压回底层，永远在软件下面）
//  - focusdesktop：收起浮层后把焦点还给桌面（否则隐藏的浮层窗口会一直占着前台）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { log } = require('./logger');

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Name PFNative -Namespace PhoneFolder -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder t, int c);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
'@

$script:lastAppHwnd = [IntPtr]::Zero
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Trim() -split '\s+'
  if ($parts.Length -lt 1) { continue }
  if ($parts[0] -eq 'state') {
    try {
      $hwnd = [PhoneFolder.PFNative]::GetForegroundWindow()
      $cls = New-Object System.Text.StringBuilder 256
      [PhoneFolder.PFNative]::GetClassName($hwnd, $cls, 256) | Out-Null
      $fgClass = $cls.ToString()
      $isDesktop = ($fgClass -eq 'Progman' -or $fgClass -eq 'WorkerW')
      if ($isDesktop) {
        # 桌面前台：只有「上一个前台软件窗口被最小化」才认为触发了显示桌面
        $show = 'apps'
        if ($script:lastAppHwnd -eq [IntPtr]::Zero) { $show = 'showdesktop' }
        elseif ([PhoneFolder.PFNative]::IsIconic($script:lastAppHwnd)) { $show = 'showdesktop' }
      } else {
        $show = 'apps'
        if ($fgClass -notlike 'Chrome_WidgetWin*') { $script:lastAppHwnd = $hwnd }
      }
      [Console]::Out.WriteLine('state ' + $show + ' ' + $fgClass)
      [Console]::Out.Flush()
    } catch { }
    continue
  }
  if ($parts[0] -eq 'focusdesktop') {
    try {
      [PhoneFolder.PFNative]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
      [PhoneFolder.PFNative]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
      $progman = [PhoneFolder.PFNative]::FindWindow('Progman', $null)
      if ($progman -ne [IntPtr]::Zero) { [PhoneFolder.PFNative]::SetForegroundWindow($progman) | Out-Null }
    } catch { }
    continue
  }
  if ($parts.Length -lt 2) { continue }
  $hwnd = [IntPtr][long]$parts[1]
  switch ($parts[0]) {
    'bottom'  { [PhoneFolder.PFNative]::SetWindowPos($hwnd, [IntPtr]1, 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010) | Out-Null }
    'topmost' { [PhoneFolder.PFNative]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010) | Out-Null }
    'normal'  { [PhoneFolder.PFNative]::SetWindowPos($hwnd, [IntPtr](-2), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010) | Out-Null }
    'restore' { [PhoneFolder.PFNative]::ShowWindow($hwnd, 9) | Out-Null }
  }
}
`;

let child = null;
let scriptPath = null;
const stateListeners = new Set();
let pendingLines = '';
let pollTimer = null;
let lastDesktopState = null;

function ensureScript() {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
  try {
    scriptPath = path.join(os.tmpdir(), 'phonefolder-native-window.ps1');
    fs.writeFileSync(scriptPath, SCRIPT, 'utf8');
  } catch (err) {
    log('native window script write failed:', err.message);
    scriptPath = null;
  }
  return scriptPath;
}

function handleLine(line) {
  if (!line.startsWith('state ')) return;
  // state <showdesktop|apps> <foregroundClass>
  const parts = line.trim().split(' ');
  const showDesktop = parts[1] === 'showdesktop';
  const fgClass = parts[2] || '';
  if (showDesktop === lastDesktopState) return;
  lastDesktopState = showDesktop;
  log('desktop state:', showDesktop ? 'show-desktop' : 'apps', fgClass);
  for (const listener of stateListeners) {
    try { listener(showDesktop); } catch (err) { log('desktop state listener failed:', err.message); }
  }
}

function ensureChild() {
  if (child && !child.killed) return child;
  const file = ensureScript();
  if (!file) return null;
  try {
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      pendingLines += chunk;
      let index = pendingLines.indexOf('\n');
      while (index >= 0) {
        const line = pendingLines.slice(0, index).trim();
        pendingLines = pendingLines.slice(index + 1);
        if (line) handleLine(line);
        index = pendingLines.indexOf('\n');
      }
    });
    child.on('exit', () => { child = null; });
    child.on('error', (err) => { log('native window helper error:', err.message); child = null; });
  } catch (err) {
    log('native window helper spawn failed:', err.message);
    child = null;
  }
  return child;
}

function send(command) {
  try {
    const proc = ensureChild();
    if (!proc || !proc.stdin || proc.stdin.destroyed) return;
    proc.stdin.write(`${command}\n`);
  } catch (err) {
    log('native window command failed:', err.message);
  }
}

function hwndOf(win) {
  try {
    const buffer = win.getNativeWindowHandle();
    if (buffer.length >= 8) return buffer.readBigUInt64LE(0).toString();
    return String(buffer.readUInt32LE(0));
  } catch {
    return null;
  }
}

function bottomWindow(win) {
  if (!win || win.isDestroyed()) return;
  const hwnd = hwndOf(win);
  if (hwnd) send(`bottom ${hwnd}`);
}

function topmostWindow(win) {
  if (!win || win.isDestroyed()) return;
  const hwnd = hwndOf(win);
  if (hwnd) send(`topmost ${hwnd}`);
}

function normalWindow(win) {
  if (!win || win.isDestroyed()) return;
  const hwnd = hwndOf(win);
  if (hwnd) send(`normal ${hwnd}`);
}

function focusDesktop() {
  send('focusdesktop');
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (stateListeners.size === 0) return;
    send('state');
  }, 450);
  if (pollTimer.unref) pollTimer.unref();
}

// 监听「显示桌面」状态变化（true = 桌面聚焦且没有其它可见窗口）
function watchDesktopState(listener) {
  if (typeof listener !== 'function') return () => {};
  stateListeners.add(listener);
  ensureChild();
  startPolling();
  return () => stateListeners.delete(listener);
}

function dispose() {
  try { if (child && !child.killed) child.stdin.end(); } catch { /* ignore */ }
  child = null;
}

module.exports = {
  bottomWindow,
  topmostWindow,
  normalWindow,
  focusDesktop,
  watchDesktopState,
  hwndOf,
  dispose
};


