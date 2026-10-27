'use strict';

// 文件移入：rename 优先，跨盘 EXDEV 回退 copy+delete；同名自动追加 " (n)"；中文错误映射
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

function splitName(name) {
  const ext = path.extname(name);
  return ext ? { base: name.slice(0, -ext.length), ext } : { base: name, ext: '' };
}

function suffixedName(name, index) {
  const { base, ext } = splitName(name);
  return `${base} (${index})${ext}`;
}

// 找目标目录里第一个不冲突的名字（同名文件/文件夹自动加 (1)、(2)…）
async function findAvailableName(dir, name) {
  let candidate = name;
  let index = 1;
  while (index < 1000) {
    try {
      await fsp.lstat(path.join(dir, candidate));
      candidate = suffixedName(name, index);
      index += 1;
    } catch (err) {
      if (err && err.code === 'ENOENT') return candidate;
      throw err;
    }
  }
  return suffixedName(name, Date.now());
}

function chineseFsError(err) {
  switch (err && err.code) {
    case 'EACCES':
    case 'EPERM':
      return '没有权限（文件可能被占用或受保护）';
    case 'ENOSPC':
      return '磁盘空间不足';
    case 'EBUSY':
      return '文件正被其他程序占用';
    case 'ENOENT':
      return '源文件不存在或已被移动';
    case 'EEXIST':
      return '目标位置已存在同名文件';
    case 'EMFILE':
    case 'ENFILE':
      return '打开的文件过多，请稍后再试';
    default:
      return (err && err.message) || '移动失败';
  }
}

async function moveOne(source, targetFolder) {
  const src = path.resolve(source);
  const target = path.resolve(targetFolder);
  const name = path.basename(src);
  const baseResult = { name, path: src };

  if (src === target) {
    return { ...baseResult, status: 'failed', message: '不能把文件夹移动到自身' };
  }
  if (target.startsWith(src + path.sep)) {
    return { ...baseResult, status: 'failed', message: '不能移动到自身内部' };
  }
  const rel = path.relative(target, src);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return { ...baseResult, status: 'skipped', message: '已在目标文件夹内' };
  }

  try {
    await fsp.lstat(src);
  } catch (err) {
    return { ...baseResult, status: 'failed', message: chineseFsError(err) };
  }

  const available = await findAvailableName(target, name);
  const dest = path.join(target, available);

  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if (err && err.code === 'EXDEV') {
      try {
        await fsp.cp(src, dest, { recursive: true, errorOnExist: true });
        await fsp.rm(src, { recursive: true, force: true });
      } catch (copyErr) {
        return { ...baseResult, status: 'failed', message: chineseFsError(copyErr) };
      }
    } else {
      return { ...baseResult, status: 'failed', message: chineseFsError(err) };
    }
  }

  return {
    ...baseResult,
    status: 'moved',
    movedTo: dest,
    renamed: available !== name
  };
}

async function moveIntoFolder(sources, targetFolder) {
  const summary = { moved: 0, skipped: 0, failed: 0, results: [] };
  for (const source of sources) {
    if (typeof source !== 'string' || !source) continue;
    const result = await moveOne(source, targetFolder);
    summary.results.push(result);
    if (result.status === 'moved') summary.moved += 1;
    else if (result.status === 'skipped') summary.skipped += 1;
    else summary.failed += 1;
  }
  return summary;
}

module.exports = { moveIntoFolder, moveOne, findAvailableName, suffixedName, chineseFsError };
