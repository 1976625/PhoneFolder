'use strict';

// 图标/缩略图：文件夹与图片/视频优先用系统缩略图（128px，清晰），
// 快捷方式/可执行文件取真实目标图标；其余退回 32px 系统图标
const path = require('path');
const { app, nativeImage } = require('electron');
const {
  requestShortcutIcon,
  prefetchShortcutIcons,
  clearShortcutIconCache,
  isShortcutFile
} = require('./shortcut-icons');

const MEMORY_LIMIT = 150;
const THUMBNAIL_SIZE = { width: 128, height: 128 };

// 图片/视频优先缩略图；其余走系统图标
const THUMBNAIL_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.ico',
  '.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv', '.flv'
]);

const cache = new Map(); // key -> { dataUrl, kind } | null

function cacheKey(item) {
  return `${item.path}|${Math.round(Number(item.mtimeMs) || 0)}|${item.isDir ? 'd' : 'f'}`;
}

function touch(key) {
  const value = cache.get(key);
  if (value !== undefined) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

function remember(key, value) {
  cache.set(key, value);
  if (cache.size > MEMORY_LIMIT) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

// Windows 的文件夹缩略图有时会返回不带 alpha 的 RGB 位图，背景是一整块纯黑；
// 直接显示就是「黑底方块」，与其它半透明图标不统一。
// 这里从四边向内做一次黑色像素漫水填充，把和边界连通的纯黑背景抠成透明（文件夹内部的黑色不动）。
const BLACK_THRESHOLD = 26;

function keyOutOpaqueBlack(image) {
  try {
    const size = image.getSize();
    const width = size.width;
    const height = size.height;
    if (!width || !height) return image;
    const bitmap = image.toBitmap(); // BGRA
    const index = (x, y) => (y * width + x) * 4;
    const isBlack = (offset) => (
      bitmap[offset + 3] === 255
      && bitmap[offset] <= BLACK_THRESHOLD
      && bitmap[offset + 1] <= BLACK_THRESHOLD
      && bitmap[offset + 2] <= BLACK_THRESHOLD
    );

    // 先判断边框是否几乎都是不透明黑（否则是正常带透明的缩略图，直接返回）
    let borderTotal = 0;
    let borderBlack = 0;
    const visitBorder = (x, y) => {
      const offset = index(x, y);
      borderTotal += 1;
      if (isBlack(offset)) borderBlack += 1;
    };
    for (let x = 0; x < width; x += 1) {
      visitBorder(x, 0);
      visitBorder(x, height - 1);
    }
    for (let y = 1; y < height - 1; y += 1) {
      visitBorder(0, y);
      visitBorder(width - 1, y);
    }
    if (borderTotal === 0 || borderBlack / borderTotal < 0.6) return image;

    const visited = new Uint8Array(width * height);
    const stack = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const cell = y * width + x;
      if (visited[cell]) return;
      const offset = cell * 4;
      if (!isBlack(offset)) return;
      visited[cell] = 1;
      stack.push([x, y]);
    };
    for (let x = 0; x < width; x += 1) {
      push(x, 0);
      push(x, height - 1);
    }
    for (let y = 1; y < height - 1; y += 1) {
      push(0, y);
      push(width - 1, y);
    }
    while (stack.length > 0) {
      const [x, y] = stack.pop();
      const offset = index(x, y);
      bitmap[offset + 3] = 0;
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
    return nativeImage.createFromBitmap(bitmap, { width, height });
  } catch {
    return image;
  }
}

async function thumbnailFor(file, { keyBlackBackground = false } = {}) {
  try {
    let thumb = await nativeImage.createThumbnailFromPath(file, THUMBNAIL_SIZE);
    if (thumb && !thumb.isEmpty()) {
      if (keyBlackBackground) thumb = keyOutOpaqueBlack(thumb);
      return thumb.toDataURL();
    }
  } catch { /* fall through */ }
  return null;
}

async function shellIconFor(file) {
  try {
    const icon = await app.getFileIcon(file, { size: 'large' });
    if (icon && !icon.isEmpty()) return icon.toDataURL();
  } catch { /* ignore */ }
  return null;
}

// 返回 { dataUrl, kind: 'thumb' | 'icon' } 或 null
async function payloadForItem(item) {
  if (!item || typeof item.path !== 'string') return null;
  const key = cacheKey(item);
  const hit = touch(key);
  if (hit !== undefined) return hit;

  const ext = path.extname(item.path).toLowerCase();
  let payload = null;

  // .lnk / .exe：Electron 的 getFileIcon 只会给统一占位图标，这里解析真实目标图标
  if (!item.isDir && isShortcutFile(item.path)) {
    const dataUrl = await requestShortcutIcon(item.path, item.mtimeMs);
    if (dataUrl) {
      payload = { dataUrl, kind: 'icon' };
      remember(key, payload);
      return payload;
    }
  }

  // 文件夹 / 图片 / 视频：优先缩略图（文件夹缩略图比 32px 图标清晰得多）
  if (item.isDir || THUMBNAIL_EXT.has(ext)) {
    const dataUrl = await thumbnailFor(item.path, { keyBlackBackground: item.isDir });
    if (dataUrl) payload = { dataUrl, kind: 'thumb' };
  }

  if (!payload) {
    const dataUrl = await shellIconFor(item.path);
    if (dataUrl) payload = { dataUrl, kind: 'icon' };
  }

  remember(key, payload);
  return payload;
}

function clearCache() {
  cache.clear();
  clearShortcutIconCache();
}

module.exports = { payloadForItem, clearCache, prefetchShortcutIcons };


