'use strict';

// E2E：拖动瓦片松手后吸附到 144×164 网格（固定 128 尺寸）
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const APP = path.join(__dirname, '..');
const EXE = process.env.PF_APP_EXE || path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const CONFIG = path.join(process.env.APPDATA || '', 'phone-folder', 'config.json');
const PORT = 9227;
const ORIGIN_X = 152; // 横向右对齐后的最左列（workArea 48 + 8 + 96 余量）
const ORIGIN_Y = 8;
const CELL_W = 136;
const CELL_H = 156;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
}

async function waitFor(fn, { timeout = 20000, interval = 200 } = {}) {
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

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('CDP timeout')); }, 15000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
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

(async () => {
  const configBackup = fs.readFileSync(CONFIG, 'utf8');
  const child = spawn(EXE, ['.', '--remote-debugging-port=' + PORT], {
    cwd: APP,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: 'ignore'
  });

  try {
    const tileTarget = await waitFor(async () => {
      const targets = await listTargets();
      return targets.find((t) => t.type === 'page' && /renderer\/tile\/index\.html/.test(t.url));
    });
    await delay(1300);

    const before = readConfig();
    const tile = before.tiles[1] || before.tiles[0];
    const center = { x: Math.round(tile.x + 64), y: Math.round(tile.y + 74) };
    const target = { x: center.x - 250, y: center.y + 120 };
    console.log('tile before:', JSON.stringify({ id: tile.id, x: tile.x, y: tile.y, size: tile.size }));

    // 把系统光标放到瓦片中心，让 main 的 dragStart 基准等于瓦片中心
    execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${center.x}, ${center.y})`
    ], { windowsHide: true });
    await delay(300);

    await evaluate(tileTarget, `(() => {
      window.phoneFolder.dragStart();
      window.phoneFolder.dragMove(${target.x}, ${target.y});
      window.phoneFolder.dragEnd();
      return true;
    })()`);
    await delay(1600);

    const after = readConfig();
    const beforeById = new Map(before.tiles.map((entry) => [entry.id, entry]));
    const moved = after.tiles.find((entry) => {
      const old = beforeById.get(entry.id);
      return old && (old.x !== entry.x || old.y !== entry.y);
    });
    if (!moved) throw new Error('拖动后没有瓦片位置变化');
    console.log('tile after:', JSON.stringify({ id: moved.id, x: moved.x, y: moved.y, size: moved.size }));
    if (moved.size !== 128) throw new Error('尺寸不是 128: ' + moved.size);
    if ((moved.x - ORIGIN_X) % CELL_W !== 0) throw new Error(`x=${moved.x} 不在网格上（origin ${ORIGIN_X}, cell ${CELL_W}）`);
    if ((moved.y - ORIGIN_Y) % CELL_H !== 0) throw new Error(`y=${moved.y} 不在网格上（origin ${ORIGIN_Y}, cell ${CELL_H}）`);

    const cells = after.tiles.map((entry) => `${Math.round((entry.x - ORIGIN_X) / CELL_W)}:${Math.round((entry.y - ORIGIN_Y) / CELL_H)}`);
    if (new Set(cells).size !== cells.length) throw new Error('两个瓦片吸附到同一格了: ' + JSON.stringify(cells));

    console.log('cells:', JSON.stringify(cells));
    console.log('E2E GRID SNAP: PASS');
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    await delay(800);
    try { fs.writeFileSync(CONFIG, configBackup, 'utf8'); } catch { /* ignore */ }
  }
})().catch((err) => {
  console.error('E2E GRID SNAP: FAIL');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});


