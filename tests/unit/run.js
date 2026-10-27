'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const { sortItems, isIgnoredName } = require('../../src/main/services/folder');
const { findAvailableName, moveIntoFolder } = require('../../src/main/services/fsops');

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
