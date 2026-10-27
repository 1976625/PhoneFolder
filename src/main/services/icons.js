'use strict';

// 图标/缩略图：文件夹与图片/视频优先用系统缩略图（256px，清晰），其余退回 32px 系统图标
const path = require('path');
const { app, nativeImage } = require('electron');

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

async function thumbnailFor(file) {
  try {
    const thumb = await nativeImage.createThumbnailFromPath(file, THUMBNAIL_SIZE);
    if (thumb && !thumb.isEmpty()) return thumb.toDataURL();
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

  // 文件夹 / 图片 / 视频：优先缩略图（文件夹缩略图 256px 比 32px 图标清晰得多）
  if (item.isDir || THUMBNAIL_EXT.has(ext)) {
    const dataUrl = await thumbnailFor(item.path);
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
}

module.exports = { payloadForItem, clearCache };

