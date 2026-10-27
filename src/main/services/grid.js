'use strict';

// 瓦片网格：固定 128px 瓦片 + 桌面图标风格的网格吸附
const TILE_SIZE = 128;
const LABEL_HEIGHT = 20;
const GRID_GAP = 8; // 瓦片之间的间隔（用户要求缩小一半）
const GRID_PAD = 8;
const CELL_W = TILE_SIZE + GRID_GAP; // 136
const CELL_H = TILE_SIZE + LABEL_HEIGHT + GRID_GAP; // 156

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// workArea: { x, y, width, height }（任务是主屏工作区，自动避开任务栏）
function gridMetrics(workArea = {}) {
  const x = num(workArea.x, 0);
  const y = num(workArea.y, 0);
  const width = Math.max(0, num(workArea.width, 0));
  const height = Math.max(0, num(workArea.height, 0));
  const usableW = width - GRID_PAD * 2 - TILE_SIZE;
  const usableH = height - GRID_PAD * 2 - (TILE_SIZE + LABEL_HEIGHT);
  const cols = Math.max(1, Math.floor(usableW / CELL_W) + 1);
  const rows = Math.max(1, Math.floor(usableH / CELL_H) + 1);
  // 横向从右往左排（瓦片习惯放右侧，缩间隔时右边缘不动，只会向左多出列）；
  // 纵向从顶部往下排（和桌面图标一致）。
  const originX = x + GRID_PAD + (usableW - (cols - 1) * CELL_W);
  const originY = y + GRID_PAD;
  return {
    originX,
    originY,
    cellW: CELL_W,
    cellH: CELL_H,
    cols,
    rows
  };
}

function cellKey(col, row) {
  return `${col}:${row}`;
}

function cellPosition(col, row, metrics) {
  return {
    col,
    row,
    x: metrics.originX + col * metrics.cellW,
    y: metrics.originY + row * metrics.cellH
  };
}

function nearestCell(x, y, metrics) {
  const col = Math.min(Math.max(Math.round((num(x, 0) - metrics.originX) / metrics.cellW), 0), metrics.cols - 1);
  const row = Math.min(Math.max(Math.round((num(y, 0) - metrics.originY) / metrics.cellH), 0), metrics.rows - 1);
  return cellPosition(col, row, metrics);
}

function cellOfPosition(x, y, metrics) {
  const cell = nearestCell(x, y, metrics);
  return { col: cell.col, row: cell.row, key: cellKey(cell.col, cell.row) };
}

// 吸附到最近的空格；occupied 是 Set<'col:row'>
function snapPosition(x, y, metrics, occupied = new Set()) {
  const base = nearestCell(x, y, metrics);
  if (!occupied.has(cellKey(base.col, base.row))) return base;
  let best = null;
  for (let row = 0; row < metrics.rows; row += 1) {
    for (let col = 0; col < metrics.cols; col += 1) {
      if (occupied.has(cellKey(col, row))) continue;
      const pos = cellPosition(col, row, metrics);
      const dx = pos.x - num(x, 0);
      const dy = pos.y - num(y, 0);
      const dist = dx * dx + dy * dy;
      if (!best || dist < best.dist) best = { ...pos, dist };
    }
  }
  if (!best) return base;
  return { col: best.col, row: best.row, x: best.x, y: best.y };
}

// 给一组已经吸附好的位置生成占用集合
function occupiedFromPositions(positions, metrics) {
  const occupied = new Set();
  for (const pos of positions) {
    if (!pos) continue;
    occupied.add(cellOfPosition(pos.x, pos.y, metrics).key);
  }
  return occupied;
}

module.exports = {
  TILE_SIZE,
  LABEL_HEIGHT,
  GRID_GAP,
  GRID_PAD,
  CELL_W,
  CELL_H,
  gridMetrics,
  cellKey,
  cellPosition,
  nearestCell,
  cellOfPosition,
  snapPosition,
  occupiedFromPositions
};



