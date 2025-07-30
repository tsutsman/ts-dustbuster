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
  if (process.platform === 'win32' && process.env.WINDIR) {
    targets.push(path.join(process.env.WINDIR, 'Temp'));
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
