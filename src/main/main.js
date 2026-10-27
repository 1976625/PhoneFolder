'use strict';

const { app, ipcMain, Menu, screen, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

const { loadConfig, saveConfig } = require('./services/config');
const { init: initLogger, log } = require('./services/logger');
const { createTileWindow, LABEL_HEIGHT } = require('./windows/tile-window');
const { OverlayWindow } = require('./windows/overlay-window');
const { createBackdropWindow } = require('./windows/backdrop-window');
const { makeFakeItems } = require('./services/fake-data');
const { warmCapture, warmWallpaper, mode: backgroundMode, readWallpaperDataUrl } = require('./services/background');

const argv = process.argv.slice(1);
const isShot = argv.includes('--shot') || process.env.PF_SHOT === '1';
const isHold = argv.includes('--hold');
const isStage = isShot || isHold;

const ROOT = path.join(__dirname, '..', '..');
// PF_SHOT_DIR 可把截图放进 shots/ 的子目录，便于对比不同方案（如 capture 模式）
const SHOT_DIR = path.join(ROOT, 'shots', process.env.PF_SHOT_DIR || '');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 按当前背景方案预热缓存（启动 / 悬停 / 关闭后各调一次）
function warmBackground({ force = false } = {}) {
  const m = backgroundMode();
  if (m === 'capture') return warmCapture(screen.getPrimaryDisplay(), { force });
  if (m === 'wallpaper') return warmWallpaper();
  return Promise.resolve(null);
}

let config = null;
let tileWin = null;
let overlay = null;
let backdrop = null;


/* ------------------------------------------------------------------ */
/* payload                                                             */
/* ------------------------------------------------------------------ */
function buildTilePayload(tile) {
  const { folderName, items } = makeFakeItems(tile);
  return {
    tileId: tile.id,
    folderName,
    preview: items.slice(0, 4).map(({ emoji, hue }) => ({ emoji, hue }))
  };
}

function buildOverlayPayload(tile) {
  const { folderName, items } = makeFakeItems(tile);
  const displayBounds = screen.getPrimaryDisplay().bounds;
  const bounds = tileWin.getBounds();
  return {
    tileId: tile.id,
    openedAt: Date.now(),
    tileRect: {
      x: bounds.x - displayBounds.x,
      y: bounds.y - displayBounds.y,
      width: bounds.width,
      height: Math.max(1, bounds.height - LABEL_HEIGHT)
    },
    folderName,
    items
  };
}

/* ------------------------------------------------------------------ */
/* 打开浮层                                                             */
/* ------------------------------------------------------------------ */
async function openOverlay(tileId) {
  const tile = config.tiles.find((t) => t.id === tileId) || config.tiles[0];
  const startedAt = Date.now();
  const payload = buildOverlayPayload(tile);
  log('opening overlay', { tileId: tile.id, backgroundMode: overlay.mode, tileRect: payload.tileRect });
  overlay.preparePayload(payload);
  await overlay.open(payload);
  log('overlay show() done in', Date.now() - startedAt, 'ms');
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */
function registerIpc() {
  ipcMain.on('tile:activate', (event) => {
    if (!tileWin || event.sender !== tileWin.webContents) return;
    openOverlay(config.tiles[0].id).catch((err) => log('open overlay failed:', err.message));
  });

  ipcMain.on('overlay:hidden', (event) => {
    if (!overlay || !overlay.win || event.sender !== overlay.win.webContents) return;
    overlay.hide();
    log('overlay hidden');
    // 关闭后异步刷新背景缓存（壁纸可能变了），下次打开零等待
    warmBackground();
  });

  ipcMain.on('tile:hover', (event) => {
    if (!tileWin || event.sender !== tileWin.webContents) return;
    warmBackground();
  });

  ipcMain.on('tile:contextmenu', (event) => {
    if (!tileWin || event.sender !== tileWin.webContents) return;
    const menu = Menu.buildFromTemplate([
      {
        label: '展开文件夹',
        click: () => openOverlay(config.tiles[0].id).catch((err) => log('open overlay failed:', err.message))
      },
      { type: 'separator' },
      { label: '退出 PhoneFolder', click: () => app.quit() }
    ]);
    menu.popup({ window: tileWin });
  });

  // 拖动瓦片：主进程按「鼠标屏幕坐标 - 按下时偏移」实时 setPosition，避免渲染层拿不到窗口坐标
  let dragState = null;
  ipcMain.on('tile:drag-start', (event) => {
    if (!tileWin || event.sender !== tileWin.webContents) return;
    dragState = {
      base: tileWin.getPosition(),
      cursor: screen.getCursorScreenPoint()
    };
  });
  ipcMain.on('tile:drag-move', (event, x, y) => {
    if (!tileWin || event.sender !== tileWin.webContents || !dragState) return;
    const display = screen.getPrimaryDisplay().bounds;
    const bounds = tileWin.getBounds();
    const nextX = dragState.base[0] + Math.round(x - dragState.cursor.x);
    const nextY = dragState.base[1] + Math.round(y - dragState.cursor.y);
    const clampedX = Math.min(Math.max(nextX, display.x), display.x + display.width - bounds.width);
    const clampedY = Math.min(Math.max(nextY, display.y), display.y + display.height - bounds.height);
    tileWin.setPosition(clampedX, clampedY);
  });
  ipcMain.on('tile:drag-end', (event) => {
    if (!tileWin || event.sender !== tileWin.webContents) return;
    dragState = null;
    const [x, y] = tileWin.getPosition();
    config.tiles[0].x = x;
    config.tiles[0].y = y;
    saveConfig(config);
    log('tile moved', { x, y });
  });

  ipcMain.on('log', (_event, message) => log('[renderer]', message));

  ipcMain.handle('config:get', () => config);
}

/* ------------------------------------------------------------------ */
/* 截图（--shot）                                                       */
/* ------------------------------------------------------------------ */
async function captureScreen(name) {
  const display = screen.getPrimaryDisplay();
  const scale = display.scaleFactor || 1;
  const width = Math.round(display.bounds.width * scale);
  const height = Math.round(display.bounds.height * scale);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false
  });
  const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!source) throw new Error('no screen source');
  const file = path.join(SHOT_DIR, name);
  fs.writeFileSync(file, source.thumbnail.toPNG());
  log('screenshot saved', file);
  return file;
}

