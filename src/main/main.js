'use strict';

const {
  app, ipcMain, Menu, Tray, screen, desktopCapturer, shell, clipboard,
  nativeImage, dialog, nativeTheme
} = require('electron');
const path = require('path');
const fs = require('fs');

const { loadConfig, saveConfig } = require('./services/config');
const { init: initLogger, log } = require('./services/logger');
const { createTileWindow, LABEL_HEIGHT } = require('./windows/tile-window');
const { OverlayWindow } = require('./windows/overlay-window');
const { createBackdropWindow } = require('./windows/backdrop-window');
const { createSettingsWindow } = require('./windows/settings-window');
const { scanFolder } = require('./services/folder');
const { payloadForItem } = require('./services/icons');
const { moveIntoFolder } = require('./services/fsops');
const { sanitizeSettings, settingsSnapshot } = require('./services/settings');
const {
  envMode,
  warmCapture,
  warmWallpaper,
  readWallpaperDataUrl
} = require('./services/background');

const argv = process.argv.slice(1);
const isShot = argv.includes('--shot') || process.env.PF_SHOT === '1';
const isHold = argv.includes('--hold');
const isOpenSettings = argv.includes('--open-settings');
const isStage = isShot || isHold;

const ROOT = path.join(__dirname, '..', '..');
const SHOT_DIR = path.join(ROOT, 'shots', process.env.PF_SHOT_DIR || '');
const ICON_PATH = path.join(ROOT, 'assets', 'icon.ico');
const PAGE_SIZE = 9;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let config = null;
let tileWindows = new Map(); // tileId -> BrowserWindow
let folderStates = new Map(); // tileId -> { data, watcher, timer }
let overlay = null;
let overlayTileId = null;
let backdrop = null;
let tray = null;
let settingsWin = null;
let tilesVisible = true;
let rebuilding = false;
let precreateTimer = null;

/* ------------------------------------------------------------------ */
/* 背景                                                                 */
/* ------------------------------------------------------------------ */
function effectiveBackgroundMode() {
  const fromEnv = envMode();
  if (fromEnv) return fromEnv;
  if (config && config.overlay && config.overlay.background) return config.overlay.background;
  return 'wallpaper';
}

function warmBackground({ force = false } = {}) {
  const m = effectiveBackgroundMode();
  if (m === 'capture') return warmCapture(screen.getPrimaryDisplay(), { force });
  if (m === 'wallpaper') return warmWallpaper();
  return Promise.resolve(null);
}

/* ------------------------------------------------------------------ */
/* 文件夹数据                                                           */
/* ------------------------------------------------------------------ */
function tileById(tileId) {
  return config.tiles.find((tile) => tile.id === tileId) || null;
}

function tileFolder(tileId) {
  const tile = tileById(tileId);
  return tile ? tile.folder : null;
}

function stateOf(tileId) {
  const state = folderStates.get(tileId);
  return state ? state.data : null;
}

async function loadFolderState(tileId) {
  const folder = tileFolder(tileId);
  if (!folder) return null;
  const data = await scanFolder(folder);
  const state = folderStates.get(tileId) || {};
  state.data = data;
  folderStates.set(tileId, state);
  if (data.error) log('scan folder error:', tileId, data.error, folder);
  else log('folder scanned:', tileId, data.name, data.items.length, 'items');
  return data;
}

function basicItems(tileId, limit) {
  const data = stateOf(tileId);
  const items = (data && data.items) || [];
  const picked = limit ? items.slice(0, limit) : items;
  return picked.map((item) => ({
    name: item.name,
    path: item.path,
    isDir: item.isDir,
    mtimeMs: item.mtimeMs
  }));
}

function buildTilePayload(tile) {
  const data = stateOf(tile.id);
  return {
    tileId: tile.id,
    folderName: (data && data.name) || path.basename(tile.folder),
    folder: tile.folder,
    items: basicItems(tile.id, 4),
    total: (data && data.total) || 0,
    error: data ? data.error : null,
    errorMessage: data ? data.errorMessage : null
  };
}

