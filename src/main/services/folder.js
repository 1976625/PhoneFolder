'use strict';

// 文件夹扫描：过滤垃圾文件 → 文件夹优先 + 中文自然排序 → 500 项上限
const fs = require('fs/promises');
const path = require('path');

const SCAN_LIMIT = 500;

const IGNORED_NAMES = new Set([
  'desktop.ini',
  'thumbs.db',
  '$recycle.bin',
  'system volume information'
]);

function isIgnoredName(name) {
  if (!name) return true;
  if (name.startsWith('.')) return true;
  if (name.startsWith('~$')) return true; // Office 临时锁定文件
  return IGNORED_NAMES.has(name.toLowerCase());
}

function sortItems(a, b) {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function chineseMessage(code) {
  switch (code) {
    case 'not-found':
      return '文件夹不存在或已被移动';
    case 'no-permission':
      return '没有权限访问这个文件夹';
    case 'unknown':
    default:
      return '文件夹读取失败';
  }
}

async function scanFolder(folder) {
  const result = {
    folder,
    name: path.basename(folder) || folder,
    items: [],
    total: 0,
    truncated: false,
    error: null,
    errorMessage: null
  };

  let entries;
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch (err) {
    result.error = err.code === 'ENOENT'
      ? 'not-found'
      : (err.code === 'EACCES' || err.code === 'EPERM' ? 'no-permission' : 'unknown');
    result.errorMessage = chineseMessage(result.error);
    return result;
  }

  const kept = entries.filter((entry) => !isIgnoredName(entry.name));
  result.total = kept.length;
  const limited = kept.slice(0, SCAN_LIMIT);
  result.truncated = kept.length > limited.length;

  const items = await Promise.all(limited.map(async (entry) => {
    const full = path.join(folder, entry.name);
    let mtimeMs = 0;
    try {
      const stat = await fs.lstat(full);
      mtimeMs = stat.mtimeMs;
    } catch { /* ignore */ }
    return {
      name: entry.name,
      path: full,
      isDir: entry.isDirectory(),
      mtimeMs
    };
  }));

  items.sort(sortItems);
  result.items = items;
  return result;
}

module.exports = { scanFolder, sortItems, isIgnoredName, chineseMessage, SCAN_LIMIT };
