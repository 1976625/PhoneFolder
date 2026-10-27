'use strict';

const bgEl = document.getElementById('bg');
const dimEl = document.getElementById('dim');
const panelEl = document.getElementById('panel');
const titleEl = document.getElementById('title');
const eyebrowEl = document.getElementById('eyebrow');
const gridEl = document.getElementById('grid');
const dotsEl = document.getElementById('dots');
const toastEl = document.getElementById('toast');
const dropHintEl = document.getElementById('drop-hint');
const dropFolderEl = document.getElementById('drop-folder');

const GROW_SCALE = 0.19;
const OPEN_MS = 380;
const CLOSE_MS = 240;
const GLYPH_BY_EXT = {
  md: '📄', txt: '📄', doc: '📝', docx: '📝', pdf: '📕',
  xls: '📊', xlsx: '📊', csv: '📊', ppt: '📽️', pptx: '📽️',
  zip: '🗜️', rar: '🗜️', '7z': '🗜️', exe: '⚙️', msi: '⚙️', lnk: '🔗',
  jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', bmp: '🖼️', svg: '🖼️',
  mp4: '🎬', mkv: '🎬', mov: '🎬', avi: '🎬', webm: '🎬',
  mp3: '🎵', wav: '🎵', flac: '🎵'
};

let isOpen = false;
let isClosing = false;
let closeTimer = null;
let page = 0;
let items = [];
let pageSize = 9;
let total = 0;
let error = null;
let errorMessage = null;
let truncated = false;
let tileRect = null;
let openedAt = 0;
const iconCache = new Map(); // path -> { dataUrl, kind }
const ICON_CACHE_LIMIT = 200;

function rememberIcon(path, payload) {
  if (iconCache.size >= ICON_CACHE_LIMIT) {
    iconCache.delete(iconCache.keys().next().value);
  }
  iconCache.set(path, payload);
}

function measurePerf(label) {
  const start = performance.now();
  let frames = 0;
  function tick() {
    frames += 1;
    const elapsed = performance.now() - start;
    if (elapsed < 500) {
      requestAnimationFrame(tick);
    } else {
      window.phoneFolder.log(`perf ${label}: ${frames} frames in ${Math.round(elapsed)}ms (~${(frames / (elapsed / 1000)).toFixed(1)} fps)`);
    }
  }
  requestAnimationFrame(tick);
}

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

// 面板里隐藏快捷方式的 .lnk 后缀（文件本身不改名）
function displayItemName(name) {
  return String(name || '').replace(/\.lnk$/i, '');
}

function glyphFor(item) {
  if (item.isDir) return '📁';
  return GLYPH_BY_EXT[extOf(item.name)] || '📄';
}

function pagesCount() {
  return Math.max(1, Math.ceil(items.length / pageSize));
}

function clampPage() {
  const last = pagesCount() - 1;
  if (page > last) page = last;
  if (page < 0) page = 0;
}

function renderHead(folderName) {
  const pages = pagesCount();
  let eyebrow = '';
  if (error) {
    eyebrow = '读取失败';
  } else if (pages > 1) {
    eyebrow = `${items.length + (truncated ? '+' : '')} 项 · 第 ${page + 1}/${pages} 页`;
  } else {
    eyebrow = `${items.length}${truncated ? '+' : ''} 项`;
  }
  eyebrowEl.textContent = eyebrow;
  titleEl.textContent = folderName || '文件夹';
}

/* ---------------------------- 重命名瓦片 ---------------------------- */
let titleInput = null;

function cancelTitleEdit() {
  if (!titleInput) return;
  titleInput.remove();
  titleInput = null;
  titleEl.style.display = '';
}

function finishTitleEdit(commit) {
  if (!titleInput) return;
  const value = titleInput.value;
  cancelTitleEdit();
  if (!commit) {
    renderHead(folderNameRef);
    return;
  }
  const name = String(value || '').trim().slice(0, 24);
  window.phoneFolder.renameTile(name).then((result) => {
    if (!result || !result.ok) {
      showToastText((result && result.error) || '重命名失败');
      renderHead(folderNameRef);
      return;
    }
    folderNameRef = result.displayName || name || folderNameRef;
    dropFolderEl.textContent = folderNameRef;
    renderHead(folderNameRef);
  }).catch(() => {
    showToastText('重命名失败');
    renderHead(folderNameRef);
  });
}

