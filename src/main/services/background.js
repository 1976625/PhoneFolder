'use strict';

// 背景方案（PF_BG 可切换，默认 wallpaper）：
//  - wallpaper（默认）：读当前壁纸 → nativeImage 缩到 640 宽 → JPEG data URL，渲染层 CSS 模糊 + 压暗。
//    干净、不采集用户窗口内容、零抓屏延迟；启动/悬停时异步预热缓存。
//  - capture（可选）：抓当前桌面缩略图（会把打开着的窗口一起模糊进来），效果最“实时”，
//    但 desktopCapturer 一次约 0.8–1s，只能靠缓存预热。
//  - acrylic（实验）：DWM acrylic 实时模糊；Win11 浅色主题下偏奶白，效果一般。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { desktopCapturer, nativeImage, screen } = require('electron');
const { log } = require('./logger');

const execFileAsync = promisify(execFile);

const CAPTURE_WIDTH = 640;
const WALLPAPER_WIDTH = 640;
const WALLPAPER_MAX_AGE_MS = 10 * 60 * 1000;
const CAPTURE_MAX_AGE_MS = 5 * 60 * 1000;

let captureCache = null; // { dataUrl, at }
let captureInflight = null;
let wallpaperCache = null; // { path, mtimeMs, dataUrl, at }
let wallpaperInflight = null;

function envMode() {
  const pref = (process.env.PF_BG || '').toLowerCase();
  return (pref === 'acrylic' || pref === 'capture' || pref === 'wallpaper') ? pref : null;
}

function mode() {
  return envMode() || 'wallpaper';
}

/* ------------------------------ capture ------------------------------ */

function captureSizeFor(display) {
  const aspect = (display.bounds.width || 16) / (display.bounds.height || 9);
  return {
    width: CAPTURE_WIDTH,
    height: Math.max(64, Math.round(CAPTURE_WIDTH / aspect))
  };
}

function warmCapture(display, { force = false } = {}) {
  if (captureInflight) return captureInflight;
  if (!force && captureCache && Date.now() - captureCache.at < 1500) return Promise.resolve(null);

  const target = display || screen.getPrimaryDisplay();
  const size = captureSizeFor(target);
  captureInflight = (async () => {
    const t0 = Date.now();
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: size,
        fetchWindowIcons: false
      });
      const source = sources.find((s) => String(s.display_id) === String(target.id)) || sources[0];
      if (!source) throw new Error('no screen source');
      captureCache = { dataUrl: source.thumbnail.toDataURL(), at: Date.now() };
      log('desktop capture warmed in', Date.now() - t0, 'ms', `${size.width}x${size.height}`);
      return captureCache.dataUrl;
    } catch (err) {
      log('warm capture failed:', err.message);
      return null;
    } finally {
      captureInflight = null;
    }
  })();
  return captureInflight;
}

function getCachedCapture(maxAgeMs = CAPTURE_MAX_AGE_MS) {
  if (!captureCache) return null;
  if (Date.now() - captureCache.at > maxAgeMs) return null;
  return captureCache.dataUrl;
}

/* ----------------------------- wallpaper ----------------------------- */

async function registryWallpaperPath() {
  try {
    const { stdout } = await execFileAsync(
      'reg',
      ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'],
      { encoding: 'utf8', windowsHide: true }
    );
    const match = stdout.match(/WallPaper\s+REG_SZ\s+(.+)/);
    if (match && match[1].trim()) return match[1].trim();
  } catch { /* ignore */ }
  return null;
}

function transcodedWallpaperPath() {
  return path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
}

function imageFileToSmallDataUrl(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) return null;
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) {
      // 非常规格式：退回原始文件 data URL
      const ext = path.extname(file).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return { dataUrl: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`, mtimeMs: stat.mtimeMs };
    }
    const small = image.getSize().width > WALLPAPER_WIDTH
      ? image.resize({ width: WALLPAPER_WIDTH, quality: 'good' })
      : image;
    const jpeg = small.toJPEG(76);
    return { dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function warmWallpaper() {
  if (wallpaperInflight) return wallpaperInflight;
  wallpaperInflight = (async () => {
    const t0 = Date.now();
    try {
      let file = await registryWallpaperPath();
      if (!file || !fs.existsSync(file)) file = transcodedWallpaperPath();
      if (!file || !fs.existsSync(file)) {
        log('warm wallpaper: no wallpaper file found');
        return null;
      }
      const stat = fs.statSync(file);
      if (wallpaperCache && wallpaperCache.path === file && wallpaperCache.mtimeMs === stat.mtimeMs) {
        return wallpaperCache.dataUrl;
      }
      const built = imageFileToSmallDataUrl(file);
      if (!built) return null;
      wallpaperCache = { path: file, mtimeMs: built.mtimeMs, dataUrl: built.dataUrl, at: Date.now() };
      log('wallpaper warmed in', Date.now() - t0, 'ms', file);
      return wallpaperCache.dataUrl;
    } catch (err) {
      log('warm wallpaper failed:', err.message);
      return null;
    } finally {
      wallpaperInflight = null;
    }
  })();
  return wallpaperInflight;
}

function getCachedWallpaper(maxAgeMs = WALLPAPER_MAX_AGE_MS) {
  if (!wallpaperCache) return null;
  if (Date.now() - wallpaperCache.at > maxAgeMs) return null;
  return wallpaperCache.dataUrl;
}

// 同步兜底（首次打开时缓存还没预热好，宁可慢一点也别没背景）
function readWallpaperDataUrl() {
  const candidates = [];
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], {
      encoding: 'utf8',
      windowsHide: true
    });
    const match = out.match(/WallPaper\s+REG_SZ\s+(.+)/);
    if (match) candidates.push(match[1].trim());
  } catch { /* ignore */ }
  candidates.push(transcodedWallpaperPath());

  for (const file of candidates) {
    if (!file) continue;
    try {
      if (!fs.existsSync(file)) continue;
    } catch {
      continue;
    }
    const built = imageFileToSmallDataUrl(file);
    if (built) {
      const stat = fs.statSync(file);
      wallpaperCache = { path: file, mtimeMs: stat.mtimeMs, dataUrl: built.dataUrl, at: Date.now() };
      return built.dataUrl;
    }
  }
  return null;
}

function windowsBuild() {
  return Number(os.release().split('.')[2] || 0);
}

module.exports = {
  mode,
  envMode,
  warmCapture,
  getCachedCapture,
  warmWallpaper,
  getCachedWallpaper,
  readWallpaperDataUrl,
  windowsBuild
};




