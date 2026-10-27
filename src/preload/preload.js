'use strict';

// 对外暴露给 renderer 的最小 API（contextBridge）
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('phoneFolder', {
  // 瓦片页
  onTileInit: (cb) => ipcRenderer.on('tile:init', (_event, data) => cb(data)),
  onTileRefresh: (cb) => ipcRenderer.on('tile:refresh', (_event, data) => cb(data)),
  activateTile: () => ipcRenderer.send('tile:activate'),
  hoverTile: () => ipcRenderer.send('tile:hover'),
  showTileMenu: () => ipcRenderer.send('tile:contextmenu'),
  dragStart: () => ipcRenderer.send('tile:drag-start'),
  dragMove: (x, y) => ipcRenderer.send('tile:drag-move', x, y),
  dragEnd: () => ipcRenderer.send('tile:drag-end'),

  // 浮层页
  onOverlayOpen: (cb) => ipcRenderer.on('overlay:open', (_event, data) => cb(data)),
  onOverlayRefresh: (cb) => ipcRenderer.on('overlay:refresh', (_event, data) => cb(data)),
  onOverlayClose: (cb) => ipcRenderer.on('overlay:close', () => cb()),
  notifyOverlayHidden: () => ipcRenderer.send('overlay:hidden'),
  renameTile: (name) => ipcRenderer.invoke('tile:rename', name),

  // 文件/图标
  getIcon: (item) => ipcRenderer.invoke('icons:get', item),
  openItem: (itemPath) => ipcRenderer.send('item:open', itemPath),
  showItemMenu: (itemPath) => ipcRenderer.send('item:menu', itemPath),
  dropFiles: (paths) => ipcRenderer.invoke('files:drop-in', paths),
  reorderItems: (orderedNames) => ipcRenderer.invoke('items:reorder', orderedNames),
  dragOut: (payload) => ipcRenderer.send('item:drag-out', payload),

  // 截图用假桌面
  onBackdropInit: (cb) => ipcRenderer.on('backdrop:init', (_event, data) => cb(data)),

  // 设置页
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSave: (input) => ipcRenderer.invoke('settings:save', input),
  settingsPickFolder: () => ipcRenderer.invoke('settings:pick-folder'),
  settingsOpenFolder: (folderPath) => ipcRenderer.invoke('settings:open-folder', folderPath),
  settingsOpenDataDir: () => ipcRenderer.invoke('settings:open-data-dir'),
  realignTiles: () => ipcRenderer.invoke('tiles:realign'),
  settingsClose: () => ipcRenderer.send('settings:close'),
  onSettingsInit: (cb) => ipcRenderer.on('settings:init', (_event, data) => cb(data)),
  onSettingsReloaded: (cb) => ipcRenderer.on('settings:reloaded', (_event, data) => cb(data)),

  // 通用
  getConfig: () => ipcRenderer.invoke('config:get'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  log: (...args) => ipcRenderer.send('log', args.map(String).join(' '))
});




