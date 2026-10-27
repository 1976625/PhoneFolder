'use strict';

// E2E：通过 CDP 在 overlay renderer 里调用 window.phoneFolder.dropFiles()，
// 验证「拖入 → 移进绑定文件夹（重名自动 (n)）→ 刷新」整条链路（不含 OS 拖拽手势）。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const APP = path.join(__dirname, '..');
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9222;
const TARGET_FOLDER = 'D:\\deskTop';
const TEST_NAME = '_pf_drop_test.txt';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, { timeout = 15000, interval = 300 } = {}) {
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

async function getOverlayTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await res.json();
  return targets.find((t) => t.type === 'page' && /overlay\/index\.html/.test(t.url));
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
      if (msg.result && msg.result.exceptionDetails) {
        return reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
      }
      resolve(result ? result.value : undefined);
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP ws error')); });
  });
}

(async () => {
  const tmpDir = path.join(os.tmpdir(), `pf-e2e-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const source = path.join(tmpDir, TEST_NAME);
  fs.writeFileSync(source, 'phone-folder drop test\n', 'utf8');

  const dest = path.join(TARGET_FOLDER, TEST_NAME);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);

  const child = spawn(EXE, ['.', '--remote-debugging-port=' + PORT], {
    cwd: APP,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: 'ignore'
  });

  try {
    const target = await waitFor(getOverlayTarget);
    const first = await evaluate(target, `window.phoneFolder.dropFiles(${JSON.stringify([source])})`);
    console.log('first drop:', JSON.stringify(first));
    if (!first || first.moved !== 1) throw new Error('first drop failed');
    if (!fs.existsSync(dest)) throw new Error('file not moved to target folder');

    // 同名冲突：再放一个同名文件，应改成 "_pf_drop_test (1).txt"
    fs.writeFileSync(source, 'phone-folder drop test 2\n', 'utf8');
    const second = await evaluate(target, `window.phoneFolder.dropFiles(${JSON.stringify([source])})`);
    console.log('second drop:', JSON.stringify(second));
    const renamed = path.join(TARGET_FOLDER, '_pf_drop_test (1).txt');
    if (!second || second.moved !== 1) throw new Error('second drop failed');
    if (!fs.existsSync(renamed)) throw new Error('conflict rename missing: ' + renamed);

    // 重复拖同一个已在文件夹内的文件 → skipped
    const third = await evaluate(target, `window.phoneFolder.dropFiles(${JSON.stringify([dest])})`);
    console.log('third drop (already inside):', JSON.stringify(third));
    if (!third || third.skipped !== 1) throw new Error('skip check failed');

    console.log('E2E DROP-IN: PASS');
    console.log(JSON.stringify({ dest, renamed }));
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    await delay(600);
    for (const file of [dest, path.join(TARGET_FOLDER, '_pf_drop_test (1).txt')]) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})().catch((err) => {
  console.error('E2E DROP-IN: FAIL');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
