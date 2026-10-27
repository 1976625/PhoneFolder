'use strict';

const thumbsEl = document.getElementById('thumbs');
const labelEl = document.getElementById('label');
const tileEl = document.getElementById('tile');

const GLYPH_BY_EXT = {
  md: '📄', txt: '📄', doc: '📝', docx: '📝', pdf: '📕',
  xls: '📊', xlsx: '📊', csv: '📊', ppt: '📽️', pptx: '📽️',
  zip: '🗜️', rar: '🗜️', '7z': '🗜️', exe: '⚙️', msi: '⚙️', lnk: '🔗',
  jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', bmp: '🖼️', svg: '🖼️',
  mp4: '🎬', mkv: '🎬', mov: '🎬', avi: '🎬', webm: '🎬',
  mp3: '🎵', wav: '🎵', flac: '🎵'
};
let tileSize = 84;

const THUMB_EXT = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'ico',
  'mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv'
]);

function iconBackground(hue) {
  const h = Number(hue) || 220;
  return `linear-gradient(145deg, hsl(${h} 70% 56% / 0.92), hsl(${h + 30} 72% 40% / 0.95))`;
}

function hueFromName(name) {
  let hash = 0;
  const text = String(name || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360;
  }
  return hash;
}

function extOf(name) {
  const idx = String(name || '').lastIndexOf('.');
  return idx > 0 ? String(name).slice(idx + 1).toLowerCase() : '';
}

function glyphFor(item) {
  if (item.isDir) return '📁';
  return GLYPH_BY_EXT[extOf(item.name)] || '📄';
}

function isThumb(item) {
  return !item.isDir && THUMB_EXT.has(extOf(item.name));
}

function loadIcon(item, el, glyph) {
  window.phoneFolder.getIcon({
    path: item.path,
    isDir: item.isDir,
    mtimeMs: item.mtimeMs
  }).then((payload) => {
    if (!payload || !payload.dataUrl || !el.isConnected) return;
    el.classList.add('has-image', payload.kind === 'thumb' ? 'kind-thumb' : 'kind-icon');
    // inline background 简写会重置 background-size，这里必须明确写回
    el.style.background = 'transparent';
    el.style.backgroundImage = `url("${payload.dataUrl}")`;
    const iconPx = Math.round(tileSize * 0.31);
    el.style.backgroundSize = payload.kind === 'thumb' ? 'cover' : `${iconPx}px ${iconPx}px`;
    el.style.backgroundPosition = 'center';
    el.style.backgroundRepeat = 'no-repeat';
    glyph.remove();
  }).catch(() => { /* ignore */ });
}

function applyTileSize(size) {
  const value = Math.min(Math.max(Math.round(Number(size) || 84), 64), 128);
  tileSize = value;
  document.documentElement.style.setProperty('--tile-size', `${value}px`);
}

function renderThumb(item) {
  const el = document.createElement('div');
  el.className = 'thumb';
  el.style.background = iconBackground(hueFromName(item.name));
  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  glyph.textContent = glyphFor(item);
  el.appendChild(glyph);
  loadIcon(item, el, glyph);
  return el;
}

let currentLabel = '文件夹';
let feedbackTimer = null;

function render(data) {
  applyTileSize(data.size);
  const isError = Boolean(data.error);
  currentLabel = isError ? '读取失败' : (data.displayName || data.folderName || '文件夹');
  if (!feedbackTimer) labelEl.textContent = currentLabel;

  thumbsEl.textContent = '';
  thumbsEl.classList.toggle('empty', !isError && (!data.items || data.items.length === 0));
  thumbsEl.classList.toggle('error', isError);

  if (isError) {
    const glyph = document.createElement('span');
    glyph.className = 'tile-glyph';
    glyph.textContent = '⚠️';
    thumbsEl.appendChild(glyph);
    return;
  }

  if (!data.items || data.items.length === 0) {
    // 空瓦片：只保留虚线框（用户反馈不需要文件夹图标）
    return;
  }

  for (const item of data.items.slice(0, 4)) {
    thumbsEl.appendChild(renderThumb(item));
  }
}

window.phoneFolder.onTileInit(render);
window.phoneFolder.onTileRefresh(render);

const DRAG_THRESHOLD = 4;
let pressed = false;
let dragging = false;
let suppressClick = false;
let startScreen = { x: 0, y: 0 };

tileEl.addEventListener('mouseenter', () => {
  // 预热背景缓存，保证点击后浮层 150ms 内出现
  window.phoneFolder.hoverTile();
});

tileEl.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  pressed = true;
  dragging = false;
  suppressClick = false;
  startScreen = { x: event.screenX, y: event.screenY };
  tileEl.classList.add('pressed');
  window.phoneFolder.dragStart();
});

window.addEventListener('mousemove', (event) => {
  if (!pressed) return;
  const moved = Math.abs(event.screenX - startScreen.x) + Math.abs(event.screenY - startScreen.y);
  if (!dragging && moved > DRAG_THRESHOLD) {
    dragging = true;
    tileEl.classList.add('dragging');
  }
  if (dragging) {
    window.phoneFolder.dragMove(event.screenX, event.screenY);
  }
});

window.addEventListener('mouseup', () => {
  if (!pressed) return;
  pressed = false;
  tileEl.classList.remove('pressed', 'dragging');
  if (dragging) {
    suppressClick = true;
    window.phoneFolder.dragEnd();
  }
  dragging = false;
});

tileEl.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.phoneFolder.showTileMenu();
});

tileEl.addEventListener('click', (event) => {
  event.preventDefault();
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  window.phoneFolder.activateTile();
});

/* ---------------------------- 拖入移入 ---------------------------- */
function hasFiles(event) {
  return Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types || []).includes('Files');
}

function flashResult(summary) {
  if (!summary) return;
  const moved = Number(summary.moved) || 0;
  const failed = Number(summary.failed) || 0;
  labelEl.textContent = failed > 0 ? `${moved} 移入 / ${failed} 失败` : `已移入 ${moved} 项`;
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    feedbackTimer = null;
    labelEl.textContent = currentLabel;
  }, 1900);
}

let dropDepth = 0;

document.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dropDepth += 1;
  tileEl.classList.add('drag-over');
});

document.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  tileEl.classList.add('drag-over');
});

document.addEventListener('dragleave', (event) => {
  if (!hasFiles(event)) return;
  dropDepth = Math.max(0, dropDepth - 1);
  if (dropDepth === 0) tileEl.classList.remove('drag-over');
});

document.addEventListener('drop', async (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dropDepth = 0;
  tileEl.classList.remove('drag-over');

  const files = Array.from(event.dataTransfer.files || []);
  const paths = files.map((file) => {
    try {
      return window.phoneFolder.getPathForFile(file);
    } catch {
      return null;
    }
  }).filter(Boolean);
  if (paths.length === 0) return;

  const summary = await window.phoneFolder.dropFiles(paths);
  flashResult(summary);
});

