'use strict';

// 轻量日志：控制台 + userData/logs/app.log
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logFile = null;

function init() {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, 'app.log');
  } catch {
    logFile = null;
  }
}

function fmt(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(fmt).join(' ')}`;
  // eslint-disable-next-line no-console
  console.log(line);
  if (logFile) {
    try { fs.appendFileSync(logFile, line + '\n'); } catch { /* ignore */ }
  }
}

module.exports = { init, log };
