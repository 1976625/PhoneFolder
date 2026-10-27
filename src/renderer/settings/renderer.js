'use strict';

const $ = (id) => document.getElementById(id);

const BACKGROUND_LABELS = {
  wallpaper: '壁纸模糊（推荐）',
  capture: '抓当前桌面（实时感强）',
  acrylic: 'DWM acrylic（实验）'
};

let snapshot = null; // { config, backgroundModes, maxTiles }
let draft = null; // 工作副本
let toastTimer = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function showToast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastTimer = null;
    el.classList.remove('show');
  }, 2000);
}

function showError(text) {
  $('error').textContent = text || '';
}

function makeButton(text, className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn ${className || ''}`.trim();
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

function buildBackgroundOptions() {
  const select = $('background');
  select.textContent = '';
  for (const mode of snapshot.backgroundModes) {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = BACKGROUND_LABELS[mode] || mode;
    select.appendChild(option);
  }
  select.value = draft.overlay.background;
  select.onchange = () => {
    draft.overlay.background = select.value;
  };
}

function render() {
  // 瓦片列表
  const list = $('tile-list');
  list.textContent = '';
  draft.tiles.forEach((tile, index) => {
    const row = document.createElement('div');
    row.className = 'tile-row';

    const badge = document.createElement('span');
    badge.className = 'tile-index';
    badge.textContent = String(index + 1);

    const pathEl = document.createElement('span');
    pathEl.className = 'tile-path';
    pathEl.textContent = tile.folder;
    pathEl.title = tile.folder;

    row.append(badge, pathEl);
    row.append(makeButton('更改', 'mini', async () => {
      const folder = await window.phoneFolder.settingsPickFolder();
      if (!folder) return;
      const duplicated = draft.tiles.some((t, i) => i !== index && t.folder.toLowerCase() === folder.toLowerCase());
      if (duplicated) {
        showError('这个文件夹已经绑定过瓦片了');
        return;
      }
      tile.folder = folder;
      showError('');
      render();
    }));
    if (draft.tiles.length > 1) {
      row.append(makeButton('删除', 'mini danger', () => {
        draft.tiles.splice(index, 1);
        render();
      }));
    }
    list.appendChild(row);
  });

  $('add-tile').disabled = draft.tiles.length >= snapshot.maxTiles;
  $('tile-hint').textContent = draft.tiles.length >= snapshot.maxTiles
    ? `已达上限 ${snapshot.maxTiles} 个`
    : `最多 ${snapshot.maxTiles} 个，同一文件夹只能绑一次`;

  // 外观
  const dimValue = Math.round(draft.overlay.dim * 100);
  $('dim').value = String(dimValue);
  $('dim-val').textContent = `${dimValue}%`;
  $('blur').value = String(draft.overlay.blur);
  $('blur-val').textContent = `${draft.overlay.blur}px`;
  const size = draft.tiles[0] ? draft.tiles[0].size : 84;
  $('size').value = String(size);
  $('size-val').textContent = `${size}px`;
  $('background').value = draft.overlay.background;

  // 系统
  $('autostart').checked = Boolean(draft.app && draft.app.launchAtLogin);
  showError('');
}

function loadSnapshot(next) {
  if (!next || !next.config) return;
  snapshot = next;
  draft = clone(next.config);
  buildBackgroundOptions();
  render();
}

function wireInputs() {
  $('dim').addEventListener('input', () => {
    const value = Number($('dim').value);
    draft.overlay.dim = value / 100;
    $('dim-val').textContent = `${value}%`;
  });
  $('blur').addEventListener('input', () => {
    const value = Number($('blur').value);
    draft.overlay.blur = value;
    $('blur-val').textContent = `${value}px`;
  });
  $('size').addEventListener('input', () => {
    const value = Number($('size').value);
    draft.tiles.forEach((tile) => { tile.size = value; });
    $('size-val').textContent = `${value}px`;
  });
  $('autostart').addEventListener('change', () => {
    draft.app.launchAtLogin = $('autostart').checked;
  });

  $('add-tile').addEventListener('click', async () => {
    if (draft.tiles.length >= snapshot.maxTiles) return;
    const folder = await window.phoneFolder.settingsPickFolder();
    if (!folder) return;
    if (draft.tiles.some((tile) => tile.folder.toLowerCase() === folder.toLowerCase())) {
      showError('这个文件夹已经绑定过瓦片了');
      return;
    }
    const last = draft.tiles[draft.tiles.length - 1];
    const size = last ? last.size : 84;
    const width = window.screen.availWidth || 1920;
    draft.tiles.push({
      folder,
      x: Math.max(0, width - size - 24 - draft.tiles.length * 40),
      y: 24 + draft.tiles.length * 40,
      size
    });
    render();
  });

  $('save').addEventListener('click', async () => {
    showError('');
    const input = {
      tiles: draft.tiles.map((tile) => ({
        folder: tile.folder,
        x: tile.x,
        y: tile.y,
        size: tile.size
      })),
      overlay: { ...draft.overlay },
      app: { launchAtLogin: $('autostart').checked }
    };
    const result = await window.phoneFolder.settingsSave(input);
    if (!result || !result.ok) {
      showError((result && result.error) || '保存失败');
      return;
    }
    showToast('已保存并应用');
  });

  $('cancel').addEventListener('click', () => window.phoneFolder.settingsClose());
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.phoneFolder.settingsClose();
  });
}

window.phoneFolder.onSettingsInit(loadSnapshot);
window.phoneFolder.onSettingsReloaded(loadSnapshot);
window.addEventListener('DOMContentLoaded', async () => {
  wireInputs();
  // 兜底：即使 init 消息早于监听注册，也主动拉一次
  if (!snapshot) {
    const data = await window.phoneFolder.settingsGet();
    if (data) loadSnapshot(data);
  }
});
