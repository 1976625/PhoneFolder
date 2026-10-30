'use strict';

// Win32 辅助（通过常驻 PowerShell）：
//  - bottom/topmost/normal：控制瓦片窗口 z-order（普通窗口模式）
//  - attach/detach/position/show/hide/health/bounds：桌面级子窗口模式
//    （把瓦片挂到 Progman 桌面下，Win+D 不会被收起、天然在软件下面）
//  - 轮询前台窗口：判断「显示桌面」状态（普通窗口模式下的回退逻辑）
//  - focusdesktop：收起浮层后把焦点还给桌面
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { log } = require('./logger');

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Name PFNative -Namespace PhoneFolder -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder t, int c);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
[DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int index, int value);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT rect);
[DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr h, IntPtr rect, IntPtr region, uint flags);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr extra);
public delegate bool EnumProc(IntPtr h, IntPtr extra);
'@

$script:lastAppHwnd = [IntPtr]::Zero
$WS_CHILD = 0x40000000
$WS_POPUP = 0x80000000
$GWL_STYLE = -16
$script:desktopProgman = [IntPtr]::Zero
$script:desktopWorkerW = [IntPtr]::Zero
$script:desktopDefView = [IntPtr]::Zero

# 用 EnumWindows 找 Progman / WorkerW（本机 FindWindow 对 Progman 返回 0，必须枚举）
function Find-DesktopWindows {
  $script:desktopProgman = [IntPtr]::Zero
  $script:desktopWorkerW = [IntPtr]::Zero
  $script:desktopDefView = [IntPtr]::Zero
  $cb = [PhoneFolder.PFNative+EnumProc]{
    param($h, $extra)
    $sb = New-Object System.Text.StringBuilder 256
    [PhoneFolder.PFNative]::GetClassName($h, $sb, 256) | Out-Null
    $cls = $sb.ToString()
    if ($cls -eq 'Progman') { $script:desktopProgman = $h; return $false }
    if ($cls -eq 'WorkerW') {
      $def = [PhoneFolder.PFNative]::FindWindowEx($h, [IntPtr]::Zero, 'SHELLDLL_DefView', $null)
      if ($def -ne [IntPtr]::Zero) { $script:desktopWorkerW = $h; $script:desktopDefView = $def }
    }
    return $true
  }
  [PhoneFolder.PFNative]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
}

function Get-DesktopParent {
  Find-DesktopWindows
  if ($script:desktopProgman -ne [IntPtr]::Zero) { return $script:desktopProgman }
  if ($script:desktopDefView -ne [IntPtr]::Zero) {
    $parent = [PhoneFolder.PFNative]::GetParent($script:desktopDefView)
    if ($parent -ne [IntPtr]::Zero) { return $parent }
  }
  if ($script:desktopWorkerW -ne [IntPtr]::Zero) { return $script:desktopWorkerW }
  return [IntPtr]::Zero
}

