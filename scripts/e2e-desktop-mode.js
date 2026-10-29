'use strict';

// E2E：桌面级瓦片（desktop child window）模式
// 验证：挂到 Progman 子窗口、Win+D 不被收起、点击能开浮层、拖动落格且窗口跟随
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const APP = path.join(__dirname, '..');
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const CONFIG = path.join(process.env.APPDATA || '', 'phone-folder', 'config.json');
const PORT = 9256;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 20000, interval = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* retry */ }
    await delay(interval);
  }
  throw new Error('waitFor timeout');
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('CDP timeout')); }, 20000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })));
    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      const result = msg.result && msg.result.result;
      if (msg.result && msg.result.exceptionDetails) return reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
      resolve(result ? result.value : undefined);
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP ws error')); });
  });
}

function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true }).toString();
}

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
}

function logTail(n = 30) {
  try {
    return fs.readFileSync(path.join(process.env.APPDATA || '', 'phone-folder', 'logs', 'app.log'), 'utf8').split('\n').slice(-n).join('\n');
  } catch {
    return '';
  }
}

const PROBE = `
Add-Type -Name DP -Namespace PF -MemberDefinition @"
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder t, int c);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
[DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
public delegate bool EnumProc(IntPtr h, IntPtr l);
"@
$script:progman=[IntPtr]::Zero
$cb=[PF.DP+EnumProc]{ param($h,$l) $sb=New-Object System.Text.StringBuilder 256; [PF.DP]::GetClassName($h,$sb,256)|Out-Null; if($sb.ToString() -eq 'Progman'){ $script:progman=$h; return $false }; $true }
[PF.DP]::EnumWindows($cb,[IntPtr]::Zero)|Out-Null
$script:tiles=@()
$cb2=[PF.DP+EnumProc]{ param($h,$l)
  $sb=New-Object System.Text.StringBuilder 256; [PF.DP]::GetClassName($h,$sb,256)|Out-Null
  if($sb.ToString() -eq 'Chrome_WidgetWin_1'){
    $r=New-Object PF.DP+RECT; [PF.DP]::GetWindowRect($h,[ref]$r)|Out-Null
    $style=[PF.DP]::GetWindowLong($h,-16)
    $script:tiles += [pscustomobject]@{ hwnd=$h.ToInt64(); left=$r.L; top=$r.T; right=$r.R; bottom=$r.B; child=((([int64]$style -band 0x40000000) -ne 0)); visible=[PF.DP]::IsWindowVisible($h); parent=([PF.DP]::GetParent($h)).ToInt64() }
  }
  $true }
[PF.DP]::EnumChildWindows($script:progman,$cb2,[IntPtr]::Zero)|Out-Null
$fg=[PF.DP]::GetForegroundWindow()
$fsb=New-Object System.Text.StringBuilder 256; [PF.DP]::GetClassName($fg,$fsb,256)|Out-Null
Write-Output ('PROGMAN=' + $script:progman.ToInt64())
Write-Output ('FOREGROUND=' + $fsb.ToString())
foreach($t in $script:tiles){ Write-Output ('TILE ' + ($t | ConvertTo-Json -Compress)) }
`;

function probeWindows() {
  const out = ps(PROBE);
  const progman = Number((out.match(/PROGMAN=(-?\d+)/) || [])[1] || 0);
  const foreground = (out.match(/FOREGROUND=(.*)/) || [])[1] || '';
  const tiles = out.split(/\r?\n/).filter((line) => line.startsWith('TILE ')).map((line) => JSON.parse(line.slice(5)));
  return { progman, foreground, tiles };
}

async function winD() {
  ps(`
Add-Type -Name KD -Namespace PK -MemberDefinition @"
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
"@
[PK.KD]::keybd_event(0x5B,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 70
[PK.KD]::keybd_event(0x44,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 70
[PK.KD]::keybd_event(0x44,0,2,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 70
[PK.KD]::keybd_event(0x5B,0,2,[UIntPtr]::Zero)
`);
  await delay(900);
}

function clickAt(x, y) {
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'mouse-click.ps1'), '-X', String(x), '-Y', String(y)], { windowsHide: true });
}

