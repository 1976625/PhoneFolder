'use strict';

// 瓦片窗：84×84 圆角缩略图 + 20px 标签，透明、无边框、不在任务栏/Alt+Tab
const path = require('path');
const { BrowserWindow } = require('electron');
const { log } = require('../services/logger');

const PRELOAD = path.join(__dirname, '..', '..', 'preload', 'preload.js');
const TILE_HTML = path.join(__dirname, '..', '..', 'renderer', 'tile', 'index.html');
const ICON = path.join(__dirname, '..', '..', '..', 'assets', 'icon.ico');

const LABEL_HEIGHT = 20;

function createTileWindow(tile, { visible = true } = {}) {
  const win = new BrowserWindow({
    x: tile.x,
    y: tile.y,
    width: tile.size,
    height: tile.size + LABEL_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    show: false,
    alwaysOnTop: false,
    focusable: false,
    title: 'PhoneFolder',
    icon: ICON,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
      devTools: true
    }
  });

  win.loadFile(TILE_HTML);
  win.once('ready-to-show', () => {
    if (visible) win.showInactive();
  });

  // 任务栏「显示桌面」/ Win+D 会把所有普通窗口最小化，瓦片也会跟着消失；
  // 这里收到 minimize 立即还原（瓦片本身 minimizable:false，不存在用户主动最小化的情况）。
  win.on('minimize', () => {
    log('tile minimize event, restoring', tile.id);
    setTimeout(() => {
      if (win.isDestroyed()) return;
      try {
        win.restore();
        win.showInactive();
      } catch (err) {
        log('tile restore failed:', err.message);
      }
    }, 80);
  });

  return win;
}

module.exports = { createTileWindow, LABEL_HEIGHT };