function Reply([string]$id, [string]$text) {
  if ($id -ne '') { [Console]::Out.WriteLine('@' + $id + ' ' + $text) }
  else { [Console]::Out.WriteLine($text) }
  [Console]::Out.Flush()
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Trim() -split '\s+'
  if ($parts.Length -lt 1) { continue }
  $id = ''
  if ($parts[0].StartsWith('@')) {
    $id = $parts[0].Substring(1)
    $parts = $parts[1..($parts.Length - 1)]
    if ($parts.Length -lt 1) { continue }
  }
  $cmd = $parts[0]
  if ($cmd -eq 'state') {
    try {
      $hwnd = [PhoneFolder.PFNative]::GetForegroundWindow()
      $cls = New-Object System.Text.StringBuilder 256
      [PhoneFolder.PFNative]::GetClassName($hwnd, $cls, 256) | Out-Null
      $fgClass = $cls.ToString()
      $isDesktop = ($fgClass -eq 'Progman' -or $fgClass -eq 'WorkerW')
      if ($isDesktop) {
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
  if ($cmd -eq 'focusdesktop') {
    try {
      [PhoneFolder.PFNative]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
      [PhoneFolder.PFNative]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
      $progman = [PhoneFolder.PFNative]::FindWindow('Progman', $null)
      if ($progman -ne [IntPtr]::Zero) { [PhoneFolder.PFNative]::SetForegroundWindow($progman) | Out-Null }
    } catch { }
    continue
  }
  if ($cmd -eq 'attach') {
    # attach <hwnd> <x> <y> <w> <h>
    try {
      $h = [IntPtr][long]$parts[1]
      $x = [int]$parts[2]; $y = [int]$parts[3]; $w = [int]$parts[4]; $hh = [int]$parts[5]
      $parent = Get-DesktopParent
      if ($parent -eq [IntPtr]::Zero) { Reply $id 'fail no-desktop-parent'; continue }
      $style = [int64][PhoneFolder.PFNative]::GetWindowLong($h, $GWL_STYLE)
      $newStyle = ($style -band (-bnot [int64]$WS_POPUP)) -bor [int64]$WS_CHILD
      [PhoneFolder.PFNative]::SetWindowLong($h, $GWL_STYLE, [int]$newStyle) | Out-Null
      [PhoneFolder.PFNative]::SetParent($h, $parent) | Out-Null
      [PhoneFolder.PFNative]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $w, $hh, 0x0010 -bor 0x0020 -bor 0x0040) | Out-Null
      [PhoneFolder.PFNative]::RedrawWindow($h, [IntPtr]::Zero, [IntPtr]::Zero, 0x0181) | Out-Null
      Reply $id ('ok attach ' + $parent.ToInt64().ToString())
    } catch { Reply $id ('fail attach ' + $_.Exception.Message) }
    continue
  }
  if ($cmd -eq 'detach') {
    # detach <hwnd> <x> <y> <w> <h>
    try {
      $h = [IntPtr][long]$parts[1]
      $x = [int]$parts[2]; $y = [int]$parts[3]; $w = [int]$parts[4]; $hh = [int]$parts[5]
      $parent = [PhoneFolder.PFNative]::GetParent($h)
      if ($parent -ne [IntPtr]::Zero) { [PhoneFolder.PFNative]::SetParent($h, [IntPtr]::Zero) | Out-Null }
      $style = [int64][PhoneFolder.PFNative]::GetWindowLong($h, $GWL_STYLE)
      $newStyle = ($style -band (-bnot [int64]$WS_CHILD)) -bor [int64]$WS_POPUP
      [PhoneFolder.PFNative]::SetWindowLong($h, $GWL_STYLE, [int]$newStyle) | Out-Null
      [PhoneFolder.PFNative]::SetWindowPos($h, [IntPtr](-2), $x, $y, $w, $hh, 0x0010 -bor 0x0020 -bor 0x0040) | Out-Null
      Reply $id 'ok detach'
    } catch { Reply $id ('fail detach ' + $_.Exception.Message) }
    continue
  }
  if ($cmd -eq 'position') {
    # position <hwnd> <x> <y> <w> <h>（子窗口坐标：父窗口客户区）
    try {
      $h = [IntPtr][long]$parts[1]
      $x = [int]$parts[2]; $y = [int]$parts[3]; $w = [int]$parts[4]; $hh = [int]$parts[5]
      [PhoneFolder.PFNative]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $w, $hh, 0x0004 -bor 0x0010) | Out-Null
      Reply $id 'ok position'
    } catch { Reply $id ('fail position ' + $_.Exception.Message) }
    continue
  }
  if ($cmd -eq 'show') {
    try {
      $h = [IntPtr][long]$parts[1]
      [PhoneFolder.PFNative]::ShowWindow($h, 5) | Out-Null
      # ShowWindow 可能把子窗口压到 z-order 底部（会掉到桌面图标/壁纸层下面），必须重新置顶
      [PhoneFolder.PFNative]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010 -bor 0x0040) | Out-Null
      [PhoneFolder.PFNative]::RedrawWindow($h, [IntPtr]::Zero, [IntPtr]::Zero, 0x0181) | Out-Null
      Reply $id 'ok show'
    } catch { Reply $id 'fail show' }
    continue
  }
  if ($cmd -eq 'raise') {
    try {
      $h = [IntPtr][long]$parts[1]
      [PhoneFolder.PFNative]::ShowWindow($h, 5) | Out-Null
      [PhoneFolder.PFNative]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010 -bor 0x0040) | Out-Null
      [PhoneFolder.PFNative]::RedrawWindow($h, [IntPtr]::Zero, [IntPtr]::Zero, 0x0181) | Out-Null
      Reply $id 'ok raise'
    } catch { Reply $id 'fail raise' }
    continue
  }
  if ($cmd -eq 'hide') {
    try { [PhoneFolder.PFNative]::ShowWindow([IntPtr][long]$parts[1], 0) | Out-Null; Reply $id 'ok hide' } catch { Reply $id 'fail hide' }
    continue
  }
  if ($cmd -eq 'bounds') {
    # bounds <hwnd>
    try {
      $h = [IntPtr][long]$parts[1]
      $rect = New-Object PhoneFolder.PFNative+RECT
      [PhoneFolder.PFNative]::GetWindowRect($h, [ref]$rect) | Out-Null
      $parent = [PhoneFolder.PFNative]::GetParent($h)
      $visible = [PhoneFolder.PFNative]::IsWindowVisible($h)
      $isWindow = [PhoneFolder.PFNative]::IsWindow($h)
      Reply $id ('bounds ' + $rect.Left + ' ' + $rect.Top + ' ' + $rect.Right + ' ' + $rect.Bottom + ' ' + $parent.ToInt64().ToString() + ' ' + [int]$visible + ' ' + [int]$isWindow)
    } catch { Reply $id ('fail bounds ' + $_.Exception.Message) }
    continue
  }
  if ($cmd -eq 'health') {
    # health <hwnd>
    try {
      $h = [IntPtr][long]$parts[1]
      $isWindow = [PhoneFolder.PFNative]::IsWindow($h)
      $parent = [PhoneFolder.PFNative]::GetParent($h)
      $parentAlive = [int]($parent -ne [IntPtr]::Zero -and [PhoneFolder.PFNative]::IsWindow($parent))
      $visible = [PhoneFolder.PFNative]::IsWindowVisible($h)
      Reply $id ('health ' + [int]$isWindow + ' ' + $parent.ToInt64().ToString() + ' ' + $parentAlive + ' ' + [int]$visible)
    } catch { Reply $id ('fail health ' + $_.Exception.Message) }
    continue
  }
  if ($parts.Length -lt 2) { continue }
  $hwnd = [IntPtr][long]$parts[1]
  switch ($cmd) {
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
let nextRequestId = 1;
const pending = new Map(); // id -> { resolve, timer }

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

function settle(id, result) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.resolve(result);
}

