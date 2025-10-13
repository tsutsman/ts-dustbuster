const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { state } = require('./state');
const { log } = require('./logging');
const { normalizePath, isWithin } = require('./utils/path');

const MIN_NODE_MAJOR = 16;

function currentPlatform() {
  return state.platformOverride || process.platform;
}

function currentNodeMajor() {
  if (typeof state.nodeVersionOverride === 'number') {
    return state.nodeVersionOverride;
  }
  return parseInt(process.versions.node.split('.')[0], 10);
}

function setExecSyncHandler(handler) {
  state.execSyncHandler = typeof handler === 'function' ? handler : state.execSyncFallback;
}

function setPlatformOverride(platform) {
  state.platformOverride = typeof platform === 'string' ? platform : null;
}

function setNodeVersionOverride(major) {
  if (typeof major === 'number' && Number.isFinite(major)) {
    state.nodeVersionOverride = major;
  } else {
    state.nodeVersionOverride = null;
  }
}

function setMainOverride(value) {
  state.mainOverride = typeof value === 'boolean' ? value : null;
}

function setParsedOkOverride(value) {
  state.parsedOkOverride = typeof value === 'boolean' ? value : null;
}

function setPreviewPromptHandler(handler) {
  state.previewPromptHandler = typeof handler === 'function' ? handler : null;
}

function closePreviewInterface() {
  if (state.previewInterface) {
    state.previewInterface.close();
    state.previewInterface = null;
  }
}

