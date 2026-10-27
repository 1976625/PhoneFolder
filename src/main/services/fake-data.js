'use strict';

// P1 视觉原型用的假数据；P2 换成真实文件夹扫描
const path = require('path');

const SAMPLE_ITEMS = [
  { name: '项目demo', emoji: '🚀', hue: 262 },
  { name: '简历', emoji: '📄', hue: 208 },
  { name: '个人信息', emoji: '🗂️', hue: 158 },
  { name: '测试文件', emoji: '🧪', hue: 330 },
  { name: '游戏', emoji: '🎮', hue: 275 },
  { name: '工具', emoji: '🛠️', hue: 42 },
  { name: '文档', emoji: '📚', hue: 190 },
  { name: '图片', emoji: '🖼️', hue: 120 },
  { name: '音乐', emoji: '🎵', hue: 15 }
];

function folderNameOf(folder) {
  const base = path.basename(folder || '');
  return base || '文件夹';
}

function makeFakeItems(tile) {
  return {
    folderName: folderNameOf(tile && tile.folder),
    items: SAMPLE_ITEMS.map(item => ({ ...item }))
  };
}

module.exports = { makeFakeItems };