function buildOverlayPayload(tile) {
  const data = stateOf(tile.id);
  const displayBounds = screen.getPrimaryDisplay().bounds;
  const bounds = tileWindows.get(tile.id) ? tileWindows.get(tile.id).getBounds() : { x: 0, y: 0, width: tile.size, height: tile.size + LABEL_HEIGHT };
  return {
    tileId: tile.id,
    openedAt: Date.now(),
    tileRect: {
      x: bounds.x - displayBounds.x,
      y: bounds.y - displayBounds.y,
      width: bounds.width,
      height: Math.max(1, bounds.height - LABEL_HEIGHT)
    },
    folderName: (data && data.name) || path.basename(tile.folder),
    folder: tile.folder,
    items: basicItems(tile.id),
    total: (data && data.total) || 0,
    truncated: Boolean(data && data.truncated),
    pageSize: PAGE_SIZE,
    dim: config.overlay.dim,
    blur: config.overlay.blur,
    error: data ? data.error : null,
    errorMessage: data ? data.errorMessage : null
  };
}

async function refreshTile(tileId) {
  const tile = tileById(tileId);
  if (!tile) return;
  await loadFolderState(tileId);
  const win = tileWindows.get(tileId);
  if (win && !win.isDestroyed()) {
    win.webContents.send('tile:refresh', buildTilePayload(tile));
  }
  if (overlay && overlay.isOpen && overlayTileId === tileId && overlay.win) {
    overlay.win.webContents.send('overlay:refresh', buildOverlayPayload(tile));
  }
}

/* ------------------------------------------------------------------ */
/* 文件夹监听                                                           */
/* ------------------------------------------------------------------ */
function stopWatcher(tileId) {
  const state = folderStates.get(tileId);
  if (!state) return;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.watcher) {
    try { state.watcher.close(); } catch { /* ignore */ }
    state.watcher = null;
  }
}

function startWatcher(tileId) {
  stopWatcher(tileId);
  const folder = tileFolder(tileId);
  if (!folder) return;
  const state = folderStates.get(tileId) || {};
  folderStates.set(tileId, state);
  try {
    state.watcher = fs.watch(folder, { persistent: false }, () => {
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.timer = null;
        refreshTile(tileId).catch((err) => log('refresh failed:', tileId, err.message));
      }, 300);
    });
    state.watcher.on('error', (err) => {
      log('folder watch error:', tileId, err.message);
      stopWatcher(tileId);
      setTimeout(() => {
        if (!app.isQuitting) startWatcher(tileId);
      }, 2000).unref?.();
    });
  } catch (err) {
    log('folder watch unavailable:', tileId, err.message);
  }
}

/* ------------------------------------------------------------------ */
/* 瓦片窗口                                                             */
/* ------------------------------------------------------------------ */
function senderTileId(event) {
  for (const [tileId, win] of tileWindows) {
    if (win && !win.isDestroyed() && win.webContents === event.sender) return tileId;
  }
  return null;
}

function senderFolder(event) {
  const tileId = senderTileId(event);
  if (tileId) return tileFolder(tileId);
  if (overlay && overlay.win && event.sender === overlay.win.webContents && overlayTileId) {
    return tileFolder(overlayTileId);
  }
  return null;
}

function isKnownSender(event) {
  return Boolean(senderFolder(event));
}

function isSettingsSender(event) {
  return Boolean(settingsWin && !settingsWin.isDestroyed() && event.sender === settingsWin.webContents);
}

function isInsideFolder(target, folder) {
  if (typeof target !== 'string' || !target || !folder) return false;
  try {
    const rel = path.relative(folder, target);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

async function createTileWindowFor(tile) {
  const win = createTileWindow(tile, { visible: tilesVisible });
  tileWindows.set(tile.id, win);
  const shown = new Promise((resolve) => win.once('ready-to-show', resolve));
  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send('tile:init', buildTilePayload(tile));
    log('tile renderer loaded', tile.id, win.getBounds());
  });
  win.webContents.on('render-process-gone', (_event, details) => log('tile renderer gone', tile.id, details));
  win.on('closed', () => {
    if (tileWindows.get(tile.id) === win) tileWindows.delete(tile.id);
  });
  await shown;
  return win;
}

