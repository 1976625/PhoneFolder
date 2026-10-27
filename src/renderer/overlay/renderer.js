'use strict';

const bgEl = document.getElementById('bg');
const dimEl = document.getElementById('dim');
const panelEl = document.getElementById('panel');
const titleEl = document.getElementById('title');
const eyebrowEl = document.getElementById('eyebrow');
const gridEl = document.getElementById('grid');
const dotsEl = document.getElementById('dots');

const PER_PAGE = 9;
const GROW_SCALE = 0.19;
const OPEN_MS = 380;
const CLOSE_MS = 240;

let isOpen = false;
let isClosing = false;
let closeTimer = null;

function iconBackground(hue) {
  const h = Number(hue) || 220;
  return `linear-gradient(145deg, hsl(${h} 78% 62%), hsl(${h + 28} 76% 46%))`;
}

function renderItems(items) {
  gridEl.textContent = '';
  (items || []).forEach((item, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item';
    btn.style.animationDelay = `${index * 18}ms`;

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.style.background = iconBackground(item.hue);
    icon.textContent = item.emoji || '';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name || '';

    btn.append(icon, name);
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      icon.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(0.9)' }, { transform: 'scale(1)' }],
        { duration: 240, easing: 'ease-out' }
      );
    });
    gridEl.appendChild(btn);
  });
}

function renderDots(total) {
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  dotsEl.textContent = '';
  if (pages <= 1) {
    dotsEl.classList.add('is-hidden');
    return;
  }
  dotsEl.classList.remove('is-hidden');
  for (let i = 0; i < pages; i += 1) {
    const dot = document.createElement('span');
    dot.className = i === 0 ? 'dot active' : 'dot';
    dotsEl.appendChild(dot);
  }
}

function centerPanel() {
  // 上一次关闭后 panel 还留着 scale 变换，先清掉再量尺寸，否则量到的是缩小后的矩形
  panelEl.style.transform = 'none';
  panelEl.style.opacity = '0';
  const rect = panelEl.getBoundingClientRect();
  const left = Math.round((window.innerWidth - rect.width) / 2);
  const top = Math.round((window.innerHeight - rect.height) / 2);
  panelEl.style.left = `${left}px`;
  panelEl.style.top = `${top}px`;
  window.phoneFolder.log(
    `centerPanel inner=${window.innerWidth}x${window.innerHeight} rect=${Math.round(rect.width)}x${Math.round(rect.height)} left=${left} top=${top}`
  );
  return { left, top };
}

function openOverlay(data) {
  if (isOpen && !isClosing) return;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  isOpen = true;
  isClosing = false;

  const items = data.items || [];
  titleEl.textContent = data.folderName || '文件夹';
  eyebrowEl.textContent = `文件夹 · ${items.length} 项`;
  renderItems(items);
  renderDots(items.length);

  if (data.backgroundImage) {
    bgEl.style.backgroundImage = `url("${data.backgroundImage}")`;
    bgEl.classList.add('on');
  } else {
    bgEl.classList.remove('on');
  }

  const tile = data.tileRect || {
    x: Math.round(window.innerWidth / 2) - 42,
    y: Math.round(window.innerHeight / 2) - 42,
    width: 84,
    height: 84
  };
  const panel = centerPanel();
  const originX = tile.x + tile.width / 2 - panel.left;
  const originY = tile.y + tile.height / 2 - panel.top;
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
      if (data.openedAt) {
        window.phoneFolder.log(
          `overlay first frame +${Date.now() - data.openedAt}ms / panel ${panelEl.style.transform} opacity ${panelEl.style.opacity}`
        );
      }
    });
  });
}

function closeOverlay() {
  if (!isOpen || isClosing) return;
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
window.phoneFolder.onOverlayClose(closeOverlay);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeOverlay();
});

document.addEventListener('mousedown', (event) => {
  if (!panelEl.contains(event.target)) closeOverlay();
});