function startTitleEdit() {
  if (titleInput || !isOpen) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'title-input';
  input.maxLength = 24;
  input.spellcheck = false;
  input.value = folderNameRef || '文件夹';
  titleInput = input;
  titleEl.style.display = 'none';
  titleEl.parentNode.insertBefore(input, titleEl);
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finishTitleEdit(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishTitleEdit(false);
    }
  });
  input.addEventListener('blur', () => { if (titleInput) finishTitleEdit(true); });
  input.addEventListener('mousedown', (event) => event.stopPropagation());
  input.addEventListener('click', (event) => event.stopPropagation());
  input.focus();
  input.select();
}

titleEl.title = '点击重命名';
titleEl.addEventListener('click', (event) => {
  event.stopPropagation();
  startTitleEdit();
});

function renderDots() {
  dotsEl.textContent = '';
  const pages = pagesCount();
  if (pages <= 1) {
    dotsEl.classList.add('is-hidden');
    return;
  }
  dotsEl.classList.remove('is-hidden');
  for (let i = 0; i < pages; i += 1) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = i === page ? 'dot active' : 'dot';
    dot.addEventListener('click', (event) => {
      event.stopPropagation();
      if (i !== page) {
        page = i;
        renderPage(-1);
      }
    });
    dotsEl.appendChild(dot);
  }
}

function loadIcon(item, iconWrap, glyph) {
  const cached = iconCache.get(item.path);
  if (cached) {
    applyIcon(iconWrap, glyph, cached);
    return;
  }
  window.phoneFolder.getIcon({
    path: item.path,
    isDir: item.isDir,
    mtimeMs: item.mtimeMs
  }).then((payload) => {
    if (!payload || !payload.dataUrl) return;
    rememberIcon(item.path, payload);
    if (iconWrap.isConnected) applyIcon(iconWrap, glyph, payload);
  }).catch(() => { /* ignore */ });
}

function applyIcon(iconWrap, glyph, payload) {
  iconWrap.classList.add('has-image', payload.kind === 'thumb' ? 'kind-thumb' : 'kind-icon');
  // 注意：前面用 inline 的 background 简写画了渐变占位，简写会把 background-size 重置成 auto，
  // 这里必须把 size/position/repeat 也用 inline 明确写回，否则缩略图会被裁切成局部放大。
  iconWrap.style.background = 'transparent';
  iconWrap.style.backgroundImage = `url("${payload.dataUrl}")`;
  iconWrap.style.backgroundSize = payload.kind === 'thumb' ? 'cover' : '44px 44px';
  iconWrap.style.backgroundPosition = 'center';
  iconWrap.style.backgroundRepeat = 'no-repeat';
  glyph.remove();
}

function itemEl(item, index) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'item';
  btn.style.animationDelay = `${index * 18}ms`;

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.style.background = iconBackground(hueFromName(item.name));

  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  glyph.textContent = glyphFor(item);
  icon.appendChild(glyph);

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = displayItemName(item.name);

  btn.append(icon, name);
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (suppressClick) return;
    icon.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(0.9)' }, { transform: 'scale(1)' }],
      { duration: 220, easing: 'ease-out' }
    );
    window.phoneFolder.openItem(item.path);
    closeOverlay();
  });
  btn.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.phoneFolder.showItemMenu(item.path);
  });
  // 拖出：按下后移动超过阈值就调用 Electron 原生 startDrag（一次一个文件）。
  // 注意：<button> 上的 HTML5 dragstart 不可靠，所以不用 draggable，直接走 pointer 事件。
  let dragPointer = null;
  let suppressClick = false;
  btn.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragPointer = { x: event.screenX, y: event.screenY, started: false };
  });
  btn.addEventListener('pointermove', (event) => {
    if (!dragPointer || dragPointer.started) return;
    const moved = Math.abs(event.screenX - dragPointer.x) + Math.abs(event.screenY - dragPointer.y);
    if (moved < 6) return;
    dragPointer.started = true;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 1500);
    btn.classList.add('dragging-out');
    const cached = iconCache.get(item.path);
    window.phoneFolder.dragOut({
      path: item.path,
      iconDataUrl: cached ? cached.dataUrl : null
    });
  });
  const endPointerDrag = () => { dragPointer = null; };
  btn.addEventListener('pointerup', endPointerDrag);
  btn.addEventListener('pointercancel', endPointerDrag);
  btn.addEventListener('pointerleave', () => { if (dragPointer && !dragPointer.started) dragPointer = null; });

  loadIcon(item, icon, glyph);
  return btn;
}

