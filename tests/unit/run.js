'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const { sortItems, isIgnoredName, applyCustomOrder } = require('../../src/main/services/folder');
const { findAvailableName, moveIntoFolder } = require('../../src/main/services/fsops');
const { sanitizeSettings, migrateConfig, cleanTileName, MAX_TILES } = require('../../src/main/services/settings');
const grid = require('../../src/main/services/grid');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('isIgnoredName 过滤隐藏/垃圾文件', () => {
  assert.strictEqual(isIgnoredName('.git'), true);
  assert.strictEqual(isIgnoredName('desktop.ini'), true);
  assert.strictEqual(isIgnoredName('Thumbs.db'), true);
  assert.strictEqual(isIgnoredName('$RECYCLE.BIN'), true);
  assert.strictEqual(isIgnoredName('System Volume Information'), true);
  assert.strictEqual(isIgnoredName('~$问题清单.docx'), true);
  assert.strictEqual(isIgnoredName('项目demo'), false);
  assert.strictEqual(isIgnoredName('phoneS'), false);
  assert.strictEqual(isIgnoredName(''), true);
});

test('sortItems 文件夹优先 + 中文自然排序', () => {
  const items = [
    { name: 'b.txt', isDir: false },
    { name: 'a.txt', isDir: false },
    { name: '项目10', isDir: true },
    { name: '项目2', isDir: true },
    { name: 'B.png', isDir: false }
  ];
  const sorted = [...items].sort(sortItems).map((item) => item.name);
  assert.deepStrictEqual(sorted, ['项目2', '项目10', 'a.txt', 'B.png', 'b.txt']);
});

test('sortItems 数字自然顺序', () => {
  const items = [
    { name: 'file10.txt', isDir: false },
    { name: 'file2.txt', isDir: false },
    { name: 'file1.txt', isDir: false }
  ];
  const sorted = [...items].sort(sortItems).map((item) => item.name);
  assert.deepStrictEqual(sorted, ['file1.txt', 'file2.txt', 'file10.txt']);
});

test('findAvailableName 同名自动追加 (n)', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pf-name-'));
  try {
    await fsp.writeFile(path.join(dir, 'a.txt'), '1');
    assert.strictEqual(await findAvailableName(dir, 'a.txt'), 'a (1).txt');
    await fsp.writeFile(path.join(dir, 'a (1).txt'), '2');
    assert.strictEqual(await findAvailableName(dir, 'a.txt'), 'a (2).txt');
    await fsp.mkdir(path.join(dir, 'folder'));
    assert.strictEqual(await findAvailableName(dir, 'folder'), 'folder (1)');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('moveIntoFolder 移动/重名/跳过/自嵌套', async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'pf-move-'));
  try {
    const target = path.join(base, 'target');
    const srcDir = path.join(base, 'src');
    await fsp.mkdir(target);
    await fsp.mkdir(srcDir);

    const file = path.join(srcDir, 'x.txt');
    await fsp.writeFile(file, 'hello');

    let summary = await moveIntoFolder([file], target);
    assert.strictEqual(summary.moved, 1);
    assert.ok(fs.existsSync(path.join(target, 'x.txt')));

    await fsp.writeFile(path.join(srcDir, 'x.txt'), 'hello2');
    summary = await moveIntoFolder([path.join(srcDir, 'x.txt')], target);
    assert.strictEqual(summary.moved, 1);
    assert.ok(fs.existsSync(path.join(target, 'x (1).txt')));

    summary = await moveIntoFolder([path.join(target, 'x.txt')], target);
    assert.strictEqual(summary.skipped, 1);

    summary = await moveIntoFolder([target], target);
    assert.strictEqual(summary.failed, 1);

    const inner = path.join(target, 'inner');
    await fsp.mkdir(inner);
    summary = await moveIntoFolder([target], inner);
    assert.strictEqual(summary.failed, 1);
    assert.match(summary.results[0].message, /自身内部/);
  } finally {
    await fsp.rm(base, { recursive: true, force: true });
  }
});

test('sanitizeSettings 去重/夹取/默认值', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  const exists = (p) => p === 'D:\\deskTop' || p === 'D:\\deskTop\\phoneS';
  const out = sanitizeSettings({
    tiles: [
      { folder: 'D:\\deskTop', x: 9999, y: -50, size: 999 },
      { folder: 'd:\\desktop' },
      { folder: 'D:\\deskTop\\phoneS', size: 40 }
    ],
    overlay: { dim: 5, blur: 1, background: 'nope' },
    app: { launchAtLogin: 1 }
  }, { displayBounds: bounds, pathExists: exists });

  assert.strictEqual(out.tiles.length, 2);
  assert.strictEqual(out.tiles[0].folder, 'D:\\deskTop');
  assert.strictEqual(out.tiles[0].size, 128);
  assert.ok(out.tiles[0].x <= 1920 - 128);
  assert.ok(out.tiles[0].y >= 0);
  assert.strictEqual(out.tiles[1].size, 128);
  assert.strictEqual(out.overlay.dim, 0.7);
  assert.strictEqual(out.overlay.blur, 8);
  assert.strictEqual(out.overlay.background, 'wallpaper');
  assert.strictEqual(out.app.launchAtLogin, true);
  assert.strictEqual(out.app.tileMode, 'window');
});

