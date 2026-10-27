'use strict';

// E2E：浮层点标题重命名瓦片 + 面板隐藏 .lnk 后缀
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const APP = path.join(__dirname, '..');
const EXE = process.env.PF_APP_EXE || path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const CONFIG = path.join(process.env.APPDATA || '', 'phone-folder', 'config.json');
const PORT = 9223;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
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

function editTitle(overlayTarget, value) {
  return evaluate(overlayTarget, `(async () => {
    document.getElementById('title').click();
    await new Promise((r) => setTimeout(r, 80));
    const input = document.querySelector('.title-input');
    if (!input) return { ok: false, error: 'no title input' };
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return { ok: true };
  })()`);
}

(async () => {
  const storage = readConfig().tiles[0].folder;
  const configBackup = fs.readFileSync(CONFIG, 'utf8');
  const testLnk = path.join(storage, '_pf_suffix_test.lnk');
  if (!fs.existsSync(path.join('D:\\deskTop', 'Steam.lnk'))) throw new Error('缺少 Steam.lnk 测试样本');
  fs.copyFileSync(path.join('D:\\deskTop', 'Steam.lnk'), testLnk);

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
    await delay(900);

    // 1) 点标题 → 输入 → Enter
    const edit1 = await editTitle(overlayTarget, '我的收纳盒');
    if (!edit1 || !edit1.ok) throw new Error('标题输入框没有出现');
    await delay(900);
    const titleAfter = await evaluate(overlayTarget, 'document.getElementById("title").textContent');
    const configAfter = readConfig();
    console.log('title after rename:', titleAfter);
    console.log('config tile name:', configAfter.tiles[0].name);
    console.log('config tile display folder:', configAfter.tiles[0].folder);
    if (titleAfter !== '我的收纳盒') throw new Error('重命名后标题不正确: ' + titleAfter);
    if (configAfter.tiles[0].name !== '我的收纳盒') throw new Error('配置未保存瓦片名称');

    // 2) 瓦片标签同步改名字
    await delay(700);
    const tileLabel = await evaluate(tileTarget, 'document.getElementById("label").textContent');
    console.log('tile label after rename:', tileLabel);
    if (tileLabel !== '我的收纳盒') throw new Error('瓦片标签没有同步: ' + tileLabel);

    // 3) 面板条目名不显示 .lnk 后缀
    const names = await evaluate(overlayTarget, `[...document.querySelectorAll('.item .name')].map((el) => el.textContent)`);
    console.log('item names:', JSON.stringify(names));
    const suffixItem = names.find((name) => String(name).includes('_pf_suffix_test'));
    if (!suffixItem) throw new Error('测试快捷方式没有出现在面板里');
    if (/\.lnk$/i.test(suffixItem)) throw new Error('面板仍然显示 .lnk 后缀: ' + suffixItem);

    // 4) 清空名字 → 恢复文件夹名
    const edit2 = await editTitle(overlayTarget, '');
    if (!edit2 || !edit2.ok) throw new Error('第二次打开标题输入框失败');
    await delay(900);
    const titleRestored = await evaluate(overlayTarget, 'document.getElementById("title").textContent');
    const configRestored = readConfig();
    console.log('title after clear:', titleRestored, '| config name:', configRestored.tiles[0].name);
    if (configRestored.tiles[0].name) throw new Error('清空名称后配置仍残留 name');

    console.log('E2E RENAME + HIDE .LNK SUFFIX: PASS');
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    await delay(800);
    // 还原配置与测试文件
    try { fs.writeFileSync(CONFIG, configBackup, 'utf8'); } catch { /* ignore */ }
    for (const file of [testLnk]) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }
})().catch((err) => {
  console.error('E2E RENAME: FAIL');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});