function renderMessage(kind) {
  const box = document.createElement('div');
  box.className = 'placeholder';
  if (kind === 'error') {
    const icon = document.createElement('div');
    icon.className = 'placeholder-icon';
    icon.textContent = '⚠️';
    box.appendChild(icon);
  }
  const text = document.createElement('div');
  text.className = 'placeholder-text';
  text.textContent = kind === 'error' ? (errorMessage || '文件夹读取失败') : '这个瓦片还是空的';
  const hint = document.createElement('div');
  hint.className = 'placeholder-hint';
  hint.textContent = kind === 'error' ? '右键瓦片 → 重新扫描' : '把桌面上的文件 / 文件夹拖到瓦片上或这里';
  box.append(text, hint);
  gridEl.appendChild(box);
}

function renderPage() {
  gridEl.textContent = '';
  gridEl.classList.remove('is-empty', 'is-error', 'items-in');
  clampPage();

  if (error) {
    gridEl.classList.add('is-error');
    renderMessage('error');
  } else if (items.length === 0) {
    gridEl.classList.add('is-empty');
    renderMessage('empty');
  } else {
    const start = page * pageSize;
    items.slice(start, start + pageSize).forEach((item, index) => {
      gridEl.appendChild(itemEl(item, index));
    });
  }

  renderHead(folderNameRef);
  renderDots();
  void gridEl.offsetWidth;
  gridEl.classList.add('items-in');
}

let folderNameRef = '';

function changePage(delta) {
  if (error || items.length === 0) return;
  const next = page + delta;
  if (next < 0 || next >= pagesCount()) return;
  page = next;
  renderPage();
}

function centerPanel() {
  // 关键：上一次关闭动画的 transition 还在，直接改 transform 会被当成新的过渡，
  // getBoundingClientRect() 量到的是「过渡起点」（scale 0.19 的矩形）→ 二次打开不居中。
  // 必须先清掉 transition，再改 transform，并强制一次布局后才测量。
  panelEl.style.transition = 'none';
  panelEl.style.transform = 'none';
  panelEl.style.opacity = '0';
  void panelEl.offsetWidth;
  const rect = panelEl.getBoundingClientRect();
  const left = Math.round((window.innerWidth - rect.width) / 2);
  const top = Math.round((window.innerHeight - rect.height) / 2);
  panelEl.style.left = `${left}px`;
  panelEl.style.top = `${top}px`;
  return { left, top };
}

function applyPayload(data) {
  if (!data) return;
  items = Array.isArray(data.items) ? data.items : [];
  total = Number(data.total) || items.length;
  pageSize = Number(data.pageSize) || 9;
  error = data.error || null;
  errorMessage = data.errorMessage || null;
  truncated = Boolean(data.truncated);
  folderNameRef = data.displayName || data.folderName || '文件夹';
  dropFolderEl.textContent = folderNameRef;
  page = 0;
}

function applyLook(dim, blur) {
  const dimValue = Math.min(Math.max(Number(dim) || 0.42, 0.15), 0.7);
  const blurValue = Math.min(Math.max(Number(blur) || 26, 8), 48);
  bgEl.style.filter = `blur(${blurValue}px) saturate(1.2)`;
  dimEl.style.background = `radial-gradient(130% 100% at 50% 36%, rgba(10, 10, 14, ${(dimValue * 0.62).toFixed(3)}), rgba(0, 0, 0, ${(dimValue * 1.38).toFixed(3)})), rgba(0, 0, 0, ${(dimValue * 0.62).toFixed(3)})`;
}

