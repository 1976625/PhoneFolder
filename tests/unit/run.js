'use strict';

const assert = require('assert');
const { sortItems, isIgnoredName } = require('../../src/main/services/folder');

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

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed === 0 ? 0 : 1);
