'use strict';

const thumbsEl = document.getElementById('thumbs');
const labelEl = document.getElementById('label');
const tileEl = document.getElementById('tile');

function iconBackground(hue) {
  const h = Number(hue) || 220;
  return `linear-gradient(145deg, hsl(${h} 78% 62%), hsl(${h + 28} 76% 46%))`;
}

function renderPreview(preview) {
  thumbsEl.textContent = '';
  for (const item of (preview || []).slice(0, 4)) {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.style.background = iconBackground(item.hue);
    el.textContent = item.emoji || '';
    thumbsEl.appendChild(el);
  }
}

window.phoneFolder.onTileInit((data) => {
  labelEl.textContent = data.folderName || '文件夹';
  renderPreview(data.preview);
});

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
