'use strict';

// 诊断：把桌面上的 .lnk 快捷方式拖入收纳文件夹后，图标数据是否正常
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const APP = path.join(__dirname, '..');
const EXE = process.env.PF_APP_EXE || path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const CONFIG = path.join(process.env.APPDATA || '', 'phone-folder', 'config.json');
const DESKTOP = 'D:\\deskTop';
const PORT = 9222;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boundFolder() {
  return JSON.parse(fs.readFileSync(CONFIG, 'utf8')).tiles[0].folder;
}

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
  const storage = boundFolder();
  console.log('storage folder:', storage);
  const source = path.join(DESKTOP, '_pf_lnk_test.lnk');
  const dest = path.join(storage, '_pf_lnk_test.lnk');
  for (const file of [source, dest]) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
  }
  const sample = path.join(DESKTOP, 'Steam.lnk');
  fs.copyFileSync(sample, source);
  console.log('source lnk created:', source, 'size:', fs.statSync(source).size);

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

    const dropResult = await evaluate(overlayTarget, `window.phoneFolder.dropFiles(${JSON.stringify([source])})`);
    console.log('drop result:', JSON.stringify(dropResult));
    await delay(1200);

    const stat = fs.existsSync(dest) ? fs.statSync(dest) : null;
    console.log('moved file exists:', Boolean(stat), stat ? stat.size : 0);

    const icon = await evaluate(overlayTarget, `window.phoneFolder.getIcon(${JSON.stringify({
      path: dest,
      isDir: false,
      mtimeMs: stat ? stat.mtimeMs : 0
    })})`);
    console.log('icon payload:', icon ? JSON.stringify({ kind: icon.kind, dataUrlLength: icon.dataUrl ? icon.dataUrl.length : 0, head: icon.dataUrl ? icon.dataUrl.slice(0, 40) : null }) : null);

    // 看页面里这个条目最终有没有背景图
    const domState = await evaluate(overlayTarget, `(() => {
      const items = [...document.querySelectorAll('.item')];
      return items.map((el) => {
        const icon = el.querySelector('.icon');
        return { name: el.querySelector('.name')?.textContent, hasImage: icon?.classList.contains('has-image'), bg: icon ? getComputedStyle(icon).backgroundImage.slice(0, 60) : null };
      }).filter((x) => x.name && x.name.includes('_pf_lnk_test'));
    })()`);
    console.log('dom state:', JSON.stringify(domState));

    try {
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'capture-screen.ps1'), '-Out', path.join(APP, 'shots', 'diag-lnk.png')], { windowsHide: true });
      console.log('screenshot: shots/diag-lnk.png');
    } catch (err) {
      console.log('capture failed:', err.message);
    }
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    await delay(500);
    for (const file of [source, dest]) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
