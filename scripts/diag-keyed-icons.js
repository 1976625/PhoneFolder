'use strict';

// 验证：文件夹缩略图的黑色背景是否被抠成透明（保存处理后的 PNG 并检查四角 alpha）
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const STORAGE = 'D:\\手机文件夹';
const OUT = path.join(__dirname, 'keyed-thumbs');

app.whenReady().then(async () => {
  const { payloadForItem } = require('../src/main/services/icons');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const items = fs.readdirSync(STORAGE).slice(0, 20);
  const report = [];
  for (const name of items) {
    const full = path.join(STORAGE, name);
    const stat = fs.statSync(full);
    if (!stat.isDirectory()) continue;
    const payload = await payloadForItem({ path: full, isDir: true, mtimeMs: stat.mtimeMs });
    if (!payload || !payload.dataUrl) {
      report.push({ name, payload: null });
      continue;
    }
    const base64 = payload.dataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    const image = nativeImage.createFromBuffer(buffer);
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const idx = (x, y) => (y * size.width + x) * 4;
    const corners = [[0, 0], [size.width - 1, 0], [0, size.height - 1], [size.width - 1, size.height - 1]]
      .map(([x, y]) => bitmap[idx(x, y) + 3]);
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, buffer);
    report.push({ name, kind: payload.kind, size, cornerAlpha: corners, file });
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(0);
});