function openOverlay(data) {
  if (isOpen && !isClosing) return;
  cancelTitleEdit();
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  isOpen = true;
  isClosing = false;
  openedAt = data.openedAt || Date.now();
  tileRect = data.tileRect || {
    x: Math.round(window.innerWidth / 2) - 42,
    y: Math.round(window.innerHeight / 2) - 42,
    width: 84,
    height: 84
  };
  applyPayload(data);
  applyLook(data.dim, data.blur);

  if (data.backgroundImage) {
    bgEl.style.backgroundImage = `url("${data.backgroundImage}")`;
    bgEl.classList.add('on');
  } else {
    bgEl.classList.remove('on');
  }

  renderPage();
  const panel = centerPanel();
  const originX = tileRect.x + tileRect.width / 2 - panel.left;
  const originY = tileRect.y + tileRect.height / 2 - panel.top;
  panelEl.style.transformOrigin = `${originX}px ${originY}px`;

  panelEl.classList.remove('items-in');
  panelEl.style.transition = 'none';
  panelEl.style.transform = `scale(${GROW_SCALE})`;
  panelEl.style.opacity = '0';
  dimEl.style.transition = 'none';
  dimEl.style.opacity = '0';
  void panelEl.offsetWidth;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      panelEl.style.transition = `transform ${OPEN_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity 240ms cubic-bezier(0.22, 1, 0.36, 1)`;
      panelEl.style.transform = 'scale(1)';
      panelEl.style.opacity = '1';
      dimEl.style.transition = 'opacity 280ms ease-out';
      dimEl.style.opacity = '1';
      panelEl.classList.add('items-in');
      window.phoneFolder.log(`overlay first frame +${Date.now() - openedAt}ms / ${items.length} items`);
      if (data.perf) measurePerf('open');
    });
  });
}

function onRefresh(data) {
  if (!isOpen || isClosing) return;
  applyPayload(data);
  renderPage();
}

function closeOverlay() {
  if (!isOpen || isClosing) return;
  cancelTitleEdit();
  isClosing = true;
  panelEl.classList.remove('items-in');
  panelEl.style.transition = `transform ${CLOSE_MS}ms cubic-bezier(0.4, 0, 1, 1), opacity 200ms ease-in`;
  panelEl.style.transform = `scale(${GROW_SCALE})`;
  panelEl.style.opacity = '0';
  dimEl.style.transition = 'opacity 240ms ease-in';
  dimEl.style.opacity = '0';

  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    isOpen = false;
    isClosing = false;
    bgEl.classList.remove('on');
    window.phoneFolder.notifyOverlayHidden();
  }, CLOSE_MS - 10);
}

window.phoneFolder.onOverlayOpen(openOverlay);
window.phoneFolder.onOverlayRefresh(onRefresh);
window.phoneFolder.onOverlayClose(closeOverlay);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeOverlay();
  if (event.key === 'ArrowLeft') changePage(-1);
  if (event.key === 'ArrowRight') changePage(1);
});

window.addEventListener('wheel', (event) => {
  if (!isOpen) return;
  if (Math.abs(event.deltaY) < 8 && Math.abs(event.deltaX) < 8) return;
  event.preventDefault();
  changePage(event.deltaY > 0 || event.deltaX > 0 ? 1 : -1);
}, { passive: false });

let swipeStartX = null;
window.addEventListener('pointerdown', (event) => {
  if (!isOpen || event.button !== 0) return;
  swipeStartX = event.clientX;
});
window.addEventListener('pointerup', (event) => {
  if (!isOpen || swipeStartX === null) return;
  const dx = event.clientX - swipeStartX;
  if (Math.abs(dx) > 42) changePage(dx < 0 ? 1 : -1);
  swipeStartX = null;
});

document.addEventListener('mousedown', (event) => {
  if (!panelEl.contains(event.target)) closeOverlay();
});

/* ---------------------------- 拖入移入 ---------------------------- */
let toastTimer = null;

function showToastText(text) {
  if (!text) return;
  toastEl.textContent = text;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastTimer = null;
    toastEl.classList.remove('show');
  }, 2200);
}

function showToast(summary) {
  if (!summary) return;
  const moved = Number(summary.moved) || 0;
  const skipped = Number(summary.skipped) || 0;
  const failed = Number(summary.failed) || 0;
  let text;
  if (failed > 0) text = `${moved} 项已移入，${failed} 项失败`;
  else if (skipped > 0) text = `${moved} 项已移入（${skipped} 项已在文件夹内）`;
  else text = `已移入 ${moved} 项`;
  if (summary.error) text = `移入失败：${summary.error}`;
  showToastText(text);
}

function hasFiles(event) {
  return Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types || []).includes('Files');
}

let dragDepth = 0;

document.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  document.body.classList.add('drop-active');
});

document.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
});

document.addEventListener('dragleave', (event) => {
  if (!hasFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('drop-active');
});

document.addEventListener('drop', async (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('drop-active');

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
  showToast(summary);
});







