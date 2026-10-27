'use strict';

// config.json 读写 + 默认值 + 损坏备份 + 位置夹取 + v2→v3 迁移
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { app, screen } = require('electron');
const { log } = require('./logger');
const { migrateConfig, CONFIG_VERSION } = require('./settings');

const DEFAULT_TILE_SIZE = 84;
const TILE_LABEL_HEIGHT = 20; // 图标下方标签占位
const DEFAULT_FOLDER_NAME = '手机文件夹';

function defaultTilePosition(size) {
  const b = screen.getPrimaryDisplay().bounds;
  return {
    x: Math.round(b.x + b.width - size - 24),
    y: Math.round(b.y + 24)
  };
}

// 默认绑定：桌面下的隐藏收纳文件夹（瓦片默认是空的，把桌面文件拖进去即可收纳）
function ensureDefaultFolder() {
  const desktop = app.getPath('desktop');
  const folder = path.join(desktop, DEFAULT_FOLDER_NAME);
  try {
    fs.mkdirSync(folder, { recursive: true });
    try {
      execFileSync('attrib', ['+h', folder], { windowsHide: true, stdio: 'ignore' });
    } catch { /* 隐藏属性设置失败不影响使用 */ }
    return folder;
  } catch (err) {
    log('create default folder failed:', err.message);
    try {
      const fallback = path.join(app.getPath('userData'), DEFAULT_FOLDER_NAME);
      fs.mkdirSync(fallback, { recursive: true });
      return fallback;
    } catch {
      return desktop;
    }
  }
}

function baseDefaults() {
  const pos = defaultTilePosition(DEFAULT_TILE_SIZE);
  return {
    version: CONFIG_VERSION,
    tiles: [
      { id: 't1', folder: ensureDefaultFolder(), x: pos.x, y: pos.y, size: DEFAULT_TILE_SIZE, opacity: 1 }
    ],
    overlay: { columns: 3, rows: 3, dim: 0.42, blur: 26, theme: 'dark', background: 'wallpaper' },
    behavior: { openOnSingleClick: true },
    app: { launchAtLogin: false, firstRunDone: true }
  };
}

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function clampTile(tile, index, displayBounds) {
  const size = Number(tile.size) || DEFAULT_TILE_SIZE;
  const fallback = defaultTilePosition(size);
  let x = Number.isFinite(tile.x) ? tile.x : fallback.x;
  let y = Number.isFinite(tile.y) ? tile.y : fallback.y;
  x = Math.min(Math.max(x, displayBounds.x), displayBounds.x + displayBounds.width - size);
  y = Math.min(Math.max(y, displayBounds.y), displayBounds.y + displayBounds.height - size - TILE_LABEL_HEIGHT);
  return {
    ...tile,
    id: typeof tile.id === 'string' && tile.id ? tile.id : `t${index + 1}`,
    x: Math.round(x),
    y: Math.round(y),
    size: Math.round(size)
  };
}

function loadConfig() {
  const file = configPath();
  const defaults = baseDefaults();
  let raw = null;

  try {
    if (fs.existsSync(file)) {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (err) {
    log('config parse failed, backup and reset:', err.message);
    try {
      fs.copyFileSync(file, file.replace(/\.json$/, `.broken-${Date.now()}.json`));
    } catch { /* ignore */ }
    raw = null;
  }

  // v2 → v3：旧的「默认绑定桌面」迁移为「空瓦片 + 隐藏收纳文件夹」
  const desktopPath = app.getPath('desktop');
  let migrated = false;
  let rebound = false;
  if (raw && Number(raw.version || 0) < CONFIG_VERSION) {
    const hasDesktopBinding = Array.isArray(raw.tiles)
      && raw.tiles.some((tile) => tile && typeof tile.folder === 'string'
        && path.resolve(tile.folder).toLowerCase() === path.resolve(desktopPath).toLowerCase());
    const replacementFolder = hasDesktopBinding ? ensureDefaultFolder() : desktopPath;
    const result = migrateConfig(raw, { desktopPath, replacementFolder });
    if (result.changed) {
      raw = result.config;
      migrated = true;
      rebound = result.rebound;
      log('config migrated to v3, rebound tiles:', rebound, 'folder:', replacementFolder);
    }
  }

  const merged = {
    ...defaults,
    ...(raw || {}),
    overlay: { ...defaults.overlay, ...((raw && raw.overlay) || {}) },
    behavior: { ...defaults.behavior, ...((raw && raw.behavior) || {}) },
    app: { ...defaults.app, ...((raw && raw.app) || {}) }
  };
  merged.version = CONFIG_VERSION;

  const displayBounds = screen.getPrimaryDisplay().bounds;
  if (!Array.isArray(merged.tiles) || merged.tiles.length === 0) {
    merged.tiles = defaults.tiles;
  }
  merged.tiles = merged.tiles.slice(0, 6).map((tile, index) => clampTile(tile, index, displayBounds));

  // overlay 数值夹取：手改 config 也不至于把界面弄坏
  merged.overlay.dim = Math.min(Math.max(Number(merged.overlay.dim) || 0.42, 0.15), 0.7);
  merged.overlay.blur = Math.min(Math.max(Math.round(Number(merged.overlay.blur) || 26), 8), 48);
  if (!['wallpaper', 'capture', 'acrylic'].includes(merged.overlay.background)) {
    merged.overlay.background = 'wallpaper';
  }
  merged.overlay.columns = 3;
  merged.overlay.rows = 3;
  merged.overlay.theme = 'dark';

  try {
    if (!fs.existsSync(file) || migrated) writeAtomic(file, merged);
  } catch (err) {
    log('config write failed:', err.message);
  }
  return merged;
}

function saveConfig(merged) {
  try {
    writeAtomic(configPath(), merged);
  } catch (err) {
    log('config save failed:', err.message);
  }
}

module.exports = { loadConfig, saveConfig, DEFAULT_TILE_SIZE, TILE_LABEL_HEIGHT, DEFAULT_FOLDER_NAME };