test('sanitizeSettings 接受桌面级瓦片模式，非法值回落 window', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  const exists = (p) => p === 'D:\\deskTop';
  const desktop = sanitizeSettings({
    tiles: [{ folder: 'D:\\deskTop' }],
    app: { tileMode: 'desktop' }
  }, { displayBounds: bounds, pathExists: exists });
  assert.strictEqual(desktop.app.tileMode, 'desktop');
  const unknown = sanitizeSettings({
    tiles: [{ folder: 'D:\\deskTop' }],
    app: { tileMode: 'whatever' }
  }, { displayBounds: bounds, pathExists: exists });
  assert.strictEqual(unknown.app.tileMode, 'window');
});

test('sanitizeSettings 校验文件夹绝对路径/存在/至少一个', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.throws(
    () => sanitizeSettings({ tiles: [{ folder: 'D:\\nope' }] }, { displayBounds: bounds, pathExists: () => false }),
    /文件夹不存在/
  );
  assert.throws(
    () => sanitizeSettings({ tiles: [] }, { displayBounds: bounds, pathExists: () => true }),
    /至少保留一个瓦片/
  );
  assert.throws(
    () => sanitizeSettings({ tiles: [{ folder: 'relative-folder' }] }, { displayBounds: bounds, pathExists: () => true }),
    /绝对路径/
  );
});

test('sanitizeSettings 按 MAX_TILES 截断瓦片', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  const tiles = Array.from({ length: MAX_TILES + 3 }, (_, index) => ({ folder: `D:\\tile-${index + 1}` }));
  const out = sanitizeSettings({ tiles, overlay: {}, app: {} }, { displayBounds: bounds, pathExists: () => true });
  assert.strictEqual(out.tiles.length, MAX_TILES);
});

test('cleanTileName 去空白/换行并按 24 字截断', () => {
  assert.strictEqual(cleanTileName('  工作   收纳  '), '工作 收纳');
  assert.strictEqual(cleanTileName('a\nb\tc'), 'a b c');
  assert.strictEqual(cleanTileName(''), '');
  assert.strictEqual(cleanTileName(null), '');
  assert.strictEqual(cleanTileName('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十').length, 24);
});

test('sanitizeSettings 保留自定义瓦片名', () => {
  const out = sanitizeSettings({
    tiles: [{ folder: 'D:\\wf', name: ' 我的 收纳 ', x: 10, y: 20, size: 84 }],
    overlay: { dim: 0.4, blur: 20, background: 'wallpaper' },
    app: { launchAtLogin: false }
  }, { displayBounds: { x: 0, y: 0, width: 1920, height: 1080 }, pathExists: () => true });
  assert.strictEqual(out.tiles[0].name, '我的 收纳');
});

test('gridMetrics 按 workArea 算出网格（间隔 8，横向右对齐）', () => {
  const metrics = grid.gridMetrics({ x: 48, y: 0, width: 1872, height: 1080 });
  assert.strictEqual(metrics.originY, 8);
  assert.strictEqual(metrics.cellW, 130);
  assert.strictEqual(metrics.cellH, 148);
  assert.strictEqual(metrics.cols, 14);
  assert.strictEqual(metrics.rows, 7);
  // 最右列 = workArea 右边 - 8 - 128
  assert.strictEqual(metrics.originX + (metrics.cols - 1) * metrics.cellW, 1784);
});

test('nearestCell 把任意坐标吸附到最近网格', () => {
  const metrics = grid.gridMetrics({ x: 48, y: 0, width: 1872, height: 1080 });
  const cell = grid.nearestCell(1792, 18, metrics);
  assert.deepStrictEqual(cell, { col: 13, row: 0, x: 1784, y: 8 });
  const clamped = grid.nearestCell(-100, -100, metrics);
  assert.deepStrictEqual(clamped, { col: 0, row: 0, x: 94, y: 8 });
});

test('snapPosition 在格子被占用时找最近的空格', () => {
  const metrics = grid.gridMetrics({ x: 48, y: 0, width: 1872, height: 1080 });
  const occupied = new Set(['13:0']);
  const snapped = grid.snapPosition(1792, 18, metrics, occupied);
  assert.deepStrictEqual(snapped, { col: 13, row: 1, x: 1784, y: 156 });
});

test('applyCustomOrder 按自定义顺序排列，未知项保持默认顺序追加', () => {
  const items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  assert.deepStrictEqual(applyCustomOrder(items, ['c', 'a']).map((item) => item.name), ['c', 'a', 'b']);
  assert.deepStrictEqual(applyCustomOrder(items, []).map((item) => item.name), ['a', 'b', 'c']);
  assert.deepStrictEqual(applyCustomOrder(items, ['b']).map((item) => item.name), ['b', 'a', 'c']);
});

