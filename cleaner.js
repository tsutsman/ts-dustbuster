#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

// мінімально сумісна версія Node.js
const MIN_NODE_MAJOR = 16;

// змінні керування
let dryRun = false;
let parallel = false;
let logFile = null;
const extraDirs = [];

function log(msg) {
  console.log(msg);
  if (logFile) {
    fs.appendFileSync(logFile, msg + '\n');
  }
}

function pushIfExists(list, dir) {
  if (fs.existsSync(dir)) {
    list.push(dir);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--parallel') {
      parallel = true;
    } else if (a === '--log' && args[i + 1]) {
      logFile = args[++i];
    } else if (a === '--dir' && args[i + 1]) {
      extraDirs.push(args[++i]);
    } else if (a === '--config' && args[i + 1]) {
      const cfgPath = args[++i];
      try {
        const data = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        if (Array.isArray(data.dirs)) {
          extraDirs.push(...data.dirs);
        }
      } catch (err) {
        console.error(`Не вдалося прочитати конфіг ${cfgPath}:`, err.message);
      }
    }
  }
}

async function removeDirContents(dir) {
  try {
    const entries = await fs.promises.readdir(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      if (dryRun) {
        log(`[dry-run] Видалив би: ${fullPath}`);
      } else {
        await fs.promises.rm(fullPath, { recursive: true, force: true });
      }
    }
    log(dryRun ? `[dry-run] Завершив ${dir}` : `Очистив: ${dir}`);
  } catch (err) {
    console.error(`Не вдалося очистити ${dir}:`, err.message);
  }
}

async function clean() {
  const targets = [];
  pushIfExists(targets, os.tmpdir());
  if (process.platform === 'win32') {
    const winDir = process.env.WINDIR || 'C:/Windows';
    pushIfExists(targets, path.join(winDir, 'Temp'));
    pushIfExists(targets, path.join(winDir, 'Prefetch'));
    pushIfExists(targets, path.join(winDir, 'SoftwareDistribution', 'Download'));
    pushIfExists(targets, path.join(winDir, 'System32', 'LogFiles'));
    if (process.env.SystemDrive) {
      pushIfExists(targets, path.join(process.env.SystemDrive, 'Temp'));
    }
    const recycle = path.join(process.env.SystemDrive || 'C:', '$Recycle.Bin');
    pushIfExists(targets, recycle);
    if (process.env.LOCALAPPDATA) {
      pushIfExists(targets, path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'INetCache'));
      pushIfExists(targets, path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'));
    }
  } else {
    pushIfExists(targets, '/var/tmp');
    pushIfExists(targets, '/var/cache/apt/archives');
    pushIfExists(targets, '/var/cache/apt/archives/partial');
    pushIfExists(targets, path.join(os.homedir(), '.cache'));
  }
  extraDirs.forEach(d => pushIfExists(targets, d));

  const tasks = targets.map(dir => removeDirContents(dir));
  if (parallel) {
    await Promise.all(tasks);
  } else {
    for (const t of tasks) {
      await t;
    }
  }
}

parseArgs();

if (parseInt(process.versions.node.split('.')[0], 10) < MIN_NODE_MAJOR) {
  console.error(`Потрібна Node.js >= ${MIN_NODE_MAJOR}. Поточна ${process.versions.node}`);
  process.exit(1);
}

if (require.main === module) {
  clean().catch(err => {
    console.error('Помилка виконання скрипту:', err);
  });
}

module.exports = { pushIfExists, removeDirContents };
