#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const readline = require('readline');
const YAML = require('yaml');

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
let concurrency = null;
let interactivePreview = false;
let previewPromptHandler = null;
let previewInterface = null;
let helpRequested = false;
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
  return exclusions.some((ex) => isWithin(ex, resolved));
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

function setPreviewPromptHandler(handler) {
  previewPromptHandler = typeof handler === 'function' ? handler : null;
}

function closePreviewInterface() {
  if (previewInterface) {
    previewInterface.close();
    previewInterface = null;
  }
}

async function askForPreviewConfirmation(message) {
  if (previewPromptHandler) {
    return Boolean(await previewPromptHandler(message));
  }

  if (!process.stdin.isTTY) {
    console.error(
      'Режим попереднього перегляду недоступний у неінтерактивному середовищі. Каталог буде пропущено.'
    );
    return false;
  }

  if (!previewInterface) {
    previewInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  return new Promise((resolve) => {
    previewInterface.question(message, (answer) => {
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
      if (dryRun) {
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

function originPrefix(origin) {
  return origin ? `[${origin}] ` : '';
}

function setMaxAge(value, origin) {
  if (value === null) {
    maxAgeMs = null;
    return true;
  }
  const parsed = parseDuration(value);
  if (parsed === null || Number.isNaN(parsed)) {
    console.error(`${originPrefix(origin)}Невірне значення для max-age. Приклад: 12h або 30m.`);
    return false;
  }
  maxAgeMs = parsed;
  return true;
}

function setConcurrency(value, origin) {
  if (value === undefined) {
    return false;
  }
  if (value === null) {
    concurrency = null;
    return true;
  }
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(
      `${originPrefix(origin)}Невірне значення для concurrency. Використайте додатне ціле число.`
    );
    return false;
  }
  const normalized = Math.floor(parsed);
  if (normalized !== parsed) {
    console.error(`${originPrefix(origin)}Значення concurrency має бути цілим числом.`);
    return false;
  }
  concurrency = normalized;
  if (normalized > 1) {
    parallel = true;
  }
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

function createEmptyPresetData() {
  return {
    dirs: [],
    exclude: [],
    maxAge: undefined,
    summary: undefined,
    parallel: undefined,
    dryRun: undefined,
    deep: undefined,
    logFile: undefined,
    concurrency: undefined,
    preview: undefined
  };
}

function mergePresetData(base, addition) {
  return {
    dirs: [...base.dirs, ...addition.dirs],
    exclude: [...base.exclude, ...addition.exclude],
    maxAge: addition.maxAge !== undefined ? addition.maxAge : base.maxAge,
    summary: addition.summary !== undefined ? addition.summary : base.summary,
    parallel: addition.parallel !== undefined ? addition.parallel : base.parallel,
    dryRun: addition.dryRun !== undefined ? addition.dryRun : base.dryRun,
    deep: addition.deep !== undefined ? addition.deep : base.deep,
    logFile: addition.logFile !== undefined ? addition.logFile : base.logFile,
    concurrency: addition.concurrency !== undefined ? addition.concurrency : base.concurrency,
    preview: addition.preview !== undefined ? addition.preview : base.preview
  };
}

function ensureArrayOfStrings(value, key, source) {
  if (!Array.isArray(value)) {
    throw new Error(`${originPrefix(source)}Поле ${key} має бути масивом рядків.`);
  }
  return value.map((item, idx) => {
    if (typeof item !== 'string') {
      throw new Error(`${originPrefix(source)}Елемент ${key}[${idx}] має бути рядком.`);
    }
    const trimmed = item.trim();
    if (!trimmed) {
      throw new Error(
        `${originPrefix(source)}Елемент ${key}[${idx}] не може бути порожнім рядком.`
      );
    }
    return trimmed;
  });
}

function ensureOptionalBoolean(value, key, source) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${originPrefix(source)}Поле ${key} має бути булевим значенням true/false.`);
  }
  return value;
}

function ensureOptionalLogFile(value, baseDir, source) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${originPrefix(source)}Поле logFile має бути непорожнім рядком або null.`);
  }
  const trimmed = value.trim();
  return normalizePath(path.isAbsolute(trimmed) ? trimmed : path.join(baseDir, trimmed));
}

function ensureOptionalMaxAge(value, source) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(
      `${originPrefix(source)}Поле maxAge має бути числом годин або рядком (наприклад, 12h).`
    );
  }
  const parsed = parseDuration(value);
  if (parsed === null || Number.isNaN(parsed)) {
    throw new Error(
      `${originPrefix(source)}Поле maxAge має бути у форматі 30m, 12h, 5d або числом годин.`
    );
  }
  return parsed;
}

function ensureOptionalConcurrency(value, source) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${originPrefix(source)}Поле concurrency має бути додатним цілим числом.`);
  }
  if (!Number.isInteger(parsed)) {
    throw new Error(`${originPrefix(source)}Поле concurrency має бути цілим числом.`);
  }
  return parsed;
}

const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml']);

const ALLOWED_CONFIG_KEYS = new Set([
  'dirs',
  'exclude',
  'maxAge',
  'summary',
  'parallel',
  'dryRun',
  'deep',
  'logFile',
  'concurrency',
  'preview',
  'presets'
]);

function extractConfig(config, baseDir, source) {
  const result = createEmptyPresetData();

  for (const key of Object.keys(config)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      throw new Error(`${originPrefix(source)}Невідоме поле "${key}" у конфігурації.`);
    }
  }

  if (config.dirs !== undefined) {
    const dirs = ensureArrayOfStrings(config.dirs, 'dirs', source).map((entry) =>
      normalizePath(path.isAbsolute(entry) ? entry : path.join(baseDir, entry))
    );
    result.dirs.push(...dirs);
  }

  if (config.exclude !== undefined) {
    const exclude = ensureArrayOfStrings(config.exclude, 'exclude', source).map((entry) =>
      normalizePath(path.isAbsolute(entry) ? entry : path.join(baseDir, entry))
    );
    result.exclude.push(...exclude);
  }

  result.maxAge = ensureOptionalMaxAge(config.maxAge, source);
  result.summary = ensureOptionalBoolean(config.summary, source);
  result.parallel = ensureOptionalBoolean(config.parallel, source);
  result.dryRun = ensureOptionalBoolean(config.dryRun, source);
  result.deep = ensureOptionalBoolean(config.deep, source);
  result.logFile = ensureOptionalLogFile(config.logFile, baseDir, source);
  result.concurrency = ensureOptionalConcurrency(config.concurrency, source);
  result.preview = ensureOptionalBoolean(config.preview, source);

  return result;
}

function resolvePreset(reference, baseDir) {
  if (typeof reference !== 'string' || !reference.trim()) {
    throw new Error(`${originPrefix(baseDir)}Назва пресету має бути непорожнім рядком.`);
  }

  const trimmed = reference.trim();
  const hasExt = path.extname(trimmed) !== '';
  const hasSeparator = /[\\/]/.test(trimmed);
  const baseSearchDirs = [];

  const normalizedBase = baseDir || process.cwd();

  if (path.isAbsolute(trimmed)) {
    baseSearchDirs.push('');
  } else {
    baseSearchDirs.push(normalizedBase);
    if (!hasSeparator) {
      baseSearchDirs.push(path.join(normalizedBase, 'presets'));
      baseSearchDirs.push(path.join(process.cwd(), 'presets'));
      baseSearchDirs.push(path.join(__dirname, 'presets'));
    }
  }

  const variants = [];
  const appendVariants = (target) => {
    if (hasExt) {
      variants.push(target);
    } else {
      variants.push(target);
      variants.push(`${target}.yaml`);
      variants.push(`${target}.yml`);
      variants.push(`${target}.json`);
    }
  };

  if (path.isAbsolute(trimmed)) {
    appendVariants(trimmed);
  } else {
    for (const dir of baseSearchDirs) {
      if (!dir) {
        appendVariants(trimmed);
      } else {
        appendVariants(path.join(dir, trimmed));
      }
    }
  }

  const checked = new Set();
  for (const candidate of variants) {
    const normalized = normalizePath(candidate);
    if (checked.has(normalized)) {
      continue;
    }
    checked.add(normalized);
    if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
      return normalized;
    }
  }

  throw new Error(`${originPrefix(baseDir)}Не вдалося знайти пресет "${reference}".`);
}

function parseConfigFile(filePath, visited = new Set()) {
  const normalized = normalizePath(filePath);
  if (visited.has(normalized)) {
    throw new Error(`${originPrefix(normalized)}Виявлено циклічне підключення пресетів.`);
  }
  visited.add(normalized);

  let raw;
  try {
    raw = fs.readFileSync(normalized, 'utf8');
  } catch (err) {
    throw new Error(`${originPrefix(normalized)}Не вдалося прочитати файл: ${err.message}`);
  }

  const ext = path.extname(normalized).toLowerCase();
  let parsed;
  try {
    if (ext === '.json') {
      parsed = raw.trim() ? JSON.parse(raw) : {};
    } else if (ext === '.yaml' || ext === '.yml') {
      parsed = raw.trim() ? YAML.parse(raw) : {};
    } else {
      try {
        parsed = raw.trim() ? JSON.parse(raw) : {};
      } catch (jsonErr) {
        try {
          parsed = raw.trim() ? YAML.parse(raw) : {};
        } catch (yamlErr) {
          throw new Error(
            `${originPrefix(normalized)}Не вдалося розпарсити конфіг: ${yamlErr.message || jsonErr.message}`
          );
        }
      }
    }
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`${originPrefix(normalized)}Не вдалося розпарсити конфіг: ${err.message}`);
    }
    throw err;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `${originPrefix(normalized)}Конфігурація має бути об'єктом (мапою ключ-значення).`
    );
  }

  const baseDir = path.dirname(normalized);
  let accumulated = createEmptyPresetData();

  if (parsed.presets !== undefined) {
    const presets = ensureArrayOfStrings(parsed.presets, 'presets', normalized);
    for (const presetRef of presets) {
      const presetPath = resolvePreset(presetRef, baseDir);
      const nested = parseConfigFile(presetPath, visited);
      accumulated = mergePresetData(accumulated, nested);
    }
  }

  const rest = { ...parsed };
  delete rest.presets;
  const current = extractConfig(rest, baseDir, normalized);
  accumulated = mergePresetData(accumulated, current);

  visited.delete(normalized);
  return accumulated;
}

