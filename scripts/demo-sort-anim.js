'use strict';

// 演示/验证：面板内拖动排序时，条目悬浮跟随 + 其它条目平滑让位
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const APP = path.join(__dirname, '..');
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const CONFIG = path.join(process.env.APPDATA || '', 'phone-folder', 'config.json');
const PORT = 9245;
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
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('CDP timeout')); }, 15000);
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

function capture(name) {
  execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'capture-screen.ps1'),
    '-Out', path.join(APP, 'shots', name)
  ], { windowsHide: true });
}

(async () => {
  const configBackup = fs.readFileSync(CONFIG, 'utf8');
  const noSpawn = process.env.PF_NO_SPAWN === '1';
  const child = noSpawn ? null : spawn(EXE, ['.', '--remote-debugging-port=' + PORT], {
    cwd: APP,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: 'ignore'
  });
  try {
    const tileTarget = await waitFor(async () => {
      const targets = await listTargets();
      return targets.find((t) => t.type === 'page' && /renderer\/tile\/index\.html/.test(t.url));
    });
    const overlayTarget = await waitFor(async () => {
      const targets = await listTargets();
      return targets.find((t) => t.type === 'page' && /renderer\/overlay\/index\.html/.test(t.url));
    });
    await evaluate(tileTarget, 'window.phoneFolder.activateTile()');
    await waitFor(async () => (await evaluate(overlayTarget, 'document.getElementById("panel").style.opacity')) === '1');
    await delay(1200);

    const info = await evaluate(overlayTarget, `(() => {
      const items = [...document.querySelectorAll('.item')];
      if (items.length < 3) return null;
      const offX = window.screenX + (window.outerWidth - window.innerWidth) / 2;
      const offY = window.screenY + (window.outerHeight - window.innerHeight) / 2;
      const center = (el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(offX + r.x + r.width / 2), y: Math.round(offY + r.y + r.height / 2) };
      };
      return { from: center(items[0]), to: center(items[2]) };
    })()`);
    if (!info) throw new Error('第一页不足 3 个条目');

    const ps = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, 'mouse-hold-drag.ps1'),
      '-X1', String(info.from.x), '-Y1', String(info.from.y),
      '-X2', String(info.to.x), '-Y2', String(info.to.y),
      '-HoldMs', '1600'
    ], { windowsHide: true, stdio: 'ignore' });

    await delay(1100);
    capture('sort-drag-hold.png');
    await new Promise((resolve) => ps.on('exit', resolve));
    await delay(700);
    capture('sort-drag-done.png');
    console.log('demo captured: shots/sort-drag-hold.png, shots/sort-drag-done.png');
  } finally {
    if (child) {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    }
    await delay(700);
    try { fs.writeFileSync(CONFIG, configBackup, 'utf8'); } catch { /* ignore */ }
  }
})().catch((err) => {
  console.error('DEMO SORT: FAIL');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});



