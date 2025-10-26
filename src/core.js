const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { state } = require('./state');
const { log } = require('./logging');
const { normalizePath, isWithin } = require('./utils/path');
const { t, getTranslationValue } = require('./i18n');

const MIN_NODE_MAJOR = 16;
const PERMISSION_ERROR_CODES = new Set(['EACCES', 'EPERM']);

function createSkipStats() {
  return {
    excluded: 0,
    maxAge: 0,
    preview: 0
  };
}

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

function isPermissionError(err) {
  return Boolean(err && typeof err === 'object' && PERMISSION_ERROR_CODES.has(err.code));
}

function recordPermissionDenied(metrics, targetPath) {
  if (!metrics || !targetPath) {
    return;
  }
  const normalized = normalizePath(targetPath);
  if (!metrics.permissionDenied.includes(normalized)) {
    metrics.permissionDenied.push(normalized);
  }
}

async function askForPreviewConfirmation(message) {
  if (state.previewPromptHandler) {
    return Boolean(await state.previewPromptHandler(message));
  }

  if (!process.stdin.isTTY) {
    console.error(t('core.errors.previewNotInteractive'));
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

async function inspectPath(fullPath, stat, metrics) {
  let info = { files: 0, dirs: 0, bytes: 0 };
  let currentStat = stat;
  if (!currentStat) {
    try {
      currentStat = await fs.promises.lstat(fullPath);
    } catch (err) {
      if (isPermissionError(err)) {
        recordPermissionDenied(metrics, fullPath);
      }
      throw err;
    }
  }
  if (currentStat.isDirectory() && !currentStat.isSymbolicLink()) {
    info.dirs += 1;
    try {
      const entries = await fs.promises.readdir(fullPath);
      for (const entry of entries) {
        const child = path.join(fullPath, entry);
        try {
          const childStat = await fs.promises.lstat(child);
          const nested = await inspectPath(child, childStat, metrics);
          info.files += nested.files;
          info.dirs += nested.dirs;
          info.bytes += nested.bytes;
        } catch (err) {
          if (isPermissionError(err)) {
            recordPermissionDenied(metrics, child);
          }
          console.error(t('core.errors.inspectFailed', { path: child, error: err.message }));
        }
      }
    } catch (err) {
      if (isPermissionError(err)) {
        recordPermissionDenied(metrics, fullPath);
      }
      console.error(t('core.errors.readDirFailed', { path: fullPath, error: err.message }));
    }
  } else {
    info.files += 1;
    info.bytes += currentStat.size || 0;
  }
  return info;
}

function getByteUnits() {
  const raw = getTranslationValue('core.units.bytes');
  if (Array.isArray(raw) && raw.length) {
    return raw;
  }
  return ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
}

function formatBytes(bytes) {
  const units = getByteUnits();
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return `0 ${units[0]}`;
  }
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function registerSkip(metrics, reason) {
  if (!metrics) {
    return;
  }
  metrics.skipped += 1;
  if (!metrics.skippedBy) {
    metrics.skippedBy = createSkipStats();
  }
  metrics.skippedBy[reason] = (metrics.skippedBy[reason] || 0) + 1;
}

function createMetrics() {
  return {
    files: 0,
    dirs: 0,
    bytes: 0,
    skipped: 0,
    errors: 0,
    permissionDenied: [],
    skippedBy: createSkipStats()
  };
}

function mergeMetrics(target, addition) {
  target.files += addition.files;
  target.dirs += addition.dirs;
  target.bytes += addition.bytes;
  target.skipped += addition.skipped;
  target.errors += addition.errors;
  if (Array.isArray(addition.permissionDenied)) {
    for (const entry of addition.permissionDenied) {
      if (!target.permissionDenied.includes(entry)) {
        target.permissionDenied.push(entry);
      }
    }
  }
  if (addition.skippedBy) {
    if (!target.skippedBy) {
      target.skippedBy = createSkipStats();
    }
    for (const [reason, count] of Object.entries(addition.skippedBy)) {
      if (count > 0) {
        target.skippedBy[reason] = (target.skippedBy[reason] || 0) + count;
      }
    }
  }
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
  const skipped = [];

  try {
    for (const dir of targets) {
      let stat;
      try {
        stat = await fs.promises.lstat(dir);
      } catch (err) {
        console.error(t('core.errors.statFailed', { path: dir, error: err.message }));
        continue;
      }

      let info;
      try {
        info = await inspectPath(dir, stat, null);
      } catch (err) {
        console.error(t('core.errors.previewCollectFailed', { path: dir, error: err.message }));
        continue;
      }

      log(t('core.logs.previewEntry', { path: dir }));
      log(
        t('core.preview.metrics', {
          files: info.files,
          dirs: info.dirs,
          size: formatBytes(info.bytes)
        })
      );
      if (state.dryRun) {
        log(t('core.preview.dryRunNotice'));
      }

      const confirm = await askForPreviewConfirmation(t('core.preview.prompt'));
      if (confirm) {
        confirmed.push(dir);
      } else {
        log(t('core.preview.skipped', { path: dir }));
        skipped.push(dir);
      }
    }
  } finally {
    closePreviewInterface();
  }

  const result = confirmed;
  result.skipped = skipped;
  return result;
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
        log(t('core.logs.skipExcluded', { path: fullPath }));
        registerSkip(metrics, 'excluded');
        continue;
      }
      let stat;
      try {
        stat = await fs.promises.lstat(fullPath);
      } catch (err) {
        console.error(t('core.errors.statFailed', { path: fullPath, error: err.message }));
        metrics.errors += 1;
        if (isPermissionError(err)) {
          recordPermissionDenied(metrics, fullPath);
        }
        continue;
      }
      if (state.maxAgeMs !== null) {
        const age = Date.now() - stat.mtimeMs;
        if (age < state.maxAgeMs) {
          log(t('core.logs.skipFresh', { path: fullPath }));
          registerSkip(metrics, 'maxAge');
          continue;
        }
      }
      let info;
      try {
        info = await inspectPath(fullPath, stat, metrics);
      } catch (err) {
        console.error(t('core.errors.evaluateFailed', { path: fullPath, error: err.message }));
        metrics.errors += 1;
        if (isPermissionError(err)) {
          recordPermissionDenied(metrics, fullPath);
        }
        continue;
      }
      if (state.dryRun) {
        log(t('core.logs.dryRunWouldRemove', { path: fullPath, size: formatBytes(info.bytes) }));
      } else {
        try {
          await fs.promises.rm(fullPath, { recursive: true, force: true });
          log(t('core.logs.removed', { path: fullPath }));
        } catch (err) {
          console.error(t('core.errors.removeFailed', { path: fullPath, error: err.message }));
          metrics.errors += 1;
          if (isPermissionError(err)) {
            recordPermissionDenied(metrics, fullPath);
          }
          continue;
        }
      }
      metrics.files += info.files;
      metrics.dirs += info.dirs;
      metrics.bytes += info.bytes;
    }
    log(
      state.dryRun
        ? t('core.logs.dryRunComplete', { path: dir })
        : t('core.logs.cleaned', { path: dir })
    );
  } catch (err) {
    console.error(t('core.errors.cleanFailed', { path: dir, error: err.message }));
    metrics.errors += 1;
    if (isPermissionError(err)) {
      recordPermissionDenied(metrics, dir);
    }
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
  const runStarted = process.hrtime.bigint();
  const targets = [];
  let previewSkippedCount = 0;
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
      log(t('core.logs.skipExcluded', { path: dir }));
      return false;
    }
    return true;
  });

  if (state.interactivePreview && filteredTargets.length > 0) {
    const previewResult = await filterTargetsByPreview(filteredTargets);
    filteredTargets = previewResult;
    previewSkippedCount = 0;
    if (Array.isArray(previewResult.skipped)) {
      previewSkippedCount = previewResult.skipped.length;
    }
    if (filteredTargets.length === 0) {
      log(t('core.preview.noneConfirmed'));
    }
  }

  if (filteredTargets.length === 0) {
    const total = createMetrics();
    const durationMs = Number(process.hrtime.bigint() - runStarted) / 1e6;
    total.durationMs = durationMs;
    total.targetSummaries = [];
    if (previewSkippedCount > 0) {
      total.skipped += previewSkippedCount;
      total.skippedBy.preview += previewSkippedCount;
    }
    if (state.summary) {
      logSummary(total, { durationMs, targets: [] });
    }
    return total;
  }

  const allResults = [];
  const taskFactories = filteredTargets.map((dir) => async () => {
    const started = process.hrtime.bigint();
    const metrics = await removeDirContents(dir, createMetrics());
    const finished = process.hrtime.bigint();
    return {
      dir,
      metrics,
      durationMs: Number(finished - started) / 1e6
    };
  });
  const limit = concurrencyLimit(taskFactories.length);

  if (limit <= 1) {
    for (const task of taskFactories) {
      allResults.push(await task());
    }
  } else {
    const results = await runWithLimit(taskFactories, limit);
    allResults.push(...results);
  }

  const total = allResults.reduce((acc, item) => mergeMetrics(acc, item.metrics), createMetrics());
  const durationMs = Number(process.hrtime.bigint() - runStarted) / 1e6;
  total.durationMs = durationMs;
  total.targetSummaries = allResults.map((item) => ({
    path: item.dir,
    bytes: item.metrics.bytes,
    files: item.metrics.files,
    dirs: item.metrics.dirs,
    skipped: item.metrics.skipped,
    errors: item.metrics.errors,
    durationMs: item.durationMs,
    permissionDenied: [...item.metrics.permissionDenied],
    skippedBy: { ...(item.metrics.skippedBy || {}) }
  }));
  if (previewSkippedCount > 0) {
    total.skipped += previewSkippedCount;
    if (!total.skippedBy) {
      total.skippedBy = createSkipStats();
    }
    total.skippedBy.preview += previewSkippedCount;
  }

  if (state.summary) {
    logSummary(total, { durationMs, targets: total.targetSummaries });
  }

  if (state.deepClean && currentPlatform() === 'win32') {
    advancedWindowsClean();
  }

  return total;
}

