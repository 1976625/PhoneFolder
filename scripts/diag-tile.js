'use strict';

const { spawn, execFileSync } = require('child_process');
const path = require('path');

const APP = path.join(__dirname, '..');
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9228;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function list() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('timeout')); }, 15000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      resolve(msg.result && msg.result.result && msg.result.result.value);
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ws error')); });
  });
}

(async () => {
  const child = spawn(EXE, ['.', '--remote-debugging-port=' + PORT], {
    cwd: APP,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: 'ignore'
  });
  try {
    let target = null;
    for (let i = 0; i < 50 && !target; i += 1) {
      await delay(300);
      const targets = await list();
      target = targets.find((t) => t.type === 'page' && /renderer\/tile\/index\.html/.test(t.url));
    }
    await delay(1500);
    const info = await evaluate(target, `(() => {
      const root = document.documentElement;
      const thumbs = document.getElementById('thumbs');
      const label = document.getElementById('label');
      const r = thumbs.getBoundingClientRect();
      const lr = label.getBoundingClientRect();
      return {
        tileSizeVar: getComputedStyle(root).getPropertyValue('--tile-size'),
        thumbsRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        labelRect: { x: Math.round(lr.x), y: Math.round(lr.y), w: Math.round(lr.width), h: Math.round(lr.height) },
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight
      };
    })()`);
    console.log(JSON.stringify(info, null, 2));
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
  }
})().catch((err) => { console.error(err && err.stack ? err.stack : String(err)); process.exit(1); });