(async () => {
  const configBackup = fs.readFileSync(CONFIG, 'utf8');
  const cfg = readConfig();
  cfg.app = cfg.app || {};
  cfg.app.tileMode = 'desktop';
  fs.writeFileSync(CONFIG, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  const tileCount = cfg.tiles.length;

  const child = spawn(EXE, ['.', '--remote-debugging-port=' + PORT], {
    cwd: APP,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: 'ignore'
  });
  try {
    await waitFor(async () => {
      const targets = await listTargets();
      return targets.some((t) => t.type === 'page' && /renderer\/tile\/index\.html/.test(t.url));
    });
    await delay(2500);

    // 1. 挂载检查
    const probe1 = probeWindows();
    const attached = probe1.tiles.filter((t) => t.parent === probe1.progman && t.child && t.visible);
    if (attached.length !== tileCount) {
      throw new Error(`期望 ${tileCount} 个子窗口，实际 ${attached.length}（progman=${probe1.progman}）`);
    }
    console.log('attached children:', attached.length);

    // 2. Win+D 不被收起
    await winD();
    const probe2 = probeWindows();
    const visibleAfter = probe2.tiles.filter((t) => t.parent === probe1.progman && t.child && t.visible);
    console.log('after Win+D visible:', visibleAfter.length, 'foreground:', probe2.foreground);
    if (visibleAfter.length !== tileCount) throw new Error(`Win+D 后仍有 ${tileCount - visibleAfter.length} 个瓦片不可见`);
    await winD(); // 恢复
    await delay(600);

    // 3. 点击瓦片 → 打开浮层
    const targetTile = attached.slice().sort((a, b) => a.top - b.top)[0];
    const cx = Math.round((targetTile.left + targetTile.right) / 2);
    const cy = Math.round((targetTile.top + targetTile.bottom) / 2);
    const beforeOpenLog = logTail(200);
    clickAt(cx, cy);
    await delay(1600);
    const afterOpenLog = logTail(200);
    if (/opening overlay/.test(afterOpenLog.slice(Math.max(0, afterOpenLog.length - 2000))) === false && afterOpenLog === beforeOpenLog) {
      throw new Error('点击瓦片后没有打开浮层（日志无变化）');
    }
    if (!/opening overlay/.test(afterOpenLog)) throw new Error('点击瓦片后日志里没有 opening overlay');
    console.log('click opens overlay: ok');
    clickAt(130, 130); // 点面板外收起
    await delay(900);

    // 4. 拖动落格（用 tile 页面的 dragStart/dragMove/dragEnd 驱动主进程逻辑）
    const beforeCfg = readConfig();
    const beforeMap = new Map(beforeCfg.tiles.map((tile) => [tile.id, { x: tile.x, y: tile.y }]));
    const tileTarget = await waitFor(async () => {
      const targets = await listTargets();
      return targets.find((t) => t.type === 'page' && /renderer\/tile\/index\.html/.test(t.url));
    });
    const info = await evaluate(tileTarget, `(() => {
      const r = document.querySelector('.thumbs') ? document.querySelector('.thumbs').getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
      const offX = window.screenX + (window.outerWidth - window.innerWidth) / 2;
      const offY = window.screenY + (window.outerHeight - window.innerHeight) / 2;
      return { x: Math.round(offX + r.x + r.width / 2), y: Math.round(offY + r.y + r.height / 2) };
    })()`);
    await evaluate(tileTarget, `(() => {
      window.phoneFolder.dragStart();
      window.phoneFolder.dragMove(${info.x - 220}, ${info.y + 260});
      window.phoneFolder.dragEnd();
      return true;
    })()`);
    await delay(1600);
    const afterCfg = readConfig();
    const moved = afterCfg.tiles.find((tile) => {
      const old = beforeMap.get(tile.id);
      return old && (old.x !== tile.x || old.y !== tile.y);
    });
    if (!moved) throw new Error('拖动后配置坐标没有变化');
    if ((moved.x - 94) % 130 !== 0 || (moved.y - 8) % 148 !== 0) {
      throw new Error(`坐标不在网格上: ${moved.x},${moved.y}`);
    }
    const probe3 = probeWindows();
    const movedWin = probe3.tiles.find((t) => Math.abs(t.left - moved.x) <= 1 && Math.abs(t.top - moved.y) <= 1);
    if (!movedWin) throw new Error(`窗口没有跟到 ${moved.x},${moved.y}（moved id=${moved.id}）`);
    console.log('drag snap + native move: ok', JSON.stringify({ id: moved.id, x: moved.x, y: moved.y }));
    console.log('E2E DESKTOP MODE: PASS');
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    await delay(900);
    try { fs.writeFileSync(CONFIG, configBackup, 'utf8'); } catch { /* ignore */ }
  }
})().catch((err) => {
  console.error('E2E DESKTOP MODE: FAIL');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});

