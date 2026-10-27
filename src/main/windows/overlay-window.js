'use strict';

// 浮层窗：该显示器全屏、置顶。
// 默认 capture 模式：不透明窗口 + 渲染层铺抓屏图（CSS blur + 压暗），避免透明窗 + DWM 材质的兼容坑。
// PF_BG=acrylic 时退化为透明 + DWM acrylic（实验用）。
const path = require('path');
const { BrowserWindow, screen } = require('electron');
const {
  mode: backgroundMode,
  warmCapture,
  getCachedCapture,
  warmWallpaper,
  getCachedWallpaper,
  readWallpaperDataUrl
} = require('../services/background');
const { log } = require('../services/logger');

const PRELOAD = path.join(__dirname, '..', '..', 'preload', 'preload.js');
const OVERLAY_HTML = path.join(__dirname, '..', '..', 'renderer', 'overlay', 'index.html');

class OverlayWindow {
  constructor(backgroundModeName) {
    this.mode = backgroundModeName || backgroundMode();
    this.display = screen.getPrimaryDisplay();
    this.win = null;
    this.readyPromise = null;
    this.isOpen = false;
  }

  dispose() {
    if (this.win) {
      try { this.win.destroy(); } catch { /* ignore */ }
      this.win = null;
    }
    this.readyPromise = null;
    this.isOpen = false;
  }

  ensure() {
    if (this.win) return this.readyPromise;

    const b = this.display.bounds;
    const acrylic = this.mode === 'acrylic';
    const options = {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      transparent: acrylic,
      backgroundColor: acrylic ? '#00000000' : '#0b0b10',
      show: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      roundedCorners: false,
      title: 'PhoneFolder Overlay',
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
        devTools: true
      }
    };
    if (acrylic) options.backgroundMaterial = 'acrylic';

    this.win = new BrowserWindow(options);
    // Windows 会把无边框窗口的初始尺寸夹到工作区（少 48px 任务栏）；
    // 隐藏状态下 setBounds 铺满；show 之后再 setBounds 会冲掉 topmost。
    this.win.setBounds(b);
    this.win.loadFile(OVERLAY_HTML);
    this.readyPromise = new Promise((resolve) => {
      this.win.webContents.once('did-finish-load', () => resolve());
    });
    this.win.on('closed', () => {
      this.win = null;
      this.readyPromise = null;
      this.isOpen = false;
    });

    log('overlay window created', {
      mode: this.mode,
      bounds: b,
      scaleFactor: this.display.scaleFactor
    });
    return this.readyPromise;
  }

  preparePayload(payload) {
    if (this.mode === 'capture') {
      const cached = getCachedCapture();
      if (cached) {
        payload.backgroundImage = cached;
      } else {
        // 首次没有缓存：先用静态壁纸顶上，同时后台抓桌面缓存放着下次用
        payload.backgroundImage = getCachedWallpaper() || readWallpaperDataUrl();
        warmCapture(this.display).catch(() => {});
      }
    } else if (this.mode === 'wallpaper') {
      payload.backgroundImage = getCachedWallpaper() || readWallpaperDataUrl();
      warmWallpaper().catch(() => {});
    } else {
      payload.backgroundImage = null;
    }
    return payload;
  }

  async open(payload) {
    await this.ensure();
    if (!this.win) return;
    if (this.isOpen) return;
    this.isOpen = true;
    this.win.show();
    this.win.focus();
    this.win.webContents.send('overlay:open', payload);
  }

  requestClose() {
    if (!this.win || !this.isOpen) return;
    this.win.webContents.send('overlay:close');
  }

  hide() {
    this.isOpen = false;
    if (this.win) this.win.hide();
  }
}

module.exports = { OverlayWindow };