function applyConfigData(data, source) {
  data.dirs.forEach((dir) => addExtraDir(dir));
  data.exclude.forEach((dir) => addExclusion(dir));

  if (data.maxAge !== undefined) {
    maxAgeMs = data.maxAge;
  }

  if (data.concurrency !== undefined) {
    if (data.concurrency === null) {
      concurrency = null;
    } else if (!setConcurrency(data.concurrency, source)) {
      throw new Error(`${originPrefix(source)}Не вдалося застосувати concurrency.`);
    }
  }

  if (data.summary !== undefined) {
    summary = data.summary;
  }
  if (data.parallel !== undefined) {
    parallel = data.parallel;
  }
  if (data.dryRun !== undefined) {
    dryRun = data.dryRun;
  }
  if (data.deep !== undefined) {
    deepClean = data.deep;
  }
  if (data.logFile !== undefined) {
    logFile = data.logFile;
  }
  if (data.preview !== undefined) {
    interactivePreview = data.preview;
  }
}

function applyConfigFromPath(resolvedPath) {
  try {
    const data = parseConfigFile(resolvedPath);
    applyConfigData(data, resolvedPath);
    return true;
  } catch (err) {
    if (err instanceof Error) {
      console.error(err.message);
      return false;
    }
    console.error(err);
    return false;
  }
}

