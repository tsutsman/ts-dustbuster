const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { state } = require('./state');
const { normalizePath } = require('./utils/path');

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

function originPrefix(origin) {
  return origin ? `[${origin}] ` : '';
}

function extractErrorMessage(err) {
  return err instanceof Error ? err.message : String(err);
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

function setMaxAge(value, origin) {
  if (value === null) {
    state.maxAgeMs = null;
    return true;
  }
  const parsed = parseDuration(value);
  if (parsed === null || Number.isNaN(parsed)) {
    console.error(`${originPrefix(origin)}Невірне значення для max-age. Приклад: 12h або 30m.`);
    return false;
  }
  state.maxAgeMs = parsed;
  return true;
}

function setConcurrency(value, origin) {
  if (value === undefined) {
    return false;
  }
  if (value === null) {
    state.concurrency = null;
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
  state.concurrency = normalized;
  if (normalized > 1) {
    state.parallel = true;
  }
  return true;
}

function addExtraDir(dir, baseDir = process.cwd()) {
  const resolved = normalizePath(path.isAbsolute(dir) ? dir : path.join(baseDir, dir));
  if (!state.extraDirs.includes(resolved)) {
    state.extraDirs.push(resolved);
  }
}

function addExclusion(dir, baseDir = process.cwd()) {
  const resolved = normalizePath(path.isAbsolute(dir) ? dir : path.join(baseDir, dir));
  if (!state.exclusions.includes(resolved)) {
    state.exclusions.push(resolved);
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

function buildConfigSchema() {
  const stringOrStringArray = {
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }]
  };

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ts-dustbuster configuration',
    type: 'object',
    additionalProperties: false,
    properties: {
      dirs: {
        ...stringOrStringArray,
        description: 'Перелік директорій для очищення (рядок або масив рядків).'
      },
      exclude: {
        ...stringOrStringArray,
        description: 'Шляхи, які потрібно виключити з очищення.'
      },
      maxAge: {
        oneOf: [
          { type: 'number', minimum: 0 },
          { type: 'string', pattern: '^[0-9]+[smhdwSMHDW]?$' }
        ],
        description: 'Мінімальний вік файлів для видалення у годинах або у форматі 30m/12h/5d.'
      },
      summary: { type: 'boolean' },
      parallel: { type: 'boolean' },
      dryRun: { type: 'boolean' },
      deep: { type: 'boolean' },
      logFile: { type: 'string' },
      concurrency: {
        oneOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }],
        description:
          'Обмеження кількості паралельних завдань або null для значення за замовчуванням.'
      },
      preview: { type: 'boolean' },
      presets: {
        ...stringOrStringArray,
        description: 'Підключення інших конфігурацій (рядок або масив рядків).'
      }
    }
  };
}

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
    throw new Error(
      `${originPrefix(normalized)}Не вдалося прочитати файл: ${extractErrorMessage(err)}`
    );
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
    throw new Error(
      `${originPrefix(normalized)}Не вдалося розпарсити конфіг: ${extractErrorMessage(err)}`
    );
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
    state.maxAgeMs = data.maxAge;
  }

  if (data.concurrency !== undefined) {
    if (data.concurrency === null) {
      state.concurrency = null;
    } else if (!setConcurrency(data.concurrency, source)) {
      throw new Error(`${originPrefix(source)}Не вдалося застосувати concurrency.`);
    }
  }

  if (data.summary !== undefined) {
    state.summary = data.summary;
  }
  if (data.parallel !== undefined) {
    state.parallel = data.parallel;
  }
  if (data.dryRun !== undefined) {
    state.dryRun = data.dryRun;
  }
  if (data.deep !== undefined) {
    state.deepClean = data.deep;
  }
  if (data.logFile !== undefined) {
    state.logFile = data.logFile;
  }
  if (data.preview !== undefined) {
    state.interactivePreview = data.preview;
  }
}

function applyConfigFromPath(resolvedPath) {
  try {
    const data = parseConfigFile(resolvedPath);
    applyConfigData(data, resolvedPath);
    return true;
  } catch (err) {
    console.error(extractErrorMessage(err));
    return false;
  }
}

function listConfigFilesInDirectory(directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (err) {
    throw new Error(
      `${originPrefix(directory)}Не вдалося прочитати каталог конфігурацій: ${extractErrorMessage(err)}`
    );
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
    console.error(extractErrorMessage(err));
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
      console.error(extractErrorMessage(err));
      return false;
    }
  }

  try {
    applyConfigData(accumulated, `${resolvedDir}${path.sep}*`);
    return true;
  } catch (err) {
    console.error(extractErrorMessage(err));
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
    console.error(
      `${originPrefix(resolved)}Не вдалося отримати дані про шлях: ${extractErrorMessage(err)}`
    );
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
    console.error(extractErrorMessage(err));
    return false;
  }
}

module.exports = {
  parseDuration,
  setMaxAge,
  setConcurrency,
  addExtraDir,
  addExclusion,
  buildConfigSchema,
  handleConfigArgument,
  handlePresetArgument
};