async function askForPreviewConfirmation(message) {
  if (state.previewPromptHandler) {
    return Boolean(await state.previewPromptHandler(message));
  }

  if (!process.stdin.isTTY) {
    console.error(
      'Режим попереднього перегляду недоступний у неінтерактивному середовищі. Каталог буде пропущено.'
    );
    return false;
  }

  if (!state.previewInterface) {
    state.previewInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  return new Promise((resolve) => {
    state.previewInterface.question(message, (answer) => {
      const normalized = answer.trim().toLowerCase();
      const positive =
        normalized === 'y' ||
        normalized === 'yes' ||
        normalized === 'т' ||
        normalized === 'так' ||
        normalized === '1';
      resolve(positive);
    });
  });
}

async function inspectPath(fullPath, stat) {
  let info = { files: 0, dirs: 0, bytes: 0 };
  const currentStat = stat || (await fs.promises.lstat(fullPath));
  if (currentStat.isDirectory() && !currentStat.isSymbolicLink()) {
    info.dirs += 1;
    try {
      const entries = await fs.promises.readdir(fullPath);
      for (const entry of entries) {
        const child = path.join(fullPath, entry);
        try {
          const childStat = await fs.promises.lstat(child);
          const nested = await inspectPath(child, childStat);
          info.files += nested.files;
          info.dirs += nested.dirs;
          info.bytes += nested.bytes;
        } catch (err) {
          console.error(`Не вдалося перевірити ${child}:`, err.message);
        }
      }
    } catch (err) {
      console.error(`Не вдалося прочитати ${fullPath}:`, err.message);
    }
  } else {
    info.files += 1;
    info.bytes += currentStat.size || 0;
  }
  return info;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 Б';
  }
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function createMetrics() {
  return { files: 0, dirs: 0, bytes: 0, skipped: 0, errors: 0 };
}

function mergeMetrics(target, addition) {
  target.files += addition.files;
  target.dirs += addition.dirs;
  target.bytes += addition.bytes;
  target.skipped += addition.skipped;
  target.errors += addition.errors;
  return target;
}

function isExcluded(target) {
  if (!state.exclusions.length) {
    return false;
  }
  const resolved = normalizePath(target);
  return state.exclusions.some((ex) => isWithin(ex, resolved));
}

async function filterTargetsByPreview(targets) {
  const confirmed = [];

  try {
    for (const dir of targets) {
      let stat;
      try {
        stat = await fs.promises.lstat(dir);
      } catch (err) {
        console.error(`Не вдалося отримати інформацію про ${dir}:`, err.message);
        continue;
      }

      let info;
      try {
        info = await inspectPath(dir, stat);
      } catch (err) {
        console.error(`Не вдалося зібрати дані для попереднього перегляду ${dir}:`, err.message);
        continue;
      }

      log(`[preview] ${dir}`);
      log(
        `[preview] Файлів: ${info.files}, тек: ${info.dirs}, оцінений розмір: ${formatBytes(info.bytes)}`
      );
      if (state.dryRun) {
        log('[preview] Активний режим dry-run: підтвердження не призведе до видалення.');
      }

      const confirm = await askForPreviewConfirmation('Очистити цей каталог? [y/N]: ');
      if (confirm) {
        confirmed.push(dir);
      } else {
        log(`[preview] Пропущено ${dir}`);
      }
    }
  } finally {
    closePreviewInterface();
  }

  return confirmed;
}

function pushIfExists(list, dir) {
  const resolved = normalizePath(dir);
  if (fs.existsSync(resolved)) {
    list.push(resolved);
  }
}

async function runWithLimit(tasks, limit) {
  const results = [];
  let index = 0;
  const executing = new Set();

  const scheduleNext = () => {
    if (index >= tasks.length) {
      return null;
    }
    const task = tasks[index++]();
    const wrapped = Promise.resolve(task).finally(() => {
      executing.delete(wrapped);
    });
    executing.add(wrapped);
    results.push(wrapped);
    return wrapped;
  };

  while (executing.size < limit && index < tasks.length) {
    scheduleNext();
  }

  while (index < tasks.length) {
    await Promise.race(executing);
    scheduleNext();
  }

  await Promise.all(executing);
  return Promise.all(results);
}

async function removeDirContents(dir, metrics = createMetrics()) {
  try {
    const entries = await fs.promises.readdir(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      if (isExcluded(fullPath)) {
        log(`[skip] У переліку виключень: ${fullPath}`);
        metrics.skipped += 1;
        continue;
      }
      let stat;
      try {
        stat = await fs.promises.lstat(fullPath);
      } catch (err) {
        console.error(`Не вдалося отримати інформацію про ${fullPath}:`, err.message);
        metrics.errors += 1;
        continue;
      }
      if (state.maxAgeMs !== null) {
        const age = Date.now() - stat.mtimeMs;
        if (age < state.maxAgeMs) {
          log(`[skip] Надто свіжий елемент: ${fullPath}`);
          metrics.skipped += 1;
          continue;
        }
      }
      let info;
      try {
        info = await inspectPath(fullPath, stat);
      } catch (err) {
        console.error(`Не вдалося оцінити ${fullPath}:`, err.message);
        metrics.errors += 1;
        continue;
      }
      if (state.dryRun) {
        log(`[dry-run] Видалив би: ${fullPath} (${formatBytes(info.bytes)})`);
      } else {
        try {
          await fs.promises.rm(fullPath, { recursive: true, force: true });
          log(`Видалено: ${fullPath}`);
        } catch (err) {
          console.error(`Не вдалося видалити ${fullPath}:`, err.message);
          metrics.errors += 1;
          continue;
        }
      }
      metrics.files += info.files;
      metrics.dirs += info.dirs;
      metrics.bytes += info.bytes;
    }
    log(state.dryRun ? `[dry-run] Завершив ${dir}` : `Очистив: ${dir}`);
  } catch (err) {
    console.error(`Не вдалося очистити ${dir}:`, err.message);
    metrics.errors += 1;
  }
  return metrics;
}

function concurrencyLimit(taskCount) {
  if (typeof state.concurrency === 'number' && state.concurrency > 0) {
    return Math.min(state.concurrency, taskCount);
  }
  if (state.parallel) {
    return taskCount;
  }
  return 1;
}

async function clean({ targets: targetOverride } = {}) {
  const targets = [];
  if (Array.isArray(targetOverride) && targetOverride.length > 0) {
    targetOverride.forEach((dir) => pushIfExists(targets, dir));
  } else {
    pushIfExists(targets, os.tmpdir());
    if (currentPlatform() === 'win32') {
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
        pushIfExists(
          targets,
          path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'INetCache')
        );
        pushIfExists(
          targets,
          path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Cache')
        );
        pushIfExists(
          targets,
          path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache')
        );
        pushIfExists(targets, path.join(process.env.LOCALAPPDATA, 'CrashDumps'));
      }
      if (process.env.APPDATA) {
        pushIfExists(targets, path.join(process.env.APPDATA, 'npm-cache'));
      }
    } else if (currentPlatform() === 'darwin') {
      pushIfExists(targets, '/var/tmp');
      pushIfExists(targets, path.join(os.homedir(), 'Library', 'Caches'));
      pushIfExists(targets, path.join(os.homedir(), 'Library', 'Logs'));
      pushIfExists(
        targets,
        path.join(
          os.homedir(),
          'Library',
          'Application Support',
          'Google',
          'Chrome',
          'Default',
          'Cache'
        )
      );
      pushIfExists(
        targets,
        path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'Cache')
      );
      pushIfExists(
        targets,
        path.join(
          os.homedir(),
          'Library',
          'Application Support',
          'Microsoft Edge',
          'Default',
          'Cache'
        )
      );
    } else {
      pushIfExists(targets, '/var/tmp');
      pushIfExists(targets, '/var/cache/apt/archives');
      pushIfExists(targets, '/var/cache/apt/archives/partial');
      pushIfExists(targets, path.join(os.homedir(), '.cache'));
      pushIfExists(targets, path.join(os.homedir(), '.npm'));
      pushIfExists(targets, path.join(os.homedir(), '.cache', 'npm'));
      pushIfExists(targets, path.join(os.homedir(), '.cache', 'yarn'));
      pushIfExists(targets, path.join(os.homedir(), '.cache', 'pip'));
      pushIfExists(targets, path.join(os.homedir(), '.cache', 'google-chrome'));
      pushIfExists(targets, path.join(os.homedir(), '.cache', 'chromium'));
      pushIfExists(targets, path.join(os.homedir(), '.cache', 'Code', 'Cache'));
    }
    state.extraDirs.forEach((d) => pushIfExists(targets, d));
  }

  let filteredTargets = targets.filter((dir) => {
    if (isExcluded(dir)) {
      log(`[skip] Каталог пропущено за виключенням: ${dir}`);
      return false;
    }
    return true;
  });

  if (state.interactivePreview && filteredTargets.length > 0) {
    const confirmed = await filterTargetsByPreview(filteredTargets);
    filteredTargets = confirmed;
    if (filteredTargets.length === 0) {
      log('Режим попереднього перегляду: жодного каталогу не підтверджено до очищення.');
    }
  }

  if (filteredTargets.length === 0) {
    const total = createMetrics();
    if (state.summary) {
      logSummary(total);
    }
    return total;
  }

  const allMetrics = [];
  const taskFactories = filteredTargets.map((dir) => () => removeDirContents(dir, createMetrics()));
  const limit = concurrencyLimit(taskFactories.length);

  if (limit <= 1) {
    for (const task of taskFactories) {
      allMetrics.push(await task());
    }
  } else {
    const results = await runWithLimit(taskFactories, limit);
    allMetrics.push(...results);
  }

  const total = allMetrics.reduce((acc, item) => mergeMetrics(acc, item), createMetrics());

  if (state.summary) {
    logSummary(total);
  }

  if (state.deepClean && currentPlatform() === 'win32') {
    advancedWindowsClean();
  }

  return total;
}