function listConfigFilesInDirectory(directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(
        `${originPrefix(directory)}Не вдалося прочитати каталог конфігурацій: ${err.message}`
      );
    }
    throw err;
  }

  const files = entries
    .filter(
      (entry) => entry.isFile() && CONFIG_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    )
    .map((entry) => normalizePath(path.join(directory, entry.name)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  return files;
}

function applyConfigFromDirectory(resolvedDir) {
  let files;
  try {
    files = listConfigFilesInDirectory(resolvedDir);
  } catch (err) {
    if (err instanceof Error) {
      console.error(err.message);
      return false;
    }
    console.error(err);
    return false;
  }

  if (!files.length) {
    console.error(
      `${originPrefix(resolvedDir)}Каталог не містить конфігурацій з розширеннями .json, .yaml або .yml.`
    );
    return false;
  }

  let accumulated = createEmptyPresetData();

  for (const file of files) {
    try {
      const data = parseConfigFile(file);
      accumulated = mergePresetData(accumulated, data);
    } catch (err) {
      if (err instanceof Error) {
        console.error(err.message);
        return false;
      }
      console.error(err);
      return false;
    }
  }

  try {
    applyConfigData(accumulated, `${resolvedDir}${path.sep}*`);
    return true;
  } catch (err) {
    if (err instanceof Error) {
      console.error(err.message);
      return false;
    }
    console.error(err);
    return false;
  }
}

function handleConfigArgument(configPath) {
  const resolved = normalizePath(
    path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath)
  );

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (err) {
    if (err instanceof Error) {
      console.error(`${originPrefix(resolved)}Не вдалося отримати дані про шлях: ${err.message}`);
      return false;
    }
    console.error(err);
    return false;
  }

  if (stat.isDirectory()) {
    return applyConfigFromDirectory(resolved);
  }

  if (!stat.isFile()) {
    console.error(`${originPrefix(resolved)}Шлях має бути файлом або каталогом з конфігураціями.`);
    return false;
  }

  return applyConfigFromPath(resolved);
}