test('sanitizeSettings 保留「显示桌面保持可见」开关', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  const enabled = sanitizeSettings({
    tiles: [{ folder: 'D:\\wf', x: 10, y: 20, size: 84 }],
    overlay: { dim: 0.4, blur: 20, background: 'wallpaper' },
    app: { launchAtLogin: false }
  }, { displayBounds: bounds, pathExists: () => true });
  assert.strictEqual(enabled.app.keepVisibleOnShowDesktop, true);
  const disabled = sanitizeSettings({
    tiles: [{ folder: 'D:\\wf', x: 10, y: 20, size: 84 }],
    overlay: { dim: 0.4, blur: 20, background: 'wallpaper' },
    app: { launchAtLogin: false, keepVisibleOnShowDesktop: false }
  }, { displayBounds: bounds, pathExists: () => true });
  assert.strictEqual(disabled.app.keepVisibleOnShowDesktop, false);
});

test('sanitizeSettings 保留自定义排序 order', () => {
  const out = sanitizeSettings({
    tiles: [{ folder: 'D:\\wf', order: ['b', 'a', 'b', '', 3], x: 10, y: 20, size: 84 }],
    overlay: { dim: 0.4, blur: 20, background: 'wallpaper' },
    app: { launchAtLogin: false }
  }, { displayBounds: { x: 0, y: 0, width: 1920, height: 1080 }, pathExists: () => true });
  assert.deepStrictEqual(out.tiles[0].order, ['b', 'a']);
});

test('migrateConfig v2 的「绑定桌面」迁移到独立收纳目录', () => {
  const raw = {
    version: 2,
    tiles: [
      { folder: 'D:\\deskTop', x: 10, y: 20, size: 84 },
      { folder: 'D:\\Custom\\Folder', x: 40, y: 50, size: 96 }
    ],
    overlay: {},
    app: {}
  };
  const result = migrateConfig(raw, {
    desktopPath: 'D:\\deskTop',
    replacementFolder: 'D:\\手机文件夹'
  });
  assert.strictEqual(result.changed, true);
  assert.strictEqual(result.config.version, 5);
  assert.deepStrictEqual(result.relocated, ['D:\\deskTop']);
  assert.strictEqual(result.config.tiles[0].folder, 'D:\\手机文件夹');
  assert.strictEqual(result.config.tiles[0].x, 10);
  assert.strictEqual(result.config.tiles[1].folder, 'D:\\Custom\\Folder');
});

test('migrateConfig v3 的隐藏桌面收纳文件夹迁移到独立目录', () => {
  const raw = {
    version: 3,
    tiles: [
      { folder: 'D:\\deskTop\\文件夹', x: 1, y: 2, size: 84 },
      { folder: 'D:\\deskTop\\项目demo', x: 3, y: 4, size: 84 }
    ]
  };
  const result = migrateConfig(raw, {
    desktopPath: 'D:\\deskTop',
    replacementFolder: 'D:\\手机文件夹',
    shouldRelocate: (folder) => folder === 'D:\\deskTop\\文件夹'
  });
  assert.strictEqual(result.changed, true);
  assert.deepStrictEqual(result.relocated, ['D:\\deskTop\\文件夹']);
  assert.strictEqual(result.config.tiles[0].folder, 'D:\\手机文件夹');
  assert.strictEqual(result.config.tiles[1].folder, 'D:\\deskTop\\项目demo');
});

test('migrateConfig v4→v5 只做尺寸归一', () => {
  const raw = {
    version: 4,
    tiles: [
      { folder: 'D:\\瓦片盒子\\手机文件夹', x: 1792, y: 18, size: 96 },
      { folder: 'D:\\瓦片盒子\\手机文件夹2', x: 1600, y: 220, size: 84 }
    ]
  };
  const result = migrateConfig(raw, { desktopPath: 'D:\\deskTop', replacementFolder: 'D:\\手机文件夹' });
  assert.strictEqual(result.changed, true);
  assert.deepStrictEqual(result.relocated, []);
  assert.strictEqual(result.config.version, 5);
  assert.strictEqual(result.config.tiles[0].size, 128);
  assert.strictEqual(result.config.tiles[1].size, 128);
  assert.strictEqual(result.config.tiles[0].folder, 'D:\\瓦片盒子\\手机文件夹');
  assert.strictEqual(result.config.tiles[0].x, 1792);
});

test('migrateConfig 已是 v5 时不做改动', () => {
  const raw = { version: 5, tiles: [{ folder: 'D:\\手机文件夹', size: 128 }] };
  const result = migrateConfig(raw, { desktopPath: 'D:\\deskTop', replacementFolder: 'X' });
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.config, raw);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
})();












