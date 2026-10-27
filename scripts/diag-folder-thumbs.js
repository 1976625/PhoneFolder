'use strict';

// 诊断：文件夹缩略图/图标的像素背景（是否为黑色不透明）
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const STORAGE = 'D:\\手机文件夹';
const OUT = path.join(__dirname, 'folder-thumbs');

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const items = fs.readdirSync(STORAGE).slice(0, 20);
  const report = [];
  for (const name of items) {
    const full = path.join(STORAGE, name);
    const stat = fs.statSync(full);
    let record = { name, isDir: stat.isDirectory(), thumbnail: null, icon: null };
    if (stat.isDirectory()) {
      try {
        const thumb = await nativeImage.createThumbnailFromPath(full, { width: 128, height: 128 });
        if (thumb && !thumb.isEmpty()) {
          const png = thumb.toPNG();
          const file = path.join(OUT, `${name}-thumb.png`);
          fs.writeFileSync(file, png);
          const size = thumb.getSize();
          const bmp = thumb.toBitmap();
          // BGRA: 取四个角像素
          const corners = [[0, 0], [size.width - 1, 0], [0, size.height - 1], [size.width - 1, size.height - 1]].map(([x, y]) => {
            const idx = (y * size.width + x) * 4;
            return [bmp[idx + 2], bmp[idx + 1], bmp[idx], bmp[idx + 3]];
          });
          record.thumbnail = { file, size, pngBytes: png.length, corners };
        }
      } catch (err) {
        record.thumbnail = { error: err.message };
      }
    }
    try {
      const icon = await app.getFileIcon(full, { size: 'large' });
      if (icon && !icon.isEmpty()) {
        const png = icon.toPNG();
        const file = path.join(OUT, `${name}-icon.png`);
        fs.writeFileSync(file, png);
        const size = icon.getSize();
        const bmp = icon.toBitmap();
        const corners = [[0, 0], [size.width - 1, 0], [0, size.height - 1], [size.width - 1, size.height - 1]].map(([x, y]) => {
          const idx = (y * size.width + x) * 4;
          return [bmp[idx + 2], bmp[idx + 1], bmp[idx], bmp[idx + 3]];
        });
        record.icon = { file, size, pngBytes: png.length, corners };
      }
    } catch (err) {
      record.icon = { error: err.message };
    }
    report.push(record);
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(0);
});