function handlePresetArgument(presetRef) {
  try {
    const resolved = resolvePreset(presetRef, process.cwd());
    return applyConfigFromPath(resolved);
  } catch (err) {
    if (err instanceof Error) {
      console.error(err.message);
      return false;
    }
    console.error(err);
    return false;
  }
}

function logSummary(total) {
  log(
    `Підсумок: файлів ${total.files}, тек ${total.dirs}, пропущено ${total.skipped}, помилок ${total.errors}, звільнено ${formatBytes(total.bytes)}.`
  );
  if (dryRun) {
    log('Режим dry-run: показані значення відображають потенційно звільнений простір.');
  }
}

function printHelp() {
  console.log(
    [
      'Використання: dustbuster [опції]',
      '',
      'Опції:',
      '  -h, --help            Показати цю довідку.',
      '  --dry-run             Лише показати дії без фактичного видалення.',
      '  --parallel            Виконувати очищення паралельно.',
      '  --concurrency N       Обмежити кількість паралельних завдань.',
      '  --dir <шлях>          Додати додатковий каталог до списку.',
      '  --exclude <шлях>      Виключити каталог з очищення.',
      '  --config <шлях>       Застосувати конфігурацію (файл або каталог).',
      '  --preset <назва>      Завантажити пресет за назвою або шляхом.',
      '  --max-age <тривалість>Видаляти лише елементи старші за вказаний час.',
      '  --summary             Показати підсумкову статистику.',
      '  --preview             Інтерактивно підтверджувати очищення.',
      '  --log <файл>          Зберігати журнал виконання у файл.',
      '  --deep                Запускати додаткове очищення (Windows).'
    ].join('\n')
  );
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
    execSync('PowerShell -NoLogo -NoProfile -Command "Clear-RecycleBin -Force"', {
      stdio: 'inherit'
    });
  } catch {}
  try {
    execSync('dism /online /Cleanup-Image /StartComponentCleanup /ResetBase', { stdio: 'inherit' });
  } catch {}
  try {
    execSync('RunDll32.exe InetCpl.cpl,ClearMyTracksByProcess 8', { stdio: 'inherit' });
  } catch {}
  try {
    const logs = execSync('wevtutil.exe el', { encoding: 'utf8' }).trim().split(/\r?\n/);
    logs.forEach((log) => {
      if (log) {
        try {
          execSync(`wevtutil.exe cl "${log}"`);
        } catch {}
      }
    });
  } catch {}
  try {
    execSync('net stop wuauserv', { stdio: 'inherit' });
    execSync('net stop bits', { stdio: 'inherit' });
    fs.rmSync(path.join(process.env.WINDIR || 'C:/Windows', 'SoftwareDistribution'), {
      recursive: true,
      force: true
    });
    execSync('net start wuauserv', { stdio: 'inherit' });
    execSync('net start bits', { stdio: 'inherit' });
  } catch {}
}