function handleLine(line) {
  if (line.startsWith('@')) {
    // @<id> <payload>
    const space = line.indexOf(' ');
    if (space <= 1) return;
    const id = line.slice(1, space);
    const payload = line.slice(space + 1);
    settle(id, payload);
    return;
  }
  if (!line.startsWith('state ')) return;
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
    child.on('exit', () => {
      child = null;
      for (const id of [...pending.keys()]) settle(id, null);
    });
    child.on('error', (err) => {
      log('native window helper error:', err.message);
      child = null;
      for (const id of [...pending.keys()]) settle(id, null);
    });
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

function request(command, timeoutMs = 2500) {
  const proc = ensureChild();
  if (!proc) return Promise.resolve(null);
  const id = String(nextRequestId++);
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(id, null), timeoutMs);
    if (timer.unref) timer.unref();
    pending.set(id, { resolve, timer });
    send(`@${id} ${command}`);
  });
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

// ---- 桌面级子窗口 ----------------------------------------------------
// 坐标参数均为物理像素（调用方负责 DIP → 物理转换），位置相对父窗口客户区。

async function attachWindow(win, x, y, width, height) {
  if (!win || win.isDestroyed()) return { ok: false, error: 'no-window' };
  const hwnd = hwndOf(win);
  if (!hwnd) return { ok: false, error: 'no-hwnd' };
  const reply = await request(`attach ${hwnd} ${Math.round(x)} ${Math.round(y)} ${Math.round(width)} ${Math.round(height)}`);
  if (!reply || !reply.startsWith('ok')) return { ok: false, error: reply || 'timeout' };
  const parent = reply.split(' ')[2] || '';
  return { ok: true, parent, hwnd };
}

