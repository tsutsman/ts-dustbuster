const DEFAULT_LOCALE = 'uk';
const SUPPORTED_LOCALES = new Set(['uk', 'en']);

const resources = {
  uk: require('./locales/uk.json'),
  en: require('./locales/en.json')
};

let localeOverride = null;

function normalizeLocale(value) {
  if (!value) {
    return null;
  }
  const lower = String(value).toLowerCase();
  if (lower.startsWith('uk') || lower.startsWith('ua')) {
    return 'uk';
  }
  if (lower.startsWith('en')) {
    return 'en';
  }
  return null;
}

function detectEnvLocale() {
  const candidates = [process.env.LANG, process.env.LC_ALL, process.env.LC_MESSAGES];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const trimmed = candidate.split('.')[0];
    const normalized = normalizeLocale(trimmed);
    if (normalized && SUPPORTED_LOCALES.has(normalized)) {
      return normalized;
    }
  }
  return DEFAULT_LOCALE;
}

function getLocale() {
  if (localeOverride && SUPPORTED_LOCALES.has(localeOverride)) {
    return localeOverride;
  }
  return detectEnvLocale();
}

function setLocaleOverride(locale) {
  const normalized = normalizeLocale(locale);
  localeOverride = normalized && SUPPORTED_LOCALES.has(normalized) ? normalized : null;
}

function getRawValue(locale, key) {
  const segments = key.split('.');
  let current = resources[locale];
  for (const segment of segments) {
    if (current && Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function formatString(template, params) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, token) => {
    if (Object.prototype.hasOwnProperty.call(params, token)) {
      return String(params[token]);
    }
    return match;
  });
}

function formatValue(value, params) {
  if (Array.isArray(value)) {
    return value.map((item) => formatString(String(item), params)).join('\n');
  }
  if (typeof value === 'string') {
    return formatString(value, params);
  }
  return value;
}

function getFallbackValue(key) {
  return getRawValue(DEFAULT_LOCALE, key);
}

function getTranslationValue(key) {
  const locale = getLocale();
  const primary = getRawValue(locale, key);
  if (primary !== undefined) {
    return primary;
  }
  if (locale !== DEFAULT_LOCALE) {
    return getFallbackValue(key);
  }
  return undefined;
}

function t(key, params = {}) {
  const value = getTranslationValue(key);
  if (value === undefined) {
    return key;
  }
  return formatValue(value, params);
}

module.exports = {
  t,
  getLocale,
  setLocaleOverride,
  getTranslationValue,
  DEFAULT_LOCALE
};
