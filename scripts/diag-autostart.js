'use strict';

// 诊断：Windows 下 setLoginItemSettings 在开发模式是否真的写注册表
const { app } = require('electron');
const { execFileSync } = require('child_process');

function regRun() {
  try {
    return execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'], { encoding: 'utf8', windowsHide: true });
  } catch (err) {
    return 'reg query failed: ' + err.message;
  }
}

app.whenReady().then(() => {
  const info = {
    name: app.getName(),
    exe: app.getPath('exe'),
    appPath: app.getAppPath(),
    packaged: app.isPackaged
  };
  console.log(JSON.stringify(info));
  app.setLoginItemSettings({ openAtLogin: true, path: app.getPath('exe'), args: [app.getAppPath()], name: 'PhoneFolder' });
  const readBack = app.getLoginItemSettings();
  console.log('readBack:', JSON.stringify(readBack));
  console.log('registry after enable:');
  console.log(regRun());
  app.setLoginItemSettings({ openAtLogin: false, path: app.getPath('exe'), args: [app.getAppPath()], name: 'PhoneFolder' });
  console.log('registry after disable:');
  console.log(regRun());
  app.exit(0);
});

