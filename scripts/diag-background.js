'use strict';

// 验证背景缓存（wallpaper/capture）预热与耗时
const { app } = require('electron');
const bg = require('../src/main/services/background');

app.whenReady().then(async () => {
  const out = { mode: bg.mode() };
  let t0 = Date.now();
  const wallpaper = await bg.warmWallpaper();
  out.wallpaperFirst = { ms: Date.now() - t0, bytes: wallpaper ? wallpaper.length : 0 };
  t0 = Date.now();
  const wallpaper2 = await bg.warmWallpaper();
  out.wallpaperSecond = { ms: Date.now() - t0, bytes: wallpaper2 ? wallpaper2.length : 0 };
  t0 = Date.now();
  const capture = await bg.warmCapture(undefined, { force: true });
  out.captureFirst = { ms: Date.now() - t0, bytes: capture ? capture.length : 0 };
  out.cachedWallpaper = Boolean(bg.getCachedWallpaper());
  require('fs').writeFileSync(require('path').join(__dirname, 'test-bg-result.json'), JSON.stringify(out, null, 2));
  app.exit(0);
});
