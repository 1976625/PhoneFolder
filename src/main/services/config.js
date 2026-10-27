'use strict';

// config.json 读写 + 默认值 + 损坏备份 + 位置夹取 + 配置迁移
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { app, screen } = require('electron');
const { log } = require('./logger');
const { migrateConfig, CONFIG_VERSION, isSamePath } = require('./settings');

const DEFAULT_TILE_SIZE = 84;
const TILE_LABEL_HEIGHT = 20; // 图标下方标签占位
const STORAGE_FOLDER_NAME = '手机文件夹';
const LEGACY_FOLDER_NAME = '手机文件夹'; // v3 及更早的默认收纳文件夹名

function defaultTilePosition(size) {
  const b = screen.getPrimaryDisplay().bounds;
  return {
    x: Math.round(b.x + b.width - size - 24),
    y: Math.round(b.y + 24)
  };
}

// 收纳文件夹放在「桌面目录的同级」，这样：
//  1) 不在桌面上，无论是否显示隐藏文件都不会出现在桌面；
//  2) 与桌面同一磁盘，拖入走 rename，不会跨盘复制大文件。
function storageFolderPath() {
  try {
    const desktop = app.getPath('desktop');
    const parent = path.dirname(desktop);
    if (path.resolve(parent) === path.resolve(desktop)) {
      return path.join(app.getPath('documents'), STORAGE_FOLDER_NAME);
    }
    return path.join(parent, STORAGE_FOLDER_NAME);
  } catch {
    try {
      return path.join(app.getPath('userData'), STORAGE_FOLDER_NAME);
    } catch {
      return path.join(app.getPath('desktop'), STORAGE_FOLDER_NAME);
    }
  }
}

function ensureStorageFolder() {
  const folder = storageFolderPath();
  try {
    fs.mkdirSync(folder, { recursive: true });
  } catch (err) {
    log('create storage folder failed:', err.message);
  }
  return folder;
}

function isHiddenDirectory(folder) {
  try {
    if (!fs.statSync(folder).isDirectory()) return false;
    const out = String(execFileSync('attrib', [folder], { windowsHide: true }));
    return out.slice(0, 24).toUpperCase().includes('H');
  } catch {
    return false;
  }
}

function availableNameSync(dir, name) {
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  let candidate = name;
  let index = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${index})${ext}`;
    index += 1;
    if (index > 999) break;
  }
  return candidate;
}

// 把旧收纳文件夹里的东西合并进新收纳文件夹，然后删掉空的旧目录
function relocateFolderContents(oldFolder, newFolder) {
  if (!oldFolder || !fs.existsSync(oldFolder)) return false;
  try {
    if (!fs.statSync(oldFolder).isDirectory()) return false;
    fs.mkdirSync(newFolder, { recursive: true });
    let moved = 0;
    for (const name of fs.readdirSync(oldFolder)) {
      const src = path.join(oldFolder, name);
      let dest = path.join(newFolder, name);
      if (fs.existsSync(dest)) dest = path.join(newFolder, availableNameSync(newFolder, name));
      try {
        fs.renameSync(src, dest);
      } catch (err) {
        if (err && err.code === 'EXDEV') {
          fs.cpSync(src, dest, { recursive: true, errorOnExist: true });
          fs.rmSync(src, { recursive: true, force: true });
        } else {
          throw err;
        }
      }
      moved += 1;
    }
    try { fs.rmdirSync(oldFolder); } catch { /* 非空就保留 */ }
    log('relocated storage contents:', oldFolder, '->', newFolder, 'items:', moved);
    return true;
  } catch (err) {
    log('relocate storage failed:', oldFolder, err.message);
    return false;
  }
}

function baseDefaults() {
  const pos = defaultTilePosition(DEFAULT_TILE_SIZE);
  return {
    version: CONFIG_VERSION,
    tiles: [
      { id: 't1', folder: storageFolderPath(), x: pos.x, y: pos.y, size: DEFAULT_TILE_SIZE, opacity: 1 }
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

// 桌面下直接子文件夹：属于我们旧的收纳位置（隐藏目录或旧默认名）才迁移
function shouldRelocateFromDesktop(folder, desktopPath) {
  if (typeof folder !== 'string' || !folder) return false;
  if (isSamePath(folder, desktopPath)) return true; // v2 默认绑定桌面
  let resolved;
  try {
    resolved = path.resolve(folder);
  } catch {
    return false;
  }
  const parent = path.dirname(resolved);
  if (parent.toLowerCase() !== path.resolve(desktopPath).toLowerCase()) return false;
  if (path.basename(resolved) === LEGACY_FOLDER_NAME) return true;
  return isHiddenDirectory(resolved);
}

function loadConfig() {
  const file = configPath();
  const hadConfig = fs.existsSync(file);
  const defaults = baseDefaults();
  let raw = null;

  try {
    if (hadConfig) {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (err) {
    log('config parse failed, backup and reset:', err.message);
    try {
      fs.copyFileSync(file, file.replace(/\.json$/, `.broken-${Date.now()}.json`));
    } catch { /* ignore */ }
    raw = null;
  }

  const desktopPath = app.getPath('desktop');
  const storageFolder = storageFolderPath();
  let migrated = false;

  // v2/v3 → v4：收纳文件夹从桌面迁到桌面同级目录
  if (raw && Number(raw.version || 0) < CONFIG_VERSION) {
    const result = migrateConfig(raw, {
      desktopPath,
      replacementFolder: storageFolder,
      shouldRelocate: (folder) => shouldRelocateFromDesktop(folder, desktopPath)
    });
    if (result.changed) {
      raw = result.config;
      migrated = true;
      ensureStorageFolder();
      for (const oldFolder of result.relocated) {
        relocateFolderContents(oldFolder, storageFolder);
      }
      log('config migrated to v', CONFIG_VERSION, 'relocated:', result.relocated);
    }
  }

  // 清理旧默认收纳文件夹（即使已经不在配置里，隐藏目录留在桌面上也会被「显示隐藏项目」看到）
  const legacyFolder = path.join(desktopPath, LEGACY_FOLDER_NAME);
  if (!isSamePath(legacyFolder, storageFolder) && fs.existsSync(legacyFolder)) {
    if (isHiddenDirectory(legacyFolder)) {
      ensureStorageFolder();
      relocateFolderContents(legacyFolder, storageFolder);
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

  if (!hadConfig) ensureStorageFolder();

  try {
    if (!hadConfig || migrated) writeAtomic(file, merged);
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

module.exports = {
  loadConfig,
  saveConfig,
  DEFAULT_TILE_SIZE,
  TILE_LABEL_HEIGHT,
  STORAGE_FOLDER_NAME,
  storageFolderPath
};