async function createAllTileWindows() {
  for (const tile of config.tiles) {
    try {
      await createTileWindowFor(tile);
    } catch (err) {
      log('create tile failed:', tile.id, err.message);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 浮层                                                                 */
/* ------------------------------------------------------------------ */
async function openOverlay(tileId) {
  const tile = tileById(tileId);
  if (!tile) return;
  const startedAt = Date.now();
  if (!stateOf(tileId)) await loadFolderState(tileId);
  overlayTileId = tileId;
  const payload = buildOverlayPayload(tile);
  log('opening overlay', { tileId, backgroundMode: overlay.mode, total: payload.total });
  overlay.preparePayload(payload);
  await overlay.open(payload);
  log('overlay show() done in', Date.now() - startedAt, 'ms');
}

/* ------------------------------------------------------------------ */
/* 设置 / 托盘 / 自启                                                    */
/* ------------------------------------------------------------------ */
function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function currentSettingsSnapshot() {
  return settingsSnapshot(config);
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    settingsWin.moveTop();
    return;
  }
  app.focus({ steal: true });
  settingsWin = createSettingsWindow();
  settingsWin.once('ready-to-show', () => {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.show();
      settingsWin.focus();
      settingsWin.moveTop();
    }
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  settingsWin.webContents.once('did-finish-load', () => {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.webContents.send('settings:init', currentSettingsSnapshot());
    }
  });
  return settingsWin;
}

function toggleTiles() {
  tilesVisible = !tilesVisible;
  for (const win of tileWindows.values()) {
    if (!win || win.isDestroyed()) continue;
    if (tilesVisible) win.show();
    else win.hide();
  }
  log('tiles visibility:', tilesVisible);
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: tilesVisible ? '隐藏瓦片' : '显示瓦片',
      click: () => toggleTiles()
    },
    { label: '打开设置…', click: () => openSettings() },
    { label: '打开绑定文件夹', click: () => shell.openPath(config.tiles[0].folder) },
    {
      label: '重新扫描',
      click: () => config.tiles.forEach((tile) => refreshTile(tile.id).catch(() => {}))
    },
    { type: 'separator' },
    { label: '退出 PhoneFolder', click: () => app.quit() }
  ]);
}

function createTray() {
  try {
    tray = new Tray(ICON_PATH);
    tray.setToolTip('PhoneFolder');
    tray.on('click', () => toggleTiles());
    tray.on('right-click', () => {
      if (tray) tray.popUpContextMenu(buildTrayMenu());
    });
    log('tray created, bounds =', JSON.stringify(tray.getBounds()));
  } catch (err) {
    tray = null;
    log('tray creation failed:', err.message);
  }
}

function applyAutostart() {
  try {
    const openAtLogin = Boolean(config.app && config.app.launchAtLogin);
    const args = app.isPackaged ? [] : [app.getAppPath()];
    app.setLoginItemSettings({
      openAtLogin,
      path: app.getPath('exe'),
      args,
      name: 'PhoneFolder'
    });
    log('autostart:', openAtLogin);
  } catch (err) {
    log('apply autostart failed:', err.message);
  }
}

/* ------------------------------------------------------------------ */
/* 重建（设置保存后）                                                    */
/* ------------------------------------------------------------------ */
function scheduleOverlayPrecreate() {
  if (precreateTimer) clearTimeout(precreateTimer);
  precreateTimer = setTimeout(() => {
    precreateTimer = null;
    if (overlay) overlay.ensure().catch((err) => log('overlay precreate failed:', err.message));
  }, 1200);
  setTimeout(() => warmBackground({ force: true }), 1800);
}