function logSummary(total, details = {}) {
  const { durationMs = 0, targets = [] } = details;
  log(
    t('core.summary.main', {
      files: total.files,
      dirs: total.dirs,
      skipped: total.skipped,
      errors: total.errors,
      bytes: formatBytes(total.bytes)
    })
  );
  if (durationMs > 0) {
    log(t('core.summary.duration', { duration: formatDuration(durationMs) }));
  }
  const heaviest = targets
    .filter((item) => item.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 3);
  if (heaviest.length > 0) {
    log(t('core.summary.heaviestHeader'));
    heaviest.forEach((item) => {
      log(
        t('core.summary.heaviestEntry', {
          path: item.path,
          size: formatBytes(item.bytes),
          files: item.files,
          dirs: item.dirs,
          duration: formatDuration(item.durationMs)
        })
      );
    });
  }
  const skipEntries = Object.entries(total.skippedBy || {}).filter(([, count]) => count > 0);
  if (skipEntries.length > 0) {
    log(t('core.summary.skippedHeader'));
    skipEntries
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => {
        log(
          t('core.summary.skippedEntry', {
            reason: t(`core.summary.skippedReason.${reason}`),
            count
          })
        );
      });
  }
  if (Array.isArray(total.permissionDenied) && total.permissionDenied.length > 0) {
    log(t('core.summary.permissionHeader', { count: total.permissionDenied.length }));
    const preview = total.permissionDenied.slice(0, 5);
    preview.forEach((entry) => {
      log(t('core.summary.permissionEntry', { path: entry }));
    });
    if (total.permissionDenied.length > preview.length) {
      log(
        t('core.summary.permissionMore', {
          count: total.permissionDenied.length - preview.length
        })
      );
    }
  }
  if (state.dryRun) {
    log(t('core.summary.dryRunNote'));
  }
}

function getDurationUnits() {
  const raw = getTranslationValue('core.units.duration');
  if (raw && typeof raw === 'object') {
    return raw;
  }
  return { ms: 'мс', s: 'с', min: 'хв', h: 'год' };
}

function formatDuration(durationMs) {
  const units = getDurationUnits();
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return `0 ${units.ms || 'мс'}`;
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ${units.ms || 'мс'}`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    const value = seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1);
    return `${value} ${units.s || 'с'}`;
  }
  const minutes = seconds / 60;
  if (minutes < 60) {
    const value = minutes >= 10 ? Math.round(minutes) : minutes.toFixed(1);
    return `${value} ${units.min || 'хв'}`;
  }
  const hours = minutes / 60;
  const value = hours >= 10 ? Math.round(hours) : hours.toFixed(1);
  return `${value} ${units.h || 'год'}`;
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
    console.error(t('core.errors.adminRequired'));
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
