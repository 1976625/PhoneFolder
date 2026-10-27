'use strict';

// 瓦片窗：84×84 圆角缩略图 + 20px 标签，透明、无边框、不在任务栏/Alt+Tab
const path = require('path');
const { BrowserWindow } = require('electron');

const PRELOAD = path.join(__dirname, '..', '..', 'preload', 'preload.js');
const TILE_HTML = path.join(__dirname, '..', '..', 'renderer', 'tile', 'index.html');

const LABEL_HEIGHT = 20;

function createTileWindow(tile) {
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
    focusable: true,
    title: 'PhoneFolder',
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
  win.once('ready-to-show', () => win.show());
  return win;
}

module.exports = { createTileWindow, LABEL_HEIGHT };