function logSummary(total) {
  log(
    `Підсумок: файлів ${total.files}, тек ${total.dirs}, пропущено ${total.skipped}, помилок ${total.errors}, звільнено ${formatBytes(total.bytes)}.`
  );
  if (state.dryRun) {
    log('Режим dry-run: показані значення відображають потенційно звільнений простір.');
  }
}

function setCleanOverride(handler) {
  state.cleanOverride = typeof handler === 'function' ? handler : null;
}

function getCleanInvoker() {
  return state.cleanOverride || clean;
}

function isAdmin() {
  try {
    state.execSyncHandler('net session >nul 2>&1');
    return true;
  } catch {
    return false;
  }
}

function advancedWindowsClean() {
  if (!isAdmin()) {
    console.error('Для глибокого очищення потрібні адмінські права');
    return;
  }
  try {
    state.execSyncHandler('PowerShell -NoLogo -NoProfile -Command "Clear-RecycleBin -Force"', {
      stdio: 'inherit'
    });
  } catch {}
  try {
    state.execSyncHandler('dism /online /Cleanup-Image /StartComponentCleanup /ResetBase', {
      stdio: 'inherit'
    });
  } catch {}
  try {
    state.execSyncHandler('RunDll32.exe InetCpl.cpl,ClearMyTracksByProcess 8', {
      stdio: 'inherit'
    });
  } catch {}
  try {
    const logs = state
      .execSyncHandler('wevtutil.exe el', { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/);
    logs.forEach((logName) => {
      if (logName) {
        try {
          state.execSyncHandler(`wevtutil.exe cl "${logName}"`);
        } catch {}
      }
    });
  } catch {}
  try {
    state.execSyncHandler('net stop wuauserv', { stdio: 'inherit' });
    state.execSyncHandler('net stop bits', { stdio: 'inherit' });
    fs.rmSync(path.join(process.env.WINDIR || 'C:/Windows', 'SoftwareDistribution'), {
      recursive: true,
      force: true
    });
    state.execSyncHandler('net start wuauserv', { stdio: 'inherit' });
    state.execSyncHandler('net start bits', { stdio: 'inherit' });
  } catch {}
}

module.exports = {
  MIN_NODE_MAJOR,
  currentPlatform,
  currentNodeMajor,
  setExecSyncHandler,
  setPlatformOverride,
  setNodeVersionOverride,
  setMainOverride,
  setParsedOkOverride,
  setPreviewPromptHandler,
  closePreviewInterface,
  filterTargetsByPreview,
  runWithLimit,
  removeDirContents,
  pushIfExists,
  clean,
  logSummary,
  setCleanOverride,
  getCleanInvoker,
  advancedWindowsClean
};
