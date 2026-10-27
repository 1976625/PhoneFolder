'use strict';

// E2E：从浮层把文件拖到桌面（真实鼠标拖拽）
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const APP = path.join(__dirname, '..');
const EXE = process.env.PF_APP_EXE || path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const CONFIG = path.join(process.env.APPDATA || '', 'phone-folder', 'config.json');
const DESKTOP = 'D:\\deskTop';
const PORT = 9224;
const TEST_NAME = '_pf_dragout_test.lnk';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, { timeout = 25000, interval = 250 } = {}) {
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
  const storage = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tiles[0].folder;
  const source = path.join(storage, TEST_NAME);
  const dropped = path.join(DESKTOP, TEST_NAME);
  for (const file of [source, dropped]) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
  }
  fs.copyFileSync(path.join(DESKTOP, 'Steam.lnk'), source);

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
    const overlayTarget = await waitFor(async () => {
      const targets = await listTargets();
      return targets.find((t) => t.type === 'page' && /renderer\/overlay\/index\.html/.test(t.url));
    });
    await evaluate(tileTarget, 'window.phoneFolder.activateTile()');
    await waitFor(async () => (await evaluate(overlayTarget, 'document.getElementById("panel").style.opacity')) === '1');
    await delay(1200);

    const info = await evaluate(overlayTarget, `(() => {
      const items = [...document.querySelectorAll('.item')];
      const btn = items.find((el) => (el.querySelector('.name')?.textContent || '') === '_pf_dragout_test');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      const offX = window.screenX + (window.outerWidth - window.innerWidth) / 2;
      const offY = window.screenY + (window.outerHeight - window.innerHeight) / 2;
      return { x: Math.round(offX + r.x + r.width / 2), y: Math.round(offY + r.y + r.height / 2), count: items.length };
    })()`);
    console.log('item screen position:', JSON.stringify(info));
    if (!info) throw new Error('浮层里没找到测试文件');

    // 目标：桌面空白处
    const targetX = 400;
    const targetY = 760;
    execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, 'mouse-drag.ps1'),
      '-X1', String(info.x), '-Y1', String(info.y),
      '-X2', String(targetX), '-Y2', String(targetY)
    ], { windowsHide: true });
    await delay(1800);

    const existsDesktop = fs.existsSync(dropped);
    const existsStorage = fs.existsSync(source);
    console.log('result: desktop exists =', existsDesktop, '| storage exists =', existsStorage);
    if (!existsDesktop) throw new Error('拖到桌面后文件没有出现（drag-out 失败）');
    if (existsStorage) throw new Error('文件仍留在收纳文件夹（移动失败）');
    console.log('E2E DRAG-OUT: PASS');
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    await delay(700);
    for (const file of [source, dropped]) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }
})().catch((err) => {
  console.error('E2E DRAG-OUT: FAIL');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