function parseArgs(args = process.argv.slice(2)) {
  let ok = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--parallel') {
      parallel = true;
    } else if (a === '--deep') {
      deepClean = true;
    } else if (a === '--help' || a === '-h') {
      helpRequested = true;
    } else if (a === '--log') {
      if (!args[i + 1]) {
        console.error('Прапорець --log вимагає шлях до файлу.');
        ok = false;
      } else {
        logFile = args[++i];
      }
    } else if (a === '--dir') {
      if (!args[i + 1]) {
        console.error('Прапорець --dir вимагає шлях до директорії.');
        ok = false;
      } else {
        addExtraDir(args[++i]);
      }
    } else if (a === '--exclude') {
      if (!args[i + 1]) {
        console.error('Прапорець --exclude вимагає шлях до директорії.');
        ok = false;
      } else {
        addExclusion(args[++i]);
      }
    } else if (a === '--summary') {
      summary = true;
    } else if (a === '--preview') {
      interactivePreview = true;
    } else if (a === '--max-age') {
      if (!args[i + 1]) {
        console.error('Прапорець --max-age вимагає значення тривалості.');
        ok = false;
      } else if (!setMaxAge(args[++i])) {
        ok = false;
      }
    } else if (a === '--concurrency') {
      if (!args[i + 1]) {
        console.error('Прапорець --concurrency вимагає числове значення.');
        ok = false;
      } else if (!setConcurrency(args[++i])) {
        ok = false;
      }
    } else if (a === '--config') {
      if (!args[i + 1]) {
        console.error('Прапорець --config вимагає шлях до файлу конфігурації.');
        ok = false;
      } else if (!handleConfigArgument(args[++i])) {
        ok = false;
      }
    } else if (a === '--preset') {
      if (!args[i + 1]) {
        console.error('Прапорець --preset вимагає назву або шлях до пресету.');
        ok = false;
      } else if (!handlePresetArgument(args[++i])) {
        ok = false;
      }
    }
  }
  return ok;
}

function concurrencyLimit(taskCount) {
  if (typeof concurrency === 'number' && concurrency > 0) {
    return Math.min(concurrency, taskCount);
  }
  if (parallel) {
    return taskCount;
  }
  return 1;
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
    const promise = task
      .then((result) => {
        executing.delete(promise);
        return result;
      })
      .catch((err) => {
        executing.delete(promise);
        throw err;
      });
    executing.add(promise);
    results.push(promise);
    return promise;
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
    targetOverride.forEach((dir) => pushIfExists(targets, dir));
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
    } else if (process.platform === 'darwin') {
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
    extraDirs.forEach((d) => pushIfExists(targets, d));
  }

  let filteredTargets = targets.filter((dir) => {
    if (isExcluded(dir)) {
      log(`[skip] Каталог пропущено за виключенням: ${dir}`);
      return false;
    }
    return true;
  });

  if (interactivePreview && filteredTargets.length > 0) {
    const confirmed = await filterTargetsByPreview(filteredTargets);
    filteredTargets = confirmed;
    if (filteredTargets.length === 0) {
      log('Режим попереднього перегляду: жодного каталогу не підтверджено до очищення.');
    }
  }

  if (filteredTargets.length === 0) {
    const total = createMetrics();
    if (summary) {
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

  if (summary) {
    logSummary(total);
  }

  if (deepClean && process.platform === 'win32') {
    advancedWindowsClean();
  }

  return total;
}

const parsedOk = parseArgs();

if (parseInt(process.versions.node.split('.')[0], 10) < MIN_NODE_MAJOR) {
  console.error(`Потрібна Node.js >= ${MIN_NODE_MAJOR}. Поточна ${process.versions.node}`);
  process.exit(1);
}

if (require.main === module) {
  if (helpRequested) {
    printHelp();
    process.exit(parsedOk ? 0 : 1);
  }
  if (!parsedOk) {
    process.exit(1);
  }
  clean().catch((err) => {
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
    exclusions: [...exclusions],
    concurrency,
    interactivePreview,
    helpRequested
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
  concurrency = null;
  interactivePreview = false;
  previewPromptHandler = null;
  closePreviewInterface();
  helpRequested = false;
}

// експортуємо clean для повторного використання у GUI
module.exports = {
  pushIfExists,
  removeDirContents,
  parseArgs,
  advancedWindowsClean,
  getOptions,
  clean,
  resetOptions,
  setPreviewPromptHandler
};
