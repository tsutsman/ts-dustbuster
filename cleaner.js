#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// мінімально сумісна версія Node.js
// minimum supported Node.js version
const MIN_NODE_MAJOR = 16;

// змінні керування
// control variables
let dryRun = false;
let parallel = false;
let deepClean = false;
let logFile = null;
const extraDirs = [];
let summary = false;
let maxAgeMs = null;
const exclusions = [];
// additional directories to clean

function log(msg) {
  console.log(msg);
  if (logFile) {
    fs.appendFileSync(logFile, msg + '\n');
  }
}

function normalizePath(target) {
  return path.resolve(target);
}

function isWithin(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isExcluded(target) {
  if (!exclusions.length) {
    return false;
  }
  const resolved = normalizePath(target);
  return exclusions.some(ex => isWithin(ex, resolved));
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
    idx++;
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

async function inspectPath(fullPath, stat) {
  let info = { files: 0, dirs: 0, bytes: 0 };
  const currentStat = stat || await fs.promises.lstat(fullPath);
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

function parseDuration(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 0) {
      return null;
    }
    return value * 60 * 60 * 1000;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const match = trimmed.match(/^(\d+)([smhdw]?)$/i);
  if (!match) {
    return null;
  }
  const amount = parseInt(match[1], 10);
  const unit = (match[2] || 'h').toLowerCase();
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
  };
  const multiplier = multipliers[unit];
  if (!multiplier) {
    return null;
  }
  return amount * multiplier;
}

function setMaxAge(value) {
  const parsed = parseDuration(value);
  if (parsed === null || Number.isNaN(parsed)) {
    console.error('Невірне значення для --max-age. Приклад: 12h або 30m.');
    return false;
  }
  maxAgeMs = parsed;
  return true;
}

function addExtraDir(dir, baseDir = process.cwd()) {
  const resolved = normalizePath(path.isAbsolute(dir) ? dir : path.join(baseDir, dir));
  if (!extraDirs.includes(resolved)) {
    extraDirs.push(resolved);
  }
}

function addExclusion(dir, baseDir = process.cwd()) {
  const resolved = normalizePath(path.isAbsolute(dir) ? dir : path.join(baseDir, dir));
  if (!exclusions.includes(resolved)) {
    exclusions.push(resolved);
  }
}

function logSummary(total) {
  log(`Підсумок: файлів ${total.files}, тек ${total.dirs}, пропущено ${total.skipped}, помилок ${total.errors}, звільнено ${formatBytes(total.bytes)}.`);
  if (dryRun) {
    log('Режим dry-run: показані значення відображають потенційно звільнений простір.');
  }
}

function pushIfExists(list, dir) {
  const resolved = normalizePath(dir);
  if (fs.existsSync(resolved)) {
    list.push(resolved);
  }
}

function isAdmin() {
  try {
    execSync('net session >nul 2>&1');
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
    execSync('PowerShell -NoLogo -NoProfile -Command "Clear-RecycleBin -Force"', { stdio: 'inherit' });
  } catch {}
  try {
    execSync('dism /online /Cleanup-Image /StartComponentCleanup /ResetBase', { stdio: 'inherit' });
  } catch {}
  try {
    execSync('RunDll32.exe InetCpl.cpl,ClearMyTracksByProcess 8', { stdio: 'inherit' });
  } catch {}
  try {
    const logs = execSync('wevtutil.exe el', { encoding: 'utf8' })
      .trim().split(/\r?\n/);
    logs.forEach(log => {
      if (log) {
        try { execSync(`wevtutil.exe cl "${log}"`); } catch {}
      }
    });
  } catch {}
  try {
    execSync('net stop wuauserv', { stdio: 'inherit' });
    execSync('net stop bits', { stdio: 'inherit' });
    fs.rmSync(path.join(process.env.WINDIR || 'C:/Windows', 'SoftwareDistribution'), { recursive: true, force: true });
    execSync('net start wuauserv', { stdio: 'inherit' });
    execSync('net start bits', { stdio: 'inherit' });
  } catch {}
}

function parseArgs(args = process.argv.slice(2)) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--parallel') {
      parallel = true;
    } else if (a === '--deep') {
      deepClean = true;
    } else if (a === '--log' && args[i + 1]) {
      logFile = args[++i];
    } else if (a === '--dir' && args[i + 1]) {
      addExtraDir(args[++i]);
    } else if (a === '--exclude' && args[i + 1]) {
      addExclusion(args[++i]);
    } else if (a === '--summary') {
      summary = true;
    } else if (a === '--max-age' && args[i + 1]) {
      if (!setMaxAge(args[++i])) {
        // повідомлення вже виведено всередині setMaxAge
      }
    } else if (a === '--config' && args[i + 1]) {
      const cfgPath = args[++i];
      try {
        const data = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        if (Array.isArray(data.dirs)) {
          data.dirs.forEach(dir => addExtraDir(dir, path.dirname(cfgPath)));
        }
        if (Array.isArray(data.exclude)) {
          data.exclude.forEach(dir => addExclusion(dir, path.dirname(cfgPath)));
        }
        if (data.maxAge !== undefined) {
          setMaxAge(data.maxAge);
        }
        if (typeof data.summary === 'boolean') {
          summary = data.summary;
        }
        if (typeof data.parallel === 'boolean') {
          parallel = data.parallel;
        }
        if (typeof data.dryRun === 'boolean') {
          dryRun = data.dryRun;
        }
        if (typeof data.deep === 'boolean') {
          deepClean = data.deep;
        }
        if (typeof data.logFile === 'string') {
          logFile = path.isAbsolute(data.logFile)
            ? data.logFile
            : path.join(path.dirname(cfgPath), data.logFile);
        }
      } catch (err) {
        console.error(`Не вдалося прочитати конфіг ${cfgPath}:`, err.message);
      }
    }
  }
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
      if (maxAgeMs !== null) {
        const age = Date.now() - stat.mtimeMs;
        if (age < maxAgeMs) {
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
      if (dryRun) {
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
    log(dryRun ? `[dry-run] Завершив ${dir}` : `Очистив: ${dir}`);
  } catch (err) {
    console.error(`Не вдалося очистити ${dir}:`, err.message);
    metrics.errors += 1;
  }
  return metrics;
}

async function clean({ targets: targetOverride } = {}) {
  const targets = [];
  if (Array.isArray(targetOverride) && targetOverride.length > 0) {
    targetOverride.forEach(dir => pushIfExists(targets, dir));
  } else {
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
        pushIfExists(targets, path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'));
        pushIfExists(targets, path.join(process.env.LOCALAPPDATA, 'CrashDumps'));
      }
      if (process.env.APPDATA) {
        pushIfExists(targets, path.join(process.env.APPDATA, 'npm-cache'));
      }
    } else if (process.platform === 'darwin') {
      pushIfExists(targets, '/var/tmp');
      pushIfExists(targets, path.join(os.homedir(), 'Library', 'Caches'));
      pushIfExists(targets, path.join(os.homedir(), 'Library', 'Logs'));
      pushIfExists(targets, path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cache'));
      pushIfExists(targets, path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'Cache'));
      pushIfExists(targets, path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge', 'Default', 'Cache'));
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
    extraDirs.forEach(d => pushIfExists(targets, d));
  }

  const filteredTargets = targets.filter(dir => {
    if (isExcluded(dir)) {
      log(`[skip] Каталог пропущено за виключенням: ${dir}`);
      return false;
    }
    return true;
  });

  const allMetrics = [];
  const tasks = filteredTargets.map(dir => removeDirContents(dir, createMetrics()));
  if (parallel) {
    allMetrics.push(...await Promise.all(tasks));
  } else {
    for (const task of tasks) {
      allMetrics.push(await task);
    }
  }

  const total = allMetrics.reduce((acc, item) => mergeMetrics(acc, item), createMetrics());

  if (summary) {
    logSummary(total);
  }

  if (deepClean && process.platform === 'win32') {
    advancedWindowsClean();
  }

  return total;
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

function getOptions() {
  return {
    dryRun,
    parallel,
    deepClean,
    logFile,
    extraDirs: [...extraDirs],
    summary,
    maxAgeMs,
    exclusions: [...exclusions]
  };
}

function resetOptions() {
  dryRun = false;
  parallel = false;
  deepClean = false;
  logFile = null;
  summary = false;
  maxAgeMs = null;
  extraDirs.length = 0;
  exclusions.length = 0;
}

// експортуємо clean для повторного використання у GUI
module.exports = { pushIfExists, removeDirContents, parseArgs, advancedWindowsClean, getOptions, clean, resetOptions };
