'use strict';

// 截图/演示用的“假桌面”背景：全屏不透明窗口，铺当前壁纸，放在最底层
// 只在 --shot 模式使用，避免把用户桌面上其他窗口拍进截图
const path = require('path');
const { BrowserWindow, screen } = require('electron');

const PRELOAD = path.join(__dirname, '..', '..', 'preload', 'preload.js');
const BACKDROP_HTML = path.join(__dirname, '..', '..', 'renderer', 'backdrop', 'index.html');

function createBackdropWindow(wallpaperDataUrl) {
  const display = screen.getPrimaryDisplay();
  const b = display.bounds;

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      show: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      backgroundColor: '#141418',
      title: 'PhoneFolder Backdrop',
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });

    win.loadFile(BACKDROP_HTML);
    // 同 overlay：先隐藏状态下铺满，show 后不要再 setBounds（会冲掉窗口样式）
    win.setBounds(b);
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('backdrop:init', { image: wallpaperDataUrl || null });
      win.show();
      resolve(win);
    });
  });
}

module.exports = { createBackdropWindow };
