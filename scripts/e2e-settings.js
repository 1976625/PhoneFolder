'use strict';

// E2E（P4）：启动设置窗口 → 通过 CDP 调 settingsSave 加第二个瓦片 + 开自启 →
// 留出 8s 供外部截图/检查注册表 → 恢复单瓦片 + 关自启 → 退出。
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const fs = require('fs');
const APP = path.join(__dirname, '..');
const CONFIG = path.join(process.env.APPDATA || '', 'phone-folder', 'config.json');
const ORIGINAL = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9222;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, { timeout = 25000, interval = 300 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch { /* retry */ }
    await delay(interval);
  }
  throw new Error('waitFor timeout');
}

async function getSettingsTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await res.json();
  return targets.find((t) => t.type === 'page' && /settings\/index\.html/.test(t.url));
}

function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('CDP timeout')); }, 20000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true }
      }));
    });
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

const TWO_TILE_INPUT = {
  tiles: [
    { folder: ORIGINAL.tiles[0].folder, x: ORIGINAL.tiles[0].x, y: ORIGINAL.tiles[0].y, size: ORIGINAL.tiles[0].size },
    { folder: 'D:\\\\deskTop\\\\phoneS', x: 1600, y: 220, size: 96 }
  ],
  overlay: { dim: 0.46, blur: 30, background: 'wallpaper' },
  app: { launchAtLogin: true }
};

const SINGLE_TILE_INPUT = {
  tiles: ORIGINAL.tiles.map((tile) => ({ folder: tile.folder, x: tile.x, y: tile.y, size: tile.size, name: tile.name, order: tile.order })),
  overlay: ORIGINAL.overlay,
  app: { launchAtLogin: Boolean(ORIGINAL.app && ORIGINAL.app.launchAtLogin) }
};

function runPowerShell(scriptName, extraArgs = []) {
  return execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, scriptName), ...extraArgs
  ], { encoding: 'utf8', windowsHide: true });
}

function inspectState() {
  try {
    const registry = execFileSync('reg', [
      'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'PhoneFolder'
    ], { encoding: 'utf8', windowsHide: true });
    console.log('registry:', registry.trim());
  } catch {
    console.log('registry: PhoneFolder entry NOT FOUND');
  }
  try {
    console.log('windows:\n' + runPowerShell('win-enum.ps1', ['-Filter', 'PhoneFolder']).trim());
  } catch (err) {
    console.log('windows query failed:', err.message);
  }
  try {
    runPowerShell('capture-screen.ps1', ['-Out', path.join(__dirname, '..', 'shots', 'p4-settings-2tiles.png')]);
    console.log('screenshot: shots/p4-settings-2tiles.png');
  } catch (err) {
    console.log('capture failed:', err.message);
  }
}

(async () => {
  const child = spawn(EXE, ['.', '--open-settings', '--remote-debugging-port=' + PORT], {
    cwd: APP,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: 'ignore'
  });

  try {
    const target = await waitFor(getSettingsTarget);
    const snapshot = await evaluate(target, 'window.phoneFolder.settingsGet()');
    console.log('settings snapshot ok:', Boolean(snapshot && snapshot.config), 'maxTiles:', snapshot && snapshot.maxTiles);

    const save1 = await evaluate(target, `window.phoneFolder.settingsSave(${JSON.stringify(TWO_TILE_INPUT)})`);
    console.log('save two tiles + autostart:', JSON.stringify(save1));
    if (!save1 || !save1.ok) throw new Error('save1 failed');
    console.log('STATE1 READY');
    inspectState();
    await delay(8000);

    const save2 = await evaluate(target, `window.phoneFolder.settingsSave(${JSON.stringify(SINGLE_TILE_INPUT)})`);
    console.log('restore single tile:', JSON.stringify(save2));
    if (!save2 || !save2.ok) throw new Error('save2 failed');
    await delay(1500);
    console.log('STATE2 RESTORED');
    try {
      execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'PhoneFolder'], { encoding: 'utf8', windowsHide: true });
      console.log('registry after restore: STILL PRESENT');
    } catch {
      console.log('registry after restore: REMOVED');
    }
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
  }
})().catch((err) => {
  console.error('E2E SETTINGS: FAIL');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});


