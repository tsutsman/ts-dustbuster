#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

function pushIfExists(list, dir) {
  if (fs.existsSync(dir)) {
    list.push(dir);
  }
}

async function removeDirContents(dir) {
  try {
    const entries = await fs.promises.readdir(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      await fs.promises.rm(fullPath, { recursive: true, force: true });
    }
    console.log(`Очистив: ${dir}`);
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
  } else {
    pushIfExists(targets, '/var/tmp');
    pushIfExists(targets, '/var/cache/apt/archives');
    pushIfExists(targets, '/var/cache/apt/archives/partial');
    pushIfExists(targets, path.join(os.homedir(), '.cache'));
  }
  for (const dir of targets) {
    await removeDirContents(dir);
  }
}

clean().catch(err => {
  console.error('Помилка виконання скрипту:', err);
});
