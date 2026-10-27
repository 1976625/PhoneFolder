'use strict';

// 设置校验 + 配置迁移（v2/v3 → v4：收纳文件夹从桌面迁到桌面同级的独立目录）
const path = require('path');
const { TILE_SIZE } = require('./grid');

const BACKGROUND_MODES = ['wallpaper', 'capture', 'acrylic'];
const MAX_TILES = 6;
const CONFIG_VERSION = 5;

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function isSamePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  try {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  } catch {
    return false;
  }
}

// 瓦片自定义名称：去换行/多余空格，最长 24 字；空字符串表示恢复默认（文件夹名）
function cleanTileName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
}

// v2/v3 → v4：
//  - v2 默认绑定桌面的瓦片 → 改为独立收纳目录
//  - v3 绑定在桌面下的隐藏收纳文件夹（或旧默认「手机文件夹」）→ 改为独立收纳目录
//  - 用户绑定的普通可见文件夹保持不变
function migrateConfig(raw, { desktopPath, replacementFolder, shouldRelocate } = {}) {
  if (!raw || typeof raw !== 'object') {
    return { config: raw, changed: false, relocated: [] };
  }
  const version = Number(raw.version) || 0;
  if (version >= CONFIG_VERSION) {
    return { config: raw, changed: false, relocated: [] };
  }

  const config = JSON.parse(JSON.stringify(raw));
  const relocated = [];
  // v2/v3 的桌面收纳目录迁移只在 <4 时执行；v4→v5 只做尺寸归一
  if (version < 4) {
    const decide = typeof shouldRelocate === 'function'
      ? shouldRelocate
      : (folder) => isSamePath(folder, desktopPath);
    if (Array.isArray(config.tiles)) {
      for (const tile of config.tiles) {
        if (tile && typeof tile.folder === 'string' && decide(tile.folder)) {
          relocated.push(tile.folder);
          tile.folder = replacementFolder;
        }
      }
    }
  }
  if (Array.isArray(config.tiles)) {
    for (const tile of config.tiles) {
      if (tile) tile.size = TILE_SIZE;
    }
  }
  config.version = CONFIG_VERSION;
  return { config, changed: true, relocated };
}

function sanitizeSettings(input, { displayBounds, pathExists = () => true, maxTiles = MAX_TILES }) {
  if (!input || typeof input !== 'object') throw new Error('设置数据无效');
  const bounds = displayBounds;
  if (!bounds) throw new Error('缺少屏幕信息');

  const tileInputs = Array.isArray(input.tiles) ? input.tiles : [];
  const tiles = [];
  const seen = new Set();

  for (const raw of tileInputs) {
    if (tiles.length >= maxTiles) break;
    if (!raw || typeof raw !== 'object') continue;
    const folderRaw = typeof raw.folder === 'string' ? raw.folder.trim() : '';
    if (!folderRaw || !path.isAbsolute(folderRaw)) throw new Error('文件夹路径必须是绝对路径');
    const folder = path.resolve(folderRaw);
    const key = folder.toLowerCase();
    if (seen.has(key)) continue; // 同一文件夹只绑一个瓦片
    if (!pathExists(folder)) throw new Error(`文件夹不存在：${folder}`);
    seen.add(key);

    const size = TILE_SIZE; // 固定 128，不再可调
    const maxX = bounds.x + bounds.width - size;
    const maxY = bounds.y + bounds.height - size - 20;
    const rawX = Number(raw.x);
    const rawY = Number(raw.y);
    const x = Math.round(clamp(Number.isFinite(rawX) ? rawX : maxX - 24, bounds.x, maxX, maxX - 24));
    const y = Math.round(clamp(Number.isFinite(rawY) ? rawY : bounds.y + 24, bounds.y, maxY, bounds.y + 24));

    const name = cleanTileName(raw.name);
    const order = [];
    if (Array.isArray(raw.order)) {
      const seenOrder = new Set();
      for (const entry of raw.order) {
        if (typeof entry !== 'string' || !entry || seenOrder.has(entry)) continue;
        seenOrder.add(entry);
        order.push(entry);
        if (order.length >= 500) break;
      }
    }
    tiles.push({
      id: `t${tiles.length + 1}`,
      folder,
      x,
      y,
      size,
      opacity: 1,
      ...(name ? { name } : {}),
      ...(order.length ? { order } : {})
    });
  }

  if (tiles.length === 0) throw new Error('至少保留一个瓦片');

  const overlayIn = input.overlay && typeof input.overlay === 'object' ? input.overlay : {};
  const background = BACKGROUND_MODES.includes(overlayIn.background) ? overlayIn.background : 'wallpaper';
  const dim = clamp(overlayIn.dim, 0.15, 0.7, 0.42);
  const blur = Math.round(clamp(overlayIn.blur, 8, 48, 26));
  const appIn = input.app && typeof input.app === 'object' ? input.app : {};

  return {
    version: CONFIG_VERSION,
    tiles,
    overlay: { columns: 3, rows: 3, dim, blur, theme: 'dark', background },
    behavior: { openOnSingleClick: true },
    app: {
      launchAtLogin: Boolean(appIn.launchAtLogin),
      firstRunDone: true,
      keepVisibleOnShowDesktop: appIn.keepVisibleOnShowDesktop !== false
    }
  };
}

function settingsSnapshot(config) {
  return {
    config,
    backgroundModes: BACKGROUND_MODES.slice(),
    maxTiles: MAX_TILES
  };
}

module.exports = {
  sanitizeSettings,
  settingsSnapshot,
  migrateConfig,
  BACKGROUND_MODES,
  MAX_TILES,
  CONFIG_VERSION,
  isSamePath,
  cleanTileName
};





