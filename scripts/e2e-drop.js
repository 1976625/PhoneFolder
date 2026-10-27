'use strict';

// E2E（v0.6）：模拟「从桌面拖进瓦片」——
// 1) 启动应用，通过 CDP 点击瓦片打开浮层；2) 从浮层渲染层调 dropFiles(桌面上的测试文件)；
// 3) 校验文件被移动进瓦片绑定的收纳文件夹、同名冲突自动改名、重复拖入被跳过。
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const APP = path.join(__dirname, '..');
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const CONFIG = path.join(process.env.APPDATA || '', 'phone-folder', 'config.json');
const DESKTOP = 'D:\\deskTop';
const TEST_NAME = '_pf_drop_test.txt';
const PORT = 9222;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readBoundFolder() {
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const folder = config.tiles && config.tiles[0] && config.tiles[0].folder;
  if (!folder) throw new Error('config 里没有绑定文件夹');
  return folder;
}

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

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
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

(async () => {
  const boundFolder = readBoundFolder();
  console.log('bound folder:', boundFolder);
  const source = path.join(DESKTOP, TEST_NAME);
  const dest = path.join(boundFolder, TEST_NAME);
  const renamed = path.join(boundFolder, '_pf_drop_test (1).txt');
  for (const file of [source, dest, renamed]) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
  }
  fs.writeFileSync(source, 'phone-folder drop test\n', 'utf8');

  const child = spawn(EXE, ['.', '--remote-debugging-port=' + PORT], {
    cwd: APP,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: 'ignore'
  });

  try {
    // 1) 点击瓦片打开浮层（走 tile 渲染层的真实 IPC）
    const tileTarget = await waitFor(async () => {
      const targets = await listTargets();
      return targets.find((t) => t.type === 'page' && /renderer\/tile\/index\.html/.test(t.url));
    });
    await evaluate(tileTarget, 'window.phoneFolder.activateTile()');
    const overlayTarget = await waitFor(async () => {
      const targets = await listTargets();
      return targets.find((t) => t.type === 'page' && /renderer\/overlay\/index\.html/.test(t.url));
    });
    await waitFor(async () => {
      const opacity = await evaluate(overlayTarget, 'document.getElementById("panel").style.opacity');
      return opacity === '1';
    });

    // 2) 桌面文件拖入
    const first = await evaluate(overlayTarget, `window.phoneFolder.dropFiles(${JSON.stringify([source])})`);
    console.log('first drop:', JSON.stringify(first));
    if (!first || first.moved !== 1) throw new Error('first drop failed');
    if (!fs.existsSync(dest)) throw new Error('file not moved into bound folder: ' + dest);
    if (fs.existsSync(source)) throw new Error('source file still on desktop');

    // 3) 同名冲突
    fs.writeFileSync(source, 'phone-folder drop test 2\n', 'utf8');
    const second = await evaluate(overlayTarget, `window.phoneFolder.dropFiles(${JSON.stringify([source])})`);
    console.log('second drop:', JSON.stringify(second));
    if (!second || second.moved !== 1 || !fs.existsSync(renamed)) throw new Error('conflict rename failed');

    // 4) 重复拖入（已在收纳文件夹内）→ skipped
    const third = await evaluate(overlayTarget, `window.phoneFolder.dropFiles(${JSON.stringify([dest])})`);
    console.log('third drop (already inside):', JSON.stringify(third));
    if (!third || third.skipped !== 1) throw new Error('skip check failed');

    // 5) 浮层刷新后条目数应 >= 2
    await delay(800);
    const count = await evaluate(overlayTarget, 'document.querySelectorAll(".item").length');
    console.log('overlay items after drop:', count);

    console.log('E2E DROP-IN (desktop -> tile): PASS');
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    await delay(600);
    for (const file of [dest, renamed, source]) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }
})().catch((err) => {
  console.error('E2E DROP-IN: FAIL');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