async function rebuildAll() {
  rebuilding = true;
  try {
    for (const tileId of [...folderStates.keys()]) stopWatcher(tileId);
    folderStates.clear();
    if (overlay) {
      overlay.dispose();
      overlay = null;
    }
    overlayTileId = null;
    for (const win of tileWindows.values()) {
      try { win.destroy(); } catch { /* ignore */ }
    }
    tileWindows.clear();

    overlay = new OverlayWindow(effectiveBackgroundMode());
    await Promise.all(config.tiles.map((tile) => loadFolderState(tile.id)));
    await createAllTileWindows();
    for (const tile of config.tiles) startWatcher(tile.id);
    if (!isStage) scheduleOverlayPrecreate();
    warmBackground({ force: true });
    log('config applied:', config.tiles.length, 'tiles,', effectiveBackgroundMode());
  } finally {
    rebuilding = false;
  }
}

async function applySettings(input) {
  const next = sanitizeSettings(input, {
    displayBounds: screen.getPrimaryDisplay().bounds,
    pathExists: isDirectory
  });
  config = next;
  saveConfig(config);
  applyAutostart();
  await rebuildAll();
  return config;
}

async function removeTile(tileId) {
  const rest = config.tiles.filter((tile) => tile.id !== tileId);
  if (rest.length === 0) return;
  await applySettings({
    tiles: rest.map((tile) => ({ folder: tile.folder, x: tile.x, y: tile.y, size: tile.size })),
    overlay: config.overlay,
    app: config.app
  });
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */
function registerIpc() {
  ipcMain.on('tile:activate', (event) => {
    const tileId = senderTileId(event);
    if (!tileId) return;
    openOverlay(tileId).catch((err) => log('open overlay failed:', err.message));
  });

  ipcMain.on('overlay:hidden', (event) => {
    if (!overlay || !overlay.win || event.sender !== overlay.win.webContents) return;
    overlay.hide();
    overlayTileId = null;
    log('overlay hidden');
    warmBackground();
  });

  ipcMain.on('tile:hover', (event) => {
    if (!senderTileId(event)) return;
    warmBackground();
  });

  ipcMain.handle('icons:get', async (event, item) => {
    const folder = senderFolder(event);
    if (!folder) return null;
    if (!item || typeof item.path !== 'string' || !isInsideFolder(item.path, folder)) return null;
    return payloadForItem({
      path: item.path,
      isDir: Boolean(item.isDir),
      mtimeMs: Number(item.mtimeMs) || 0
    });
  });

  ipcMain.on('item:open', (event, itemPath) => {
    const folder = senderFolder(event);
    if (!folder || !isInsideFolder(itemPath, folder)) return;
    shell.openPath(itemPath).then((message) => {
      if (message) log('open item failed:', itemPath, message);
    });
  });

  ipcMain.on('item:menu', (event, itemPath) => {
    const folder = senderFolder(event);
    if (!folder || !isInsideFolder(itemPath, folder)) return;
    const menu = Menu.buildFromTemplate([
      { label: '打开', click: () => shell.openPath(itemPath) },
      { label: '在资源管理器中显示', click: () => shell.showItemInFolder(itemPath) },
      { type: 'separator' },
      { label: '复制路径', click: () => clipboard.writeText(itemPath) }
    ]);
    menu.popup({ window: overlay && overlay.win ? overlay.win : null });
  });

  // 拖入：资源管理器 → 瓦片/浮层，移入该瓦片绑定的文件夹
  ipcMain.handle('files:drop-in', async (event, paths) => {
    const folder = senderFolder(event);
    if (!folder || !Array.isArray(paths)) return null;
    const sources = paths.filter((p) => typeof p === 'string' && p).slice(0, 60);
    if (sources.length === 0) return { moved: 0, skipped: 0, failed: 0, results: [] };
    log('drop-in:', sources.length, 'items ->', folder);
    let summary;
    try {
      summary = await moveIntoFolder(sources, folder);
    } catch (err) {
      log('drop-in failed:', err.message);
      return { moved: 0, skipped: 0, failed: sources.length, results: [], error: err.message };
    }
    for (const result of summary.results) {
      if (result.status === 'failed') log('drop-in failed item:', result.name, result.message);
    }
    log('drop-in done:', { moved: summary.moved, skipped: summary.skipped, failed: summary.failed });
    const tileId = senderTileId(event) || overlayTileId;
    if (tileId) await refreshTile(tileId);
    return summary;
  });

  // 拖出：浮层条目 → 资源管理器/桌面（原生拖拽，单文件）
  ipcMain.on('item:drag-out', (event, payload) => {
    if (!overlay || !overlay.win || event.sender !== overlay.win.webContents) return;
    const folder = overlayTileId ? tileFolder(overlayTileId) : null;
    if (!payload || !isInsideFolder(payload.path, folder)) return;
    let icon = null;
    if (typeof payload.iconDataUrl === 'string' && payload.iconDataUrl.startsWith('data:image/')) {
      try {
        icon = nativeImage.createFromDataURL(payload.iconDataUrl);
        if (icon.isEmpty()) icon = null;
      } catch {
        icon = null;
      }
    }
    const iconPromise = icon ? Promise.resolve(icon) : app.getFileIcon(payload.path, { size: 'large' });
    iconPromise.then((dragIcon) => {
      try {
        event.sender.startDrag({ file: payload.path, icon: dragIcon });
      } catch (err) {
        log('startDrag failed:', err.message);
      }
    }).catch((err) => log('drag-out failed:', err.message));
  });

  ipcMain.on('tile:contextmenu', (event) => {
    const tileId = senderTileId(event);
    const win = tileWindows.get(tileId);
    const tile = tileById(tileId);
    if (!win || !tile) return;
    const template = [
      { label: '展开文件夹', click: () => openOverlay(tileId).catch((err) => log('open overlay failed:', err.message)) },
      { label: '打开绑定文件夹', click: () => shell.openPath(tile.folder) },
      { label: '重新扫描', click: () => refreshTile(tileId).catch((err) => log('rescan failed:', err.message)) },
      { type: 'separator' },
      { label: '添加瓦片…', click: () => openSettings() },
      { label: '设置…', click: () => openSettings() }
    ];
    if (config.tiles.length > 1) {
      template.push({ label: '删除此瓦片', click: () => removeTile(tileId).catch((err) => log('remove tile failed:', err.message)) });
    }
    template.push({ type: 'separator' }, { label: '退出 PhoneFolder', click: () => app.quit() });
    Menu.buildFromTemplate(template).popup({ window: win });
  });

  // 拖动瓦片：按瓦片记录基准位置
  const dragStates = new Map(); // tileId -> { base, cursor }
  ipcMain.on('tile:drag-start', (event) => {
    const tileId = senderTileId(event);
    const win = tileId ? tileWindows.get(tileId) : null;
    if (!win) return;
    dragStates.set(tileId, { base: win.getPosition(), cursor: screen.getCursorScreenPoint() });
  });
  ipcMain.on('tile:drag-move', (event, x, y) => {
    const tileId = senderTileId(event);
    const win = tileId ? tileWindows.get(tileId) : null;
    const drag = tileId ? dragStates.get(tileId) : null;
    if (!win || !drag) return;
    const display = screen.getPrimaryDisplay().bounds;
    const bounds = win.getBounds();
    const nextX = drag.base[0] + Math.round(x - drag.cursor.x);
    const nextY = drag.base[1] + Math.round(y - drag.cursor.y);
    const clampedX = Math.min(Math.max(nextX, display.x), display.x + display.width - bounds.width);
    const clampedY = Math.min(Math.max(nextY, display.y), display.y + display.height - bounds.height);
    win.setPosition(clampedX, clampedY);
  });
  ipcMain.on('tile:drag-end', (event) => {
    const tileId = senderTileId(event);
    const win = tileId ? tileWindows.get(tileId) : null;
    const tile = tileId ? tileById(tileId) : null;
    if (!win || !tile) return;
    dragStates.delete(tileId);
    const [x, y] = win.getPosition();
    tile.x = x;
    tile.y = y;
    saveConfig(config);
    log('tile moved', tileId, { x, y });
  });

  /* ----------------------------- 设置 ----------------------------- */
  ipcMain.handle('settings:get', (event) => {
    if (!isSettingsSender(event)) return null;
    return currentSettingsSnapshot();
  });

  ipcMain.handle('settings:save', async (event, input) => {
    if (!isSettingsSender(event)) return { ok: false, error: '没有权限' };
    try {
      await applySettings(input);
      if (settingsWin && !settingsWin.isDestroyed()) {
        settingsWin.webContents.send('settings:reloaded', currentSettingsSnapshot());
      }
      return { ok: true };
    } catch (err) {
      log('settings save failed:', err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('settings:pick-folder', async (event) => {
    if (!isSettingsSender(event)) return null;
    const result = await dialog.showOpenDialog(settingsWin, {
      title: '选择要绑定的文件夹',
      properties: ['openDirectory'],
      buttonLabel: '选择'
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.on('settings:close', (event) => {
    if (!isSettingsSender(event)) return;
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
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
    for (const name of fs.readdirSync(SHOT_DIR)) {
      if (/^\d\d-.*\.png$/.test(name)) fs.unlinkSync(path.join(SHOT_DIR, name));
    }
  } catch { /* ignore */ }

  await delay(900);
  await captureScreen('01-tile.png');

  await warmBackground({ force: true });
  const payload = buildOverlayPayload(tile);
  overlay.preparePayload(payload);
  await overlay.open(payload);
  await delay(120);
  await captureScreen('02-overlay-mid.png');
  await delay(1400);
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
  nativeTheme.themeSource = 'dark';

  const display = screen.getPrimaryDisplay();
  log('display', {
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor
  });

  config = loadConfig();
  log('config loaded:', config.tiles.length, 'tiles,', JSON.stringify(config.overlay));
  applyAutostart();

  overlay = new OverlayWindow(effectiveBackgroundMode());
  registerIpc();
  if (!isStage) createTray();

  if (isStage) {
    backdrop = await createBackdropWindow(readWallpaperDataUrl());
    await delay(300);
    await overlay.ensure();
  }

  await Promise.all(config.tiles.map((tile) => loadFolderState(tile.id)));
  await createAllTileWindows();
  for (const tile of config.tiles) startWatcher(tile.id);

  if (isShot) {
    await runShot(config.tiles[0]);
  } else if (isHold) {
    log('HOLD: opening overlay in 1.5s');
    await delay(1500);
    await openOverlay(config.tiles[0].id);
    log('HOLD READY (overlay open, app stays running)');
  } else {
    scheduleOverlayPrecreate();
    if (isOpenSettings) openSettings();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    log('second instance detected, focusing tiles + settings');
    tilesVisible = true;
    for (const win of tileWindows.values()) {
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
        break;
      }
    }
    openSettings();
  });

  app.whenReady().then(bootstrap).catch((err) => {
    log('bootstrap failed:', err && err.stack ? err.stack : String(err));
    app.exit(1);
  });
}

app.on('before-quit', () => {
  app.isQuitting = true;
  if (precreateTimer) clearTimeout(precreateTimer);
  for (const tileId of [...folderStates.keys()]) stopWatcher(tileId);
  if (tray) {
    try { tray.destroy(); } catch { /* ignore */ }
    tray = null;
  }
});

app.on('window-all-closed', () => {
  // 有托盘时保持常驻；重建配置/截图模式下不要提前退出
  if (rebuilding || isStage) return;
  if (!tray) app.quit();
});

process.on('uncaughtException', (err) => {
  log('uncaught exception:', err && err.stack ? err.stack : String(err));
});