async function detachWindow(win, x, y, width, height) {
  if (!win || win.isDestroyed()) return { ok: false, error: 'no-window' };
  const hwnd = hwndOf(win);
  if (!hwnd) return { ok: false, error: 'no-hwnd' };
  const reply = await request(`detach ${hwnd} ${Math.round(x)} ${Math.round(y)} ${Math.round(width)} ${Math.round(height)}`);
  return { ok: Boolean(reply && reply.startsWith('ok')), error: reply || 'timeout' };
}

function moveWindow(win, x, y, width, height) {
  if (!win || win.isDestroyed()) return;
  const hwnd = hwndOf(win);
  if (!hwnd) return;
  send(`position ${hwnd} ${Math.round(x)} ${Math.round(y)} ${Math.round(width)} ${Math.round(height)}`);
}

async function showWindow(win) {
  const hwnd = win && !win.isDestroyed() ? hwndOf(win) : null;
  if (hwnd) await request(`show ${hwnd}`);
}

// 子窗口的 ShowWindow 可能把它压到 z-order 底部（掉到桌面图标/壁纸层下面），
// 这里统一「显示 + 置顶 + 重绘」，保证桌面级瓦片一直在 DefView 之上。
async function raiseWindow(win) {
  const hwnd = win && !win.isDestroyed() ? hwndOf(win) : null;
  if (hwnd) await request(`raise ${hwnd}`);
}

async function hideWindow(win) {
  const hwnd = win && !win.isDestroyed() ? hwndOf(win) : null;
  if (hwnd) await request(`hide ${hwnd}`);
}

async function windowBounds(win) {
  const hwnd = win && !win.isDestroyed() ? hwndOf(win) : null;
  if (!hwnd) return null;
  const reply = await request(`bounds ${hwnd}`);
  if (!reply || !reply.startsWith('bounds ')) return null;
  const parts = reply.split(' ');
  return {
    left: Number(parts[1]),
    top: Number(parts[2]),
    right: Number(parts[3]),
    bottom: Number(parts[4]),
    parent: parts[5] || '0',
    visible: parts[6] === '1',
    alive: parts[7] === '1'
  };
}

async function windowHealth(win) {
  const hwnd = win && !win.isDestroyed() ? hwndOf(win) : null;
  if (!hwnd) return { alive: false, parent: '0', parentAlive: false, visible: false };
  const reply = await request(`health ${hwnd}`);
  if (!reply || !reply.startsWith('health ')) return { alive: false, parent: '0', parentAlive: false, visible: false };
  const parts = reply.split(' ');
  return {
    alive: parts[1] === '1',
    parent: parts[2] || '0',
    parentAlive: parts[3] === '1',
    visible: parts[4] === '1'
  };
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
  for (const id of [...pending.keys()]) settle(id, null);
}

module.exports = {
  bottomWindow,
  topmostWindow,
  normalWindow,
  focusDesktop,
  watchDesktopState,
  hwndOf,
  attachWindow,
  detachWindow,
  moveWindow,
  showWindow,
  raiseWindow,
  hideWindow,
  windowBounds,
  windowHealth,
  dispose
};