async function runShot(tile) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  try {
    // 只清理本流程产出的编号截图，保留调试用图片
    for (const name of fs.readdirSync(SHOT_DIR)) {
      if (/^\d\d-.*\.png$/.test(name)) fs.unlinkSync(path.join(SHOT_DIR, name));
    }
  } catch { /* ignore */ }

  await delay(500);
  await captureScreen('01-tile.png');

  // 先准备好背景缓存，让截图与真实打开路径一致
  await warmBackground({ force: true });
  const payload = buildOverlayPayload(tile);
  overlay.preparePayload(payload);
  await overlay.open(payload);
  await delay(60);
  await captureScreen('02-overlay-mid.png');
  await delay(850);
  await captureScreen('03-overlay-open.png');

  overlay.requestClose();
  await delay(650);
  await captureScreen('04-closed.png');

  log('shot sequence complete', SHOT_DIR);
  app.exit(0);
}

/* ------------------------------------------------------------------ */
/* 启动                                                                 */
/* ------------------------------------------------------------------ */
async function bootstrap() {
  initLogger();
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('local.phonefolder');

  const display = screen.getPrimaryDisplay();
  log('display', {
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor
  });

  config = loadConfig();
  log('config loaded', config);

  overlay = new OverlayWindow();
  registerIpc();

  if (isStage) {
    backdrop = await createBackdropWindow(readWallpaperDataUrl());
    log('backdrop window ready');
    await delay(300);
    await overlay.ensure();
  }

  const tile = config.tiles[0];
  tileWin = createTileWindow(tile);
  const tileShown = new Promise((resolve) => tileWin.once('ready-to-show', resolve));
  tileWin.webContents.once('did-finish-load', () => {
    tileWin.webContents.send('tile:init', buildTilePayload(tile));
    log('tile renderer loaded', tileWin.getBounds());
  });
  tileWin.webContents.on('render-process-gone', (_event, details) => log('tile renderer gone', details));
  await tileShown;

  if (isShot) {
    await runShot(tile);
  } else if (isHold) {
    log('HOLD: opening overlay in 1.5s');
    await delay(1500);
    await openOverlay(tile.id);
    log('HOLD READY (overlay open, app stays running)');
  } else {
    // 空闲预创建浮层 + 预热桌面抓屏缓存，保证点击到出现 ≤150ms
    setTimeout(() => {
      overlay.ensure().catch((err) => log('overlay precreate failed:', err.message));
    }, 1200);
    setTimeout(() => {
      warmBackground({ force: true });
    }, 1800);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (tileWin && !tileWin.isDestroyed()) {
      tileWin.show();
      tileWin.focus();
    }
  });

  app.whenReady().then(bootstrap).catch((err) => {
    log('bootstrap failed:', err && err.stack ? err.stack : String(err));
    app.exit(1);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  log('uncaught exception:', err && err.stack ? err.stack : String(err));
});
