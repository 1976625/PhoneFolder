'use strict';

// 设置窗：普通带标题栏窗口，读取/保存 config，保存后由主进程重建瓦片与浮层
const path = require('path');
const { BrowserWindow } = require('electron');

const PRELOAD = path.join(__dirname, '..', '..', 'preload', 'preload.js');
const SETTINGS_HTML = path.join(__dirname, '..', '..', 'renderer', 'settings', 'index.html');
const ICON = path.join(__dirname, '..', '..', '..', 'assets', 'icon.ico');

function createSettingsWindow() {
  const win = new BrowserWindow({
    width: 580,
    height: 720,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'PhoneFolder 设置',
    icon: ICON,
    backgroundColor: '#1b1c22',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  win.setMenu(null);
  win.loadFile(SETTINGS_HTML);
  win.once('ready-to-show', () => win.show());
  return win;
}

module.exports = { createSettingsWindow };
