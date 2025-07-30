#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

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
  const targets = [os.tmpdir()];
  if (process.platform === 'win32') {
    const winDir = process.env.WINDIR || 'C:/Windows';
    targets.push(path.join(winDir, 'Temp'));
    targets.push(path.join(winDir, 'Prefetch'));
    targets.push(path.join(winDir, 'SoftwareDistribution', 'Download'));
    targets.push(path.join(winDir, 'System32', 'LogFiles'));
    if (process.env.SystemDrive) {
      targets.push(path.join(process.env.SystemDrive, 'Temp'));
    }
  } else {
    targets.push('/var/tmp');
  }
  for (const dir of targets) {
    await removeDirContents(dir);
  }
}

clean().catch(err => {
  console.error('Помилка виконання скрипту:', err);
});
