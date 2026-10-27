'use strict';

// 快捷方式/可执行文件的真实图标：
// Electron 的 app.getFileIcon 对 .lnk 只返回统一的「快捷方式」占位图标，
// 这里用一次 PowerShell（WScript.Shell 解析目标 + ExtractAssociatedIcon）批量取真实图标。
// 一次批量调用约 0.5–1s，结果按 path|mtime 缓存；多个渲染层请求会合并到同一批。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { log } = require('./logger');

const execFileAsync = promisify(execFile);

const SHORTCUT_EXTENSIONS = new Set(['.lnk', '.exe']);
const MAX_BATCH = 40;
const BATCH_DELAY_MS = 60;
const CACHE_LIMIT = 200;

const POWERSHELL_SCRIPT = String.raw`
param([string]$InFile, [string]$OutFile)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$paths = Get-Content -LiteralPath $InFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $paths) { $paths = @() }
$sh = New-Object -ComObject WScript.Shell
$out = @{}
foreach ($p in $paths) {
  try {
    $target = $p
    if ($p -match '(?i)\.lnk$') {
      $lnk = $sh.CreateShortcut($p)
      if ($lnk -and $lnk.TargetPath) { $target = $lnk.TargetPath }
    }
    if (-not (Test-Path -LiteralPath $target)) { $target = $p }
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($target)
    if ($icon) {
      $bmp = $icon.ToBitmap()
      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $out[$p] = [Convert]::ToBase64String($ms.ToArray())
      $ms.Dispose()
      $bmp.Dispose()
      $icon.Dispose()
    }
  } catch { }
}
$json = $out | ConvertTo-Json -Compress
if (-not $json) { $json = '{}' }
[System.IO.File]::WriteAllText($OutFile, $json, [System.Text.Encoding]::UTF8)
`;

const cache = new Map(); // key -> dataUrl | null
const pending = new Map(); // filePath -> { waiters: [resolve] }
const inflight = new Map(); // 批次执行中的去重
let flushTimer = null;

function cacheKey(file, mtimeMs) {
  return `${file}|${Math.round(Number(mtimeMs) || 0)}`;
}

function isShortcutFile(file) {
  return SHORTCUT_EXTENSIONS.has(path.extname(String(file || '')).toLowerCase());
}

function remember(key, value) {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
}

async function runBatch(entries) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-shortcut-icons-'));
  const inFile = path.join(workDir, 'input.json');
  const outFile = path.join(workDir, 'output.json');
  const scriptFile = path.join(workDir, 'resolve-icons.ps1');
  try {
    fs.writeFileSync(inFile, JSON.stringify(entries.map((entry) => entry.filePath)), 'utf8');
    fs.writeFileSync(scriptFile, POWERSHELL_SCRIPT, 'utf8');
    const t0 = Date.now();
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptFile,
      '-InFile', inFile,
      '-OutFile', outFile
    ], { windowsHide: true, timeout: 30000 });
    const raw = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '');
    const map = JSON.parse(raw);
    const result = new Map();
    for (const entry of entries) {
      const base64 = map[entry.filePath];
      result.set(entry.filePath, base64 ? `data:image/png;base64,${base64}` : null);
    }
    log('shortcut icons batch:', entries.length, 'items in', Date.now() - t0, 'ms');
    return result;
  } catch (err) {
    log('shortcut icons batch failed:', err.message);
    return null;
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPending();
  }, BATCH_DELAY_MS);
}

async function flushPending() {
  if (pending.size === 0) return;
  const batch = [];
  for (const [filePath, entry] of pending) {
    batch.push({ filePath, waiters: entry.waiters });
    inflight.set(filePath, entry); // 批次进行中的重复请求合并到这里
    pending.delete(filePath);
    if (batch.length >= MAX_BATCH) break;
  }

  const result = await runBatch(batch.map((entry) => ({ filePath: entry.filePath })));
  for (const entry of batch) {
    const dataUrl = result ? (result.get(entry.filePath) || null) : null;
    if (dataUrl !== null) {
      remember(cacheKey(entry.filePath, 0), dataUrl);
    }
    for (const resolve of entry.waiters) resolve(dataUrl);
    inflight.delete(entry.filePath);
  }
  if (pending.size > 0) scheduleFlush();
}

function makeWaiter(filePath, mtimeMs, resolve) {
  const key = cacheKey(filePath, mtimeMs);
  return (value) => {
    remember(key, value);
    resolve(value);
  };
}

// 返回 Promise<dataUrl | null>
function requestShortcutIcon(filePath, mtimeMs) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  if (!isShortcutFile(filePath)) return Promise.resolve(null);

  const key = cacheKey(filePath, mtimeMs);
  if (cache.has(key)) return Promise.resolve(cache.get(key));

  // 用不带 mtime 的键做共享批次缓存，回填到具体 mtime 键
  const sharedKey = cacheKey(filePath, 0);
  if (cache.has(sharedKey)) {
    const cached = cache.get(sharedKey);
    remember(key, cached);
    return Promise.resolve(cached);
  }

  return new Promise((resolve) => {
    const existing = pending.get(filePath) || inflight.get(filePath);
    if (existing) {
      existing.waiters.push(makeWaiter(filePath, mtimeMs, resolve));
      return;
    }
    pending.set(filePath, { waiters: [makeWaiter(filePath, mtimeMs, resolve)] });
    scheduleFlush();
  });
}

// 扫描完目录后预热快捷方式图标（不阻塞调用方）
function prefetchShortcutIcons(items) {
  if (process.platform !== 'win32' || !Array.isArray(items)) return;
  for (const item of items) {
    if (!item || item.isDir || !isShortcutFile(item.path)) continue;
    requestShortcutIcon(item.path, item.mtimeMs).catch(() => {});
  }
}

function clearShortcutIconCache() {
  cache.clear();
  pending.clear();
  inflight.clear();
}

module.exports = {
  requestShortcutIcon,
  prefetchShortcutIcons,
  clearShortcutIconCache,
  isShortcutFile,
  SHORTCUT_EXTENSIONS
};


