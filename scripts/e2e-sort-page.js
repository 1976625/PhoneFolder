'use strict';

// E2E：面板内拖动到左右边缘 → 自动翻页，松手后条目插入到目标页（顺序保存）
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const APP = path.join(__dirname, '..');
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const CONFIG = path.join(process.env.APPDATA || '', 'phone-folder', 'config.json');
const PORT = 9248;
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

async function openFirstMultiPageOverlay(tileTargets, overlayTarget) {
  for (const target of tileTargets) {
    await evaluate(target, 'window.phoneFolder.activateTile()');
    await waitFor(async () => (await evaluate(overlayTarget, 'document.getElementById("panel").style.opacity')) === '1');
    const pages = await evaluate(overlayTarget, `document.querySelectorAll('.dots .dot').length`);
    if (pages > 1) return { target, pages };
    await evaluate(overlayTarget, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await delay(500);
  }
  return null;
}

(async () => {
  const configBackup = fs.readFileSync(CONFIG, 'utf8');
  const child = spawn(EXE, ['.', '--remote-debugging-port=' + PORT], {
    cwd: APP,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: 'ignore'
  });
  try {
    const tileTargets = await waitFor(async () => {
      const targets = await listTargets();
      const tiles = targets.filter((t) => t.type === 'page' && /renderer\/tile\/index\.html/.test(t.url));
      return tiles.length ? tiles : null;
    });
    const overlayTarget = await waitFor(async () => {
      const targets = await listTargets();
      return targets.find((t) => t.type === 'page' && /renderer\/overlay\/index\.html/.test(t.url));
    });
    const opened = await openFirstMultiPageOverlay(tileTargets, overlayTarget);
    if (!opened) throw new Error('没有超过 9 项的瓦片，无法测翻页');
    await delay(800);

    const result = await evaluate(overlayTarget, `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const items = [...document.querySelectorAll('.item')];
      const first = items[0];
      const dragName = first.dataset.name;
      const r = first.getBoundingClientRect();
      const panel = document.getElementById('panel').getBoundingClientRect();
      const opts = (x, y) => ({ bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, isPrimary: true, clientX: x, clientY: y, screenX: x, screenY: y });
      const startX = Math.round(r.left + r.width / 2);
      const startY = Math.round(r.top + r.height / 2);
      const edgeX = Math.round(panel.right - 24);
      window.__pageDemo = { edgeX, edgeY: startY };
      first.dispatchEvent(new PointerEvent('pointerdown', opts(startX, startY)));
      await sleep(30);
      for (let i = 1; i <= 8; i++) {
        const x = startX + (edgeX - startX) * i / 8;
        window.dispatchEvent(new PointerEvent('pointermove', opts(Math.round(x), startY)));
        await sleep(30);
      }
      await sleep(700); // 等待边缘停留触发的翻页
      const afterFlip = {
        ghost: Boolean(document.querySelector('.ghost-item')),
        pageLabel: document.querySelector('.dots .dot.active') ? [...document.querySelectorAll('.dots .dot')].indexOf(document.querySelector('.dots .dot.active')) : -1,
        dots: document.querySelectorAll('.dots .dot').length,
        names: [...document.querySelectorAll('.item')].map((el) => el.dataset.name)
      };
      window.dispatchEvent(new PointerEvent('pointerup', opts(edgeX, startY)));
      await sleep(600);
      return {
        dragName,
        afterFlip,
        droppedPage: (() => {
          const active = document.querySelector('.dots .dot.active');
          return active ? [...document.querySelectorAll('.dots .dot')].indexOf(active) : -1;
        })(),
        droppedNames: [...document.querySelectorAll('.item')].map((el) => el.dataset.name),
        ghostGone: !document.querySelector('.ghost-item')
      };
    })()`);
    console.log(JSON.stringify(result, null, 2));

    await delay(800);
    const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    const containing = cfg.tiles.find((tile) => Array.isArray(tile.order) && tile.order.includes(result.dragName));
    const idx = containing ? containing.order.indexOf(result.dragName) : -1;
    console.log('saved index of dragged item:', idx);

    if (!result.afterFlip.ghost) throw new Error('拖到边缘后没有出现 ghost');
    if (result.droppedPage < 1) throw new Error('没有翻到第 2 页');
    if (!result.ghostGone) throw new Error('松手后 ghost 没有清理');
    if (idx < 9) throw new Error(`拖动条目没有落到第 2 页（index=${idx}）`);
    console.log('E2E SORT PAGE FLIP: PASS');
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    await delay(800);
    try { fs.writeFileSync(CONFIG, configBackup, 'utf8'); } catch { /* ignore */ }
  }
})().catch((err) => {
  console.error('E2E SORT PAGE FLIP: FAIL');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});





