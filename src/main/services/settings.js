'use strict';

// 设置校验：文件夹存在、绝对路径、去重、最多 6 个瓦片；数值夹取
const path = require('path');

const BACKGROUND_MODES = ['wallpaper', 'capture', 'acrylic'];
const MAX_TILES = 6;

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
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

    const size = Math.round(clamp(raw.size, 64, 128, 84));
    const maxX = bounds.x + bounds.width - size;
    const maxY = bounds.y + bounds.height - size - 20;
    const rawX = Number(raw.x);
    const rawY = Number(raw.y);
    const x = Math.round(clamp(Number.isFinite(rawX) ? rawX : maxX - 24, bounds.x, maxX, maxX - 24));
    const y = Math.round(clamp(Number.isFinite(rawY) ? rawY : bounds.y + 24, bounds.y, maxY, bounds.y + 24));

    tiles.push({ id: `t${tiles.length + 1}`, folder, x, y, size, opacity: 1 });
  }

  if (tiles.length === 0) throw new Error('至少保留一个瓦片');

  const overlayIn = input.overlay && typeof input.overlay === 'object' ? input.overlay : {};
  const background = BACKGROUND_MODES.includes(overlayIn.background) ? overlayIn.background : 'wallpaper';
  const dim = clamp(overlayIn.dim, 0.15, 0.7, 0.42);
  const blur = Math.round(clamp(overlayIn.blur, 8, 48, 26));
  const appIn = input.app && typeof input.app === 'object' ? input.app : {};

  return {
    version: 2,
    tiles,
    overlay: { columns: 3, rows: 3, dim, blur, theme: 'dark', background },
    behavior: { openOnSingleClick: true },
    app: { launchAtLogin: Boolean(appIn.launchAtLogin), firstRunDone: true }
  };
}

function settingsSnapshot(config) {
  return {
    config,
    backgroundModes: BACKGROUND_MODES.slice(),
    maxTiles: MAX_TILES
  };
}

module.exports = { sanitizeSettings, settingsSnapshot, BACKGROUND_MODES, MAX_TILES };
