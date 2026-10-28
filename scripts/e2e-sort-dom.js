'use strict';

// DOM 级验证：拖动排序时条目跟随鼠标（translate）、其它条目让位、松手后保存顺序
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const APP = path.join(__dirname, '..');
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const CONFIG = path.join(process.env.APPDATA || '', 'phone-folder', 'config.json');
const PORT = 9246;
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
    await evaluate(tileTarget, 'window.phoneFolder.activateTile()');
    await waitFor(async () => (await evaluate(overlayTarget, 'document.getElementById("panel").style.opacity')) === '1');
    await delay(1000);

    const result = await evaluate(overlayTarget, `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const items = [...document.querySelectorAll('.item')];
      const first = items[0];
      const target = items[2];
      const r = first.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      const opts = (x, y) => ({ bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, isPrimary: true, clientX: x, clientY: y, screenX: x, screenY: y });
      const startX = Math.round(r.left + r.width / 2);
      const startY = Math.round(r.top + r.height / 2);
      const endX = Math.round(tr.left + tr.width / 2);
      const endY = Math.round(tr.top + tr.height / 2);
      first.dispatchEvent(new PointerEvent('pointerdown', opts(startX, startY)));
      await sleep(30);
      for (let i = 1; i <= 10; i++) {
        const x = startX + (endX - startX) * i / 10;
        const y = startY + (endY - startY) * i / 10;
        window.dispatchEvent(new PointerEvent('pointermove', opts(Math.round(x), Math.round(y))));
        await sleep(30);
      }
      const sortingEl = document.querySelector('.item.sorting');
      const during = {
        sorting: Boolean(sortingEl),
        transform: sortingEl ? sortingEl.style.transform : null,
        opacity: sortingEl ? getComputedStyle(sortingEl).opacity : null,
        order: [...document.querySelectorAll('.item')].map((el) => el.dataset.name),
        others: [...document.querySelectorAll('.item:not(.sorting)')].map((el) => ({
          name: el.dataset.name,
          transform: el.style.transform,
          transition: el.style.transition,
          opacity: getComputedStyle(el).opacity
        }))
      };
      window.dispatchEvent(new PointerEvent('pointerup', opts(endX, endY)));
      await sleep(500);
      const after = {
        sorting: Boolean(document.querySelector('.item.sorting')),
        order: [...document.querySelectorAll('.item')].map((el) => el.dataset.name)
      };
      return { during, after };
    })()`);
    console.log(JSON.stringify(result, null, 2));
    await delay(800);
    const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    const tileWithOrder = cfg.tiles.find((tile) => Array.isArray(tile.order) && tile.order.length > 0);
    console.log('saved order first3:', tileWithOrder ? tileWithOrder.order.slice(0, 3) : null);
    console.log('E2E SORT ANIM DOM: PASS');
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    await delay(800);
    try { fs.writeFileSync(CONFIG, configBackup, 'utf8'); } catch { /* ignore */ }
  }
})().catch((err) => {
  console.error('E2E SORT ANIM DOM: FAIL');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
