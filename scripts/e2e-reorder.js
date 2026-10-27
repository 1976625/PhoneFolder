'use strict';

// E2E：浮层内部拖动 = 排序（不关闭浮层），顺序保存到配置并在重新打开后保持
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const APP = path.join(__dirname, '..');
const EXE = process.env.PF_APP_EXE || path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const CONFIG = path.join(process.env.APPDATA || '', 'phone-folder', 'config.json');
const PORT = 9226;
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
    const overlayTarget = await waitFor(async () => {
      const targets = await listTargets();
      return targets.find((t) => t.type === 'page' && /renderer\/overlay\/index\.html/.test(t.url));
    });

    const openOverlay = async () => {
      await evaluate(tileTarget, 'window.phoneFolder.activateTile()');
      await waitFor(async () => (await evaluate(overlayTarget, 'document.getElementById("panel").style.opacity')) === '1');
      await delay(1100);
    };

    await openOverlay();
    const info = await evaluate(overlayTarget, `(() => {
      const items = [...document.querySelectorAll('.item')];
      if (items.length < 3) return null;
      const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
      const offX = window.screenX + (window.outerWidth - window.innerWidth) / 2;
      const offY = window.screenY + (window.outerHeight - window.innerHeight) / 2;
      const a = center(items[0]);
      const b = center(items[2]);
      return {
        names: items.map((el) => el.dataset.name),
        from: { x: Math.round(offX + a.x), y: Math.round(offY + a.y) },
        to: { x: Math.round(offX + b.x), y: Math.round(offY + b.y) }
      };
    })()`);
    if (!info) throw new Error('第一页项目不足 3 个，无法测试排序');
    console.log('before order:', JSON.stringify(info.names.slice(0, 4)));

    execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, 'mouse-drag.ps1'),
      '-X1', String(info.from.x), '-Y1', String(info.from.y),
      '-X2', String(info.to.x), '-Y2', String(info.to.y)
    ], { windowsHide: true });
    await delay(1400);

    const panelOpacity = await evaluate(overlayTarget, 'document.getElementById("panel").style.opacity');
    if (panelOpacity !== '1') throw new Error('内部拖动把浮层关掉了（应该保持打开）');
    const afterNames = await evaluate(overlayTarget, `[...document.querySelectorAll('.item')].map((el) => el.dataset.name)`);
    console.log('after order:', JSON.stringify(afterNames.slice(0, 4)));
    if (JSON.stringify(afterNames) === JSON.stringify(info.names)) throw new Error('内部拖动后顺序没有变化');

    const config = readConfig();
    const tileWithOrder = config.tiles.find((tile) => Array.isArray(tile.order) && tile.order.length > 0);
    if (!tileWithOrder) throw new Error('配置里没有保存 order');
    console.log('saved order:', JSON.stringify(tileWithOrder.order.slice(0, 4)));
    if (tileWithOrder.order[0] !== afterNames[0]) throw new Error('保存的顺序和面板显示不一致');

    // 关闭后重新打开，顺序应保持
    await evaluate(overlayTarget, 'window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
    await waitFor(async () => (await evaluate(overlayTarget, 'document.getElementById("panel").style.opacity')) === '0');
    await delay(700);
    await openOverlay();
    const reopened = await evaluate(overlayTarget, `[...document.querySelectorAll('.item')].map((el) => el.dataset.name)`);
    console.log('reopened order:', JSON.stringify(reopened.slice(0, 4)));
    if (reopened[0] !== tileWithOrder.order[0]) throw new Error('重新打开后顺序没有保持');

    console.log('E2E REORDER (drag inside panel = sort): PASS');
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    await delay(800);
    try { fs.writeFileSync(CONFIG, configBackup, 'utf8'); } catch { /* ignore */ }
  }
})().catch((err) => {
  console.error('E2E REORDER: FAIL');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
