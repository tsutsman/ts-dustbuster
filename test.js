const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  pushIfExists,
  removeDirContents,
  parseArgs,
  getOptions,
  clean,
  resetOptions,
  advancedWindowsClean,
  setPreviewPromptHandler,
  setExecSyncHandler,
  setPlatformOverride,
  setNodeVersionOverride,
  setMainOverride,
  setParsedOkOverride,
  runCli,
  setCleanOverride,
  runWithLimit
} = require('./cleaner');
const { handleConfigArgument } = require('./src/config');

const CURRENT_NODE_MAJOR = parseInt(process.versions.node.split('.')[0], 10);

(async () => {
  // Тест pushIfExists
  resetOptions();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
  const list = [];
  pushIfExists(list, tmp);
  assert.strictEqual(list.length, 1, 'Каталог повинен додатися');
  pushIfExists(list, path.join(tmp, 'неіснуючий'));
  assert.strictEqual(list.length, 1, 'Неіснуючий каталог не додається');

  // Тест removeDirContents
  resetOptions();
  const file = path.join(tmp, 'a.txt');
  fs.writeFileSync(file, 'data');
  const sub = path.join(tmp, 'sub');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'b.txt'), 'data');
  const metricsAfterRemove = await removeDirContents(tmp);
  const entries = fs.readdirSync(tmp);
  assert.strictEqual(entries.length, 0, 'Каталог має бути порожнім');
  assert.strictEqual(
    metricsAfterRemove.files,
    2,
    'Має бути видалено два файли (включно з вкладеними)'
  );
  assert.strictEqual(metricsAfterRemove.dirs, 1, 'Має бути видалено одну піддиректорію');
  fs.rmdirSync(tmp);

  const missingMetrics = await removeDirContents(path.join(os.tmpdir(), 'db-missing-nonexistent'));
  assert.ok(
    missingMetrics.errors >= 1,
    'Помилка читання каталогу має збільшувати лічильник помилок'
  );

  // Тест parseArgs
  resetOptions();
  const excludeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-exclude-'));
  assert.ok(
    parseArgs([
      '--dry-run',
      '--parallel',
      '--deep',
      '--summary',
      '--max-age',
      '2d',
      '--exclude',
      excludeDir,
      '--log',
      'out.log'
    ]),
    'Аргументи командного рядка мають оброблятися без помилок'
  );
  const opts = getOptions();
  assert.ok(opts.dryRun, 'dry-run має бути увімкнено');
  assert.ok(opts.parallel, 'parallel має бути увімкнено');
  assert.ok(opts.deepClean, 'deep має бути увімкнено');
  assert.ok(opts.summary, 'summary має бути увімкнено');
  assert.strictEqual(opts.maxAgeMs, 2 * 24 * 60 * 60 * 1000, 'maxAge має відповідати 2 дням');
  assert.ok(
    opts.exclusions.includes(path.resolve(excludeDir)),
    'Шлях має бути у переліку виключень'
  );
  assert.strictEqual(opts.logFile, 'out.log', 'Шлях до лог-файлу зберігається як передано');
  resetOptions();
  fs.rmSync(excludeDir, { recursive: true, force: true });

  // Тест --help
  resetOptions();
  assert.ok(parseArgs(['--help']), 'Прапорець --help має зчитуватися без помилок');
  const optsHelp = getOptions();
  assert.ok(optsHelp.helpRequested, 'Опція help має позначати необхідність показу довідки');

  resetOptions();
  const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-extra-dir-'));
  assert.ok(parseArgs(['--dir', customDir]), '--dir має додавати новий каталог');
  const optsWithDir = getOptions();
  assert.ok(
    optsWithDir.extraDirs.includes(path.resolve(customDir)),
    'Додатковий каталог має бути збережений у налаштуваннях'
  );
  resetOptions();
  fs.rmSync(customDir, { recursive: true, force: true });

  // Тест --concurrency
  resetOptions();
  assert.ok(parseArgs(['--concurrency', '3']), 'concurrency=3 має зчитуватися без помилок');
  const optsConcurrency = getOptions();
  assert.strictEqual(optsConcurrency.concurrency, 3, 'concurrency має дорівнювати 3');
  assert.ok(optsConcurrency.parallel, 'parallel має бути активованим при concurrency > 1');

  resetOptions();
  assert.ok(parseArgs(['--concurrency', '1']), 'concurrency=1 має зчитуватися без помилок');
  const optsConcurrencyOne = getOptions();
  assert.strictEqual(optsConcurrencyOne.concurrency, 1, 'concurrency має дорівнювати 1');
  assert.ok(
    !optsConcurrencyOne.parallel,
    'parallel не має активуватися при concurrency = 1 без прапорця parallel'
  );

  resetOptions();
  const cfgPath = path.join(os.tmpdir(), 'db-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ concurrency: 2 }));
  assert.ok(parseArgs(['--config', cfgPath]), 'JSON-конфігурація має застосовуватися без помилок');
  const optsFromConfig = getOptions();
  assert.strictEqual(optsFromConfig.concurrency, 2, 'concurrency має зчитуватися з конфігурації');
  assert.ok(optsFromConfig.parallel, 'parallel має вмикатися, якщо concurrency > 1 у конфігурації');
  fs.unlinkSync(cfgPath);

  // Тест кешування пресетів конфігурації
  resetOptions();
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-cache-'));
  const presetPath = path.join(cacheDir, 'preset.json');
  fs.writeFileSync(presetPath, JSON.stringify({ dirs: ['./tmp'] }));
  const mainConfigPath = path.join(cacheDir, 'main.json');
  fs.writeFileSync(mainConfigPath, JSON.stringify({ presets: [presetPath] }));
  const secondaryConfigPath = path.join(cacheDir, 'secondary.json');
  fs.writeFileSync(secondaryConfigPath, JSON.stringify({ presets: [presetPath] }));
  let presetReadCount = 0;
  const originalReadFileSync = fs.readFileSync;
  const normalizedPreset = path.resolve(presetPath);
  fs.readFileSync = (file, ...rest) => {
    if (path.resolve(file) === normalizedPreset) {
      presetReadCount += 1;
    }
    return originalReadFileSync(file, ...rest);
  };
  try {
    assert.ok(
      handleConfigArgument(mainConfigPath),
      'Основний конфіг має застосовуватися без помилок'
    );
    assert.ok(
      handleConfigArgument(secondaryConfigPath),
      'Повторне використання пресету має застосовуватися без помилок'
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  assert.strictEqual(
    presetReadCount,
    1,
    'Пресет має зчитуватися з диска лише один раз завдяки кешу'
  );

  // Тест прапорців --validate та --config-schema
  resetOptions();
  assert.ok(parseArgs(['--validate']), 'Прапорець --validate має зчитуватися без помилок');
  const optsValidateFlag = getOptions();
  assert.ok(optsValidateFlag.validateOnly, '--validate має перемикати режим валідації');
  assert.ok(
    !optsValidateFlag.configSourceProvided,
    'Без конфігів не має встановлюватися прапорець джерела'
  );

  resetOptions();
  assert.ok(
    parseArgs(['--config-schema']),
    'Прапорець --config-schema має зчитуватися без помилок'
  );
  const optsSchemaFlag = getOptions();
  assert.ok(
    optsSchemaFlag.schemaRequested,
    '--config-schema має позначати необхідність виводу схеми'
  );
  assert.ok(
    !optsSchemaFlag.validateOnly,
    '--config-schema не повинен вмикати валідацію автоматично'
  );

  // Тест clean у режимі dry-run
  resetOptions();
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
  const tmpFile = path.join(tmp2, 'c.txt');
  fs.writeFileSync(tmpFile, 'data');
  const nestedDir = path.join(tmp2, 'nested');
  fs.mkdirSync(nestedDir);
  const nestedFile = path.join(nestedDir, 'd.txt');
  fs.writeFileSync(nestedFile, 'd');
  assert.ok(
    parseArgs(['--dry-run', '--summary']),
    'Аргументи dry-run і summary мають зчитуватися без помилок'
  );
  const dryMetrics = await clean({ targets: [tmp2] });
  assert.ok(fs.existsSync(tmpFile), 'Файл не повинен бути видалений у dry-run');
  assert.ok(fs.existsSync(nestedFile), 'Вкладений файл не повинен бути видалений у dry-run');
  assert.strictEqual(dryMetrics.files, 2, 'Повинно враховуватися два файли у dry-run');
  assert.strictEqual(dryMetrics.dirs, 1, 'Повинна враховуватися одна директорія у dry-run');
  fs.rmSync(tmp2, { recursive: true, force: true });

  // Тест max-age та exclude
  resetOptions();
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
  const oldFile = path.join(tmp3, 'old.txt');
  fs.writeFileSync(oldFile, 'старі дані');
  const threeDaysAgoSeconds = (Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000;
  fs.utimesSync(oldFile, threeDaysAgoSeconds, threeDaysAgoSeconds);
  const newFile = path.join(tmp3, 'new.txt');
  fs.writeFileSync(newFile, 'свіжі дані');
  const protectedDir = path.join(tmp3, 'keep');
  fs.mkdirSync(protectedDir);
  const protectedFile = path.join(protectedDir, 'secret.txt');
  fs.writeFileSync(protectedFile, 'не чіпати');
  assert.ok(
    parseArgs(['--max-age', '2d', '--exclude', protectedDir]),
    'max-age та exclude мають застосовуватися без помилок'
  );
  const resultMetrics = await clean({ targets: [tmp3] });
  assert.ok(!fs.existsSync(oldFile), 'Старий файл має бути видалений');
  assert.ok(fs.existsSync(newFile), 'Новий файл має бути збережений через max-age');
  assert.ok(fs.existsSync(protectedFile), 'Файл у виключеній директорії має залишитися');
  assert.ok(resultMetrics.files >= 1, 'Повинен бути щонайменше один видалений файл');
  assert.ok(resultMetrics.skipped >= 2, 'Повинні бути пропуски через max-age та exclude');
  fs.rmSync(tmp3, { recursive: true, force: true });

  // Тест YAML-конфігурації з пресетами
  resetOptions();
  const presetTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-preset-'));
  const sharedPreset = path.join(presetTmp, 'shared.yaml');
  fs.writeFileSync(
    sharedPreset,
    ['dirs:', '  - ./cache', 'exclude:', '  - ./cache/tmp', 'summary: true'].join('\n')
  );
  const mainPreset = path.join(presetTmp, 'main.json');
  fs.writeFileSync(
    mainPreset,
    JSON.stringify({
      presets: ['shared.yaml'],
      dirs: ['./logs'],
      dryRun: true,
      maxAge: '2h',
      concurrency: 2,
      logFile: './run.log',
      preview: true
    })
  );
  assert.ok(
    parseArgs(['--config', mainPreset]),
    'Комбінована конфігурація має застосовуватися без помилок'
  );
  const optsFromPreset = getOptions();
  assert.ok(optsFromPreset.dryRun, 'dry-run з пресету має бути увімкнено');
  assert.ok(optsFromPreset.summary, 'summary із вкладеного пресету має бути увімкнено');
  assert.strictEqual(
    optsFromPreset.maxAgeMs,
    2 * 60 * 60 * 1000,
    'maxAge з YAML має бути сконвертовано у мілісекунди'
  );
  assert.strictEqual(
    optsFromPreset.concurrency,
    2,
    'concurrency має застосовуватися з конфігурації'
  );
  assert.ok(optsFromPreset.parallel, 'parallel має активуватися автоматично при concurrency > 1');
  assert.ok(
    optsFromPreset.extraDirs.includes(path.resolve(presetTmp, 'cache')),
    'Директорія з вкладеного пресету має бути додана'
  );
  assert.ok(
    optsFromPreset.extraDirs.includes(path.resolve(presetTmp, 'logs')),
    'Додаткова директорія з основного пресету має бути додана'
  );
  assert.ok(
    optsFromPreset.exclusions.includes(path.resolve(presetTmp, 'cache', 'tmp')),
    'Виключення з пресету має бути застосоване'
  );
  assert.strictEqual(
    optsFromPreset.logFile,
    path.resolve(presetTmp, 'run.log'),
    'logFile має бути нормалізовано відносно конфігурації'
  );
  assert.ok(optsFromPreset.interactivePreview, 'Режим preview має активуватися через конфігурацію');
  resetOptions();
  fs.rmSync(presetTmp, { recursive: true, force: true });

  // Тест прапорця --preset з пошуком у каталозі presets
  resetOptions();
  const repoPresetDir = path.join(process.cwd(), 'presets');
  fs.mkdirSync(repoPresetDir, { recursive: true });
  const repoPresetFile = path.join(repoPresetDir, 'ci.yaml');
  fs.writeFileSync(repoPresetFile, ['dryRun: true', 'parallel: true'].join('\n'));
  assert.ok(
    parseArgs(['--preset', 'ci']),
    'Пресет за назвою має бути знайдений у каталозі presets'
  );
  const optsFromNamedPreset = getOptions();
  assert.ok(optsFromNamedPreset.dryRun, 'dryRun з пресету має бути увімкнено');
  assert.ok(optsFromNamedPreset.parallel, 'parallel з пресету має бути увімкнено');
  resetOptions();
  fs.rmSync(repoPresetFile, { force: true });
  try {
    fs.rmdirSync(repoPresetDir);
  } catch (err) {
    if (err && err.code !== 'ENOTEMPTY' && err.code !== 'EBUSY') {
      throw err;
    }
  }

  // Тест каталогу з кількома конфігураціями
  resetOptions();
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-bundle-'));
  const baseConfig = path.join(bundleDir, '10-base.yaml');
  fs.writeFileSync(
    baseConfig,
    ['dryRun: true', 'summary: true', 'dirs:', '  - ./cache'].join('\n')
  );
  const overrideConfig = path.join(bundleDir, '20-override.json');
  fs.writeFileSync(
    overrideConfig,
    JSON.stringify({
      parallel: true,
      dryRun: false,
      dirs: ['./logs']
    })
  );
  fs.mkdirSync(path.join(bundleDir, 'cache'), { recursive: true });
  fs.mkdirSync(path.join(bundleDir, 'logs'), { recursive: true });
  assert.ok(
    parseArgs(['--config', bundleDir]),
    'Каталог конфігурацій має застосовуватися як пакет'
  );
  const optsFromBundle = getOptions();
  assert.ok(optsFromBundle.summary, 'summary має залишатися з базового конфігу');
  assert.ok(optsFromBundle.parallel, 'parallel має застосовуватися з другого конфігу');
  assert.ok(!optsFromBundle.dryRun, 'dryRun має бути перевизначено останнім файлом');
  assert.ok(
    optsFromBundle.extraDirs.includes(path.resolve(bundleDir, 'cache')),
    'Директорія cache має бути додана з базового конфігу'
  );
  assert.ok(
    optsFromBundle.extraDirs.includes(path.resolve(bundleDir, 'logs')),
    'Директорія logs має бути додана з другого конфігу'
  );
  resetOptions();
  fs.rmSync(bundleDir, { recursive: true, force: true });

  // Тест помилки в одному з файлів каталогу
  resetOptions();
  const badBundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-bundle-bad-'));
  const badBundleConfig = path.join(badBundleDir, '01-bad.yaml');
  fs.writeFileSync(badBundleConfig, 'summary: "так"\n');
  const goodBundleConfig = path.join(badBundleDir, '02-good.json');
  fs.writeFileSync(goodBundleConfig, JSON.stringify({ dryRun: true }));
  assert.ok(
    !parseArgs(['--config', badBundleDir]),
    'Помилки всередині каталогу мають зупиняти застосування всього пакету'
  );
  const optsAfterBadBundle = getOptions();
  assert.ok(!optsAfterBadBundle.dryRun, 'Опції не мають змінюватися при помилці пакету');
  resetOptions();
  fs.rmSync(badBundleDir, { recursive: true, force: true });

  // Тест каталогу без підтримуваних файлів
  resetOptions();
  const emptyBundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-bundle-empty-'));
  fs.writeFileSync(path.join(emptyBundleDir, 'ignore.txt'), 'просто текст');
  assert.ok(
    !parseArgs(['--config', emptyBundleDir]),
    'Каталог без JSON/YAML файлів має повертати помилку'
  );
  const optsAfterEmptyBundle = getOptions();
  assert.strictEqual(
    optsAfterEmptyBundle.extraDirs.length,
    0,
    'Опції не мають змінюватися після порожнього каталогу'
  );
  resetOptions();
  fs.rmSync(emptyBundleDir, { recursive: true, force: true });

  // Тест валідації конфігурації
  resetOptions();
  const badConfig = path.join(os.tmpdir(), 'db-bad.yaml');
  fs.writeFileSync(badConfig, 'dirs: 123\n');
  assert.ok(
    !parseArgs(['--config', badConfig]),
    'Помилкова конфігурація має сигналізувати про помилку'
  );
  const optsAfterBad = getOptions();
  assert.strictEqual(
    optsAfterBad.extraDirs.length,
    0,
    'Налаштування не мають змінюватися після помилки конфігурації'
  );
  fs.rmSync(badConfig, { force: true });

  // Тест режиму попереднього перегляду (відмова)
  resetOptions();
  const previewSkipDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-preview-skip-'));
  const previewSkipFile = path.join(previewSkipDir, 'skip.txt');
  fs.writeFileSync(previewSkipFile, 'skip');
  setPreviewPromptHandler(() => false);
  assert.ok(parseArgs(['--preview']), 'Режим preview має зчитуватися без помилок');
  const skipMetrics = await clean({ targets: [previewSkipDir] });
  assert.ok(fs.existsSync(previewSkipFile), 'Файл має залишитися після відмови від очищення');
  assert.strictEqual(skipMetrics.files, 0, 'Метрики не мають враховувати видалень при відмові');
  resetOptions();
  fs.rmSync(previewSkipDir, { recursive: true, force: true });

  // Тест режиму попереднього перегляду (підтвердження)
  resetOptions();
  const previewConfirmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-preview-confirm-'));
  const previewConfirmFile = path.join(previewConfirmDir, 'confirm.txt');
  fs.writeFileSync(previewConfirmFile, 'confirm');
  setPreviewPromptHandler(() => true);
  assert.ok(parseArgs(['--preview']), 'Режим preview має успішно вмикатися');
  const confirmMetrics = await clean({ targets: [previewConfirmDir] });
  assert.ok(!fs.existsSync(previewConfirmFile), 'Файл має бути видалений після підтвердження');
  assert.strictEqual(confirmMetrics.files, 1, 'Повинен бути видалений один файл');
  resetOptions();
  fs.rmSync(previewConfirmDir, { recursive: true, force: true });

  // Негативні сценарії parseArgs (відсутні значення)
  resetOptions();
  assert.ok(!parseArgs(['--log']), 'Прапорець --log без значення має спричиняти помилку');
  resetOptions();
  assert.ok(!parseArgs(['--dir']), 'Прапорець --dir без шляху має повертати помилку');
  resetOptions();
  assert.ok(!parseArgs(['--exclude']), 'Прапорець --exclude без шляху має повертати помилку');
  resetOptions();
  assert.ok(!parseArgs(['--max-age']), 'Прапорець --max-age без значення має повертати помилку');
  resetOptions();
  assert.ok(
    !parseArgs(['--concurrency']),
    'Прапорець --concurrency без числа має повертати помилку'
  );
  resetOptions();
  assert.ok(!parseArgs(['--config']), 'Прапорець --config без шляху має повертати помилку');
  resetOptions();
  assert.ok(!parseArgs(['--preset']), 'Прапорець --preset без аргументу має повертати помилку');
  resetOptions();
  assert.ok(
    !parseArgs(['--preset', './неіснуючий-пресет.yaml']),
    'Помилковий шлях пресету має спричиняти помилку'
  );

  resetOptions();
  const originalStatSync = fs.statSync;
  try {
    fs.statSync = () => ({
      isDirectory: () => false,
      isFile: () => false
    });
    assert.ok(
      !parseArgs(['--config', 'фіктивний-шлях']),
      'Непідтримуваний тип шляху має відхиляти конфіг'
    );
  } finally {
    fs.statSync = originalStatSync;
  }

  resetOptions();
  const originalReaddirSync = fs.readdirSync;
  try {
    fs.readdirSync = () => {
      throw new Error('readdir-fail');
    };
    assert.ok(
      !parseArgs(['--config', os.tmpdir()]),
      'Помилка читання каталогу має переривати застосування'
    );
  } finally {
    fs.readdirSync = originalReaddirSync;
  }

  resetOptions();
  const invalidConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-invalid-config-'));
  const invalidConfigFile = path.join(invalidConfigDir, 'bad.json');
  fs.writeFileSync(invalidConfigFile, JSON.stringify({ concurrency: 'bad' }));
  assert.ok(
    !parseArgs(['--config', invalidConfigFile]),
    'Хибне значення concurrency в конфігу має спричиняти помилку'
  );
  resetOptions();
  fs.rmSync(invalidConfigDir, { recursive: true, force: true });

  resetOptions();
  const arrayConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-array-config-'));
  const arrayConfigFile = path.join(arrayConfigDir, 'array.json');
  fs.writeFileSync(arrayConfigFile, JSON.stringify([]));
  assert.ok(
    !parseArgs(['--config', arrayConfigFile]),
    'Конфігурація з масивом має відхилятися як некоректна'
  );
  resetOptions();
  fs.rmSync(arrayConfigDir, { recursive: true, force: true });

  resetOptions();
  const nullConcurrencyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-null-concurrency-'));
  const nullConcurrencyFile = path.join(nullConcurrencyDir, 'null.json');
  fs.writeFileSync(nullConcurrencyFile, JSON.stringify({ concurrency: null }));
  assert.ok(parseArgs(['--config', nullConcurrencyFile]), 'concurrency=null має скидати обмеження');
  const optsNullConcurrency = getOptions();
  assert.strictEqual(
    optsNullConcurrency.concurrency,
    null,
    'concurrency має встановлюватися у null'
  );
  resetOptions();
  fs.rmSync(nullConcurrencyDir, { recursive: true, force: true });

  // Некоректні значення max-age та concurrency
  resetOptions();
  assert.ok(!parseArgs(['--max-age', 'abc']), 'Неправильний формат max-age має відхилятися');
  const optsAfterBadMaxAge = getOptions();
  assert.strictEqual(
    optsAfterBadMaxAge.maxAgeMs,
    null,
    'maxAgeMs не має змінюватися після помилки'
  );

  resetOptions();
  assert.ok(!parseArgs(['--concurrency', '0']), 'Нульове значення concurrency має відхилятися');
  const optsAfterZeroConcurrency = getOptions();
  assert.strictEqual(
    optsAfterZeroConcurrency.concurrency,
    null,
    'concurrency не змінюється після нуля'
  );

  resetOptions();
  assert.ok(!parseArgs(['--concurrency', 'abc']), 'Нечислове значення concurrency має відхилятися');
  const optsAfterFractionConcurrency = getOptions();
  assert.strictEqual(
    optsAfterFractionConcurrency.concurrency,
    null,
    'concurrency не встановлюється рядком'
  );

  resetOptions();
  const fractionalConfigPath = path.join(os.tmpdir(), 'db-config-fractional.json');
  fs.writeFileSync(fractionalConfigPath, JSON.stringify({ concurrency: 2.5 }));
  assert.ok(
    !parseArgs(['--config', fractionalConfigPath]),
    'Дробове значення concurrency у конфігурації має відхилятися'
  );
  const optsAfterFractionConfig = getOptions();
  assert.strictEqual(
    optsAfterFractionConfig.concurrency,
    null,
    'concurrency не встановлюється дробовим значенням із конфігу'
  );
  fs.unlinkSync(fractionalConfigPath);

  // Конкурентне очищення для перевірки runWithLimit та formatBytes
  resetOptions();
  const parallelDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'db-parallel-A-'));
  const parallelDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'db-parallel-B-'));
  const parallelDirC = fs.mkdtempSync(path.join(os.tmpdir(), 'db-parallel-C-'));
  const heavyFile = path.join(parallelDirA, 'heavy.bin');
  fs.writeFileSync(heavyFile, 'a'.repeat(2048));
  const parallelNestedDir = path.join(parallelDirA, 'nested');
  fs.mkdirSync(parallelNestedDir);
  fs.writeFileSync(path.join(parallelNestedDir, 'inner.log'), 'data');
  fs.writeFileSync(path.join(parallelDirB, 'light.txt'), 'temp');
  fs.writeFileSync(path.join(parallelDirC, 'extra.txt'), 'cache');
  assert.ok(
    parseArgs(['--concurrency', '2', '--summary']),
    'Конкурентний режим має вмикатися без помилок'
  );
  const parallelMetrics = await clean({ targets: [parallelDirA, parallelDirB, parallelDirC] });
  const { targetSummaries } = parallelMetrics;
  assert.ok(
    parallelMetrics.files >= 4,
    'Очікується принаймні чотири видалені файли з трьох каталогів'
  );
  assert.ok(parallelMetrics.dirs >= 1, 'Повинна бути врахована принаймні одна піддиректорія');
  assert.strictEqual(parallelMetrics.errors, 0, 'Очищення має проходити без помилок');
  assert.ok(parallelMetrics.bytes >= 2048, 'Звільнений обсяг має враховувати великий файл');
  assert.ok(
    typeof parallelMetrics.durationMs === 'number' && parallelMetrics.durationMs >= 0,
    'Підсумкові метрики мають містити тривалість виконання'
  );
  assert.ok(
    Array.isArray(targetSummaries) && targetSummaries.length === 3,
    'Підсумок має містити інформацію для кожної цілі'
  );
  const heavyEntry = targetSummaries.find((entry) => entry.path === path.resolve(parallelDirA));
  assert.ok(heavyEntry, 'У підсумку має бути запис для каталогу з великим файлом');
  assert.ok(heavyEntry.bytes >= 2048, 'Запис каталогу має містити правильний обсяг');
  assert.ok(
    typeof heavyEntry.durationMs === 'number' && heavyEntry.durationMs >= 0,
    'Кожний запис каталогу має містити тривалість'
  );
  fs.rmSync(parallelDirA, { recursive: true, force: true });
  fs.rmSync(parallelDirB, { recursive: true, force: true });
  fs.rmSync(parallelDirC, { recursive: true, force: true });
  await assert.rejects(
    runWithLimit([() => Promise.resolve('ok'), () => Promise.reject(new Error('boom'))], 2),
    /boom/,
    'runWithLimit має передавати відмову задачі далі'
  );

  // Фільтрація до порожнього списку з підсумком
  resetOptions();
  const excludedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-empty-'));
  parseArgs(['--exclude', excludedDir, '--summary']);
  const emptyMetrics = await clean({ targets: [excludedDir] });
  assert.strictEqual(emptyMetrics.files, 0, 'При повному виключенні не має бути видалених файлів');
  assert.strictEqual(emptyMetrics.dirs, 0, 'Порожній список не має містити директорій');
  fs.rmSync(excludedDir, { recursive: true, force: true });

  // Попередження про недостатні права доступу в підсумку
  resetOptions();
  const deniedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-denied-'));
  const deniedFile = path.join(deniedDir, 'denied.txt');
  fs.writeFileSync(deniedFile, 'sensitive');
  assert.ok(parseArgs(['--summary']), 'Прапорець summary має застосовуватися без помилок');
  const originalRmDenied = fs.promises.rm;
  const summaryLogs = [];
  const originalConsoleLog = console.log;
  try {
    fs.promises.rm = async (target, options) => {
      if (path.resolve(target) === path.resolve(deniedFile)) {
        const err = new Error('недостатньо прав');
        err.code = 'EACCES';
        throw err;
      }
      return originalRmDenied(target, options);
    };
    console.log = (msg) => {
      summaryLogs.push(msg);
    };
    const deniedMetrics = await clean({ targets: [deniedDir] });
    assert.ok(
      deniedMetrics.permissionDenied.some((entry) => entry === path.resolve(deniedFile)),
      'Шлях із недостатніми правами має бути зафіксований у метриках'
    );
    assert.ok(
      summaryLogs.some((msg) => msg.includes('[warning] Пропущено через права доступу')),
      'Підсумок має містити попередження про права доступу'
    );
  } finally {
    console.log = originalConsoleLog;
    fs.promises.rm = originalRmDenied;
    resetOptions();
    fs.rmSync(deniedDir, { recursive: true, force: true });
  }

  // macOS гілка з імітованим домашнім каталогом
  resetOptions();
  const originalHomedir = os.homedir;
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'db-mac-home-'));
  const macPaths = [
    path.join(fakeHome, 'Library', 'Caches'),
    path.join(fakeHome, 'Library', 'Logs'),
    path.join(fakeHome, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cache'),
    path.join(fakeHome, 'Library', 'Application Support', 'Code', 'Cache'),
    path.join(fakeHome, 'Library', 'Application Support', 'Microsoft Edge', 'Default', 'Cache')
  ];
  macPaths.forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'mac');
  });
  const originalExistsSync = fs.existsSync;
  const allowedMacPaths = new Set(macPaths.map((dir) => path.resolve(dir)));
  try {
    fs.existsSync = (target) => allowedMacPaths.has(path.resolve(target));
    os.homedir = () => fakeHome;
    setPlatformOverride('darwin');
    assert.ok(parseArgs(['--dry-run']), 'dry-run має застосовуватися для macOS гілки');
    const macMetrics = await clean();
    assert.strictEqual(macMetrics.errors, 0, 'macOS гілка не має спричиняти помилок');
  } finally {
    setPlatformOverride(null);
    fs.existsSync = originalExistsSync;
    os.homedir = originalHomedir;
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }

  // Linux/Unix гілка з кастомним домашнім каталогом
  resetOptions();
  const originalHomedirLinux = os.homedir;
  const fakeLinuxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'db-linux-home-'));
  const linuxPaths = [
    path.join(fakeLinuxHome, '.cache'),
    path.join(fakeLinuxHome, '.cache', 'npm'),
    path.join(fakeLinuxHome, '.cache', 'yarn'),
    path.join(fakeLinuxHome, '.cache', 'pip'),
    path.join(fakeLinuxHome, '.cache', 'google-chrome'),
    path.join(fakeLinuxHome, '.cache', 'chromium'),
    path.join(fakeLinuxHome, '.cache', 'Code', 'Cache'),
    path.join(fakeLinuxHome, '.npm')
  ];
  linuxPaths.forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'linux');
  });
  const originalExistsLinux = fs.existsSync;
  const allowedLinuxPaths = new Set(linuxPaths.map((dir) => path.resolve(dir)));
  try {
    fs.existsSync = (target) => allowedLinuxPaths.has(path.resolve(target));
    os.homedir = () => fakeLinuxHome;
    setPlatformOverride('linux');
    assert.ok(parseArgs(['--dry-run', '--parallel']), 'parallel має вмикатися у Linux гілці');
    const linuxMetrics = await clean();
    assert.strictEqual(linuxMetrics.errors, 0, 'Linux гілка має працювати без помилок');
  } finally {
    setPlatformOverride(null);
    fs.existsSync = originalExistsLinux;
    os.homedir = originalHomedirLinux;
    fs.rmSync(fakeLinuxHome, { recursive: true, force: true });
  }

  // Windows гілка без кастомних таргетів
  resetOptions();
  const winEnvBackup = {
    WINDIR: process.env.WINDIR,
    SystemDrive: process.env.SystemDrive,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    APPDATA: process.env.APPDATA
  };
  const winRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'db-win-root-'));
  process.env.WINDIR = path.join(winRoot, 'Windows');
  process.env.SystemDrive = winRoot;
  process.env.LOCALAPPDATA = path.join(winRoot, 'Local');
  process.env.APPDATA = path.join(winRoot, 'Roaming');
  const winPaths = [
    path.join(process.env.WINDIR, 'Temp'),
    path.join(process.env.WINDIR, 'Prefetch'),
    path.join(process.env.WINDIR, 'SoftwareDistribution', 'Download'),
    path.join(process.env.WINDIR, 'System32', 'LogFiles'),
    path.join(process.env.SystemDrive, 'Temp'),
    path.join(process.env.SystemDrive, '$Recycle.Bin'),
    path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'INetCache'),
    path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
    path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
    path.join(process.env.LOCALAPPDATA, 'CrashDumps'),
    path.join(process.env.APPDATA, 'npm-cache')
  ];
  winPaths.forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'win');
  });
  const originalExistsWin = fs.existsSync;
  const allowedWinPaths = new Set(winPaths.map((dir) => path.resolve(dir)));
  try {
    fs.existsSync = (target) => allowedWinPaths.has(path.resolve(target));
    setPlatformOverride('win32');
    assert.ok(parseArgs(['--dry-run']), 'dry-run має працювати у Windows гілці');
    const winMetrics = await clean();
    assert.strictEqual(winMetrics.errors, 0, 'Windows гілка не повинна створювати помилки');
  } finally {
    setPlatformOverride(null);
    fs.existsSync = originalExistsWin;
    fs.rmSync(winRoot, { recursive: true, force: true });
    process.env.WINDIR = winEnvBackup.WINDIR;
    process.env.SystemDrive = winEnvBackup.SystemDrive;
    process.env.LOCALAPPDATA = winEnvBackup.LOCALAPPDATA;
    process.env.APPDATA = winEnvBackup.APPDATA;
  }

  // Помилка fs.promises.rm у removeDirContents
  resetOptions();
  const errorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-rm-error-'));
  fs.writeFileSync(path.join(errorDir, 'file.txt'), 'data');
  const originalRm = fs.promises.rm;
  try {
    fs.promises.rm = async () => {
      throw new Error('rm-failed');
    };
    const metricsAfterError = await clean({ targets: [errorDir] });
    assert.ok(metricsAfterError.errors >= 1, 'Помилка видалення має збільшувати лічильник помилок');
  } finally {
    fs.promises.rm = originalRm;
    fs.rmSync(errorDir, { recursive: true, force: true });
  }

  // Помилка fs.promises.lstat у removeDirContents
  resetOptions();
  const lstatDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-lstat-error-'));
  const lstatFile = path.join(lstatDir, 'entry.txt');
  fs.writeFileSync(lstatFile, 'data');
  const originalLstat = fs.promises.lstat;
  try {
    let failNextLstat = true;
    fs.promises.lstat = async (target) => {
      if (failNextLstat && target.endsWith('entry.txt')) {
        failNextLstat = false;
        throw new Error('lstat-failed');
      }
      return originalLstat(target);
    };
    const metricsAfterLstatError = await clean({ targets: [lstatDir] });
    assert.ok(
      metricsAfterLstatError.errors >= 1,
      'Помилка lstat має збільшувати лічильник помилок'
    );
  } finally {
    fs.promises.lstat = originalLstat;
    fs.rmSync(lstatDir, { recursive: true, force: true });
  }

  // Виклик deep-clean через clean під Windows
  resetOptions();
  const deepDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-deep-clean-'));
  fs.writeFileSync(path.join(deepDir, 'deep.tmp'), 'cache');
  const deepEnvBackup = {
    WINDIR: process.env.WINDIR,
    SystemDrive: process.env.SystemDrive,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    APPDATA: process.env.APPDATA
  };
  process.env.WINDIR = process.env.WINDIR || 'C:/Windows';
  process.env.SystemDrive = process.env.SystemDrive || 'C:';
  process.env.LOCALAPPDATA = process.env.LOCALAPPDATA || 'C:/Users/Test/AppData/Local';
  process.env.APPDATA = process.env.APPDATA || 'C:/Users/Test/AppData/Roaming';
  const deepCommands = [];
  const originalRmSyncDeep = fs.rmSync;
  try {
    fs.rmSync = (target, options) => {
      deepCommands.push(`rm:${target}`);
      return originalRmSyncDeep.call(fs, target, {
        recursive: true,
        force: true,
        ...(options || {})
      });
    };
    setExecSyncHandler((cmd, options = {}) => {
      deepCommands.push(cmd);
      if (cmd.startsWith('net session')) {
        return '';
      }
      if (cmd.startsWith('wevtutil.exe el')) {
        return options.encoding === 'utf8' ? 'Application\nSystem\n' : Buffer.from('Application\n');
      }
      return '';
    });
    setPlatformOverride('win32');
    assert.ok(parseArgs(['--deep', '--summary']), 'Прапорець deep має зчитуватися без помилок');
    const deepMetrics = await clean({ targets: [deepDir] });
    assert.ok(deepMetrics.files >= 1, 'Глибоке очищення має видаляти локальні файли');
    assert.ok(
      deepCommands.some((cmd) => cmd.includes('Clear-RecycleBin')),
      'При deep-clean мають виконуватися додаткові команди очищення'
    );
  } finally {
    setExecSyncHandler(null);
    setPlatformOverride(null);
    fs.rmSync = originalRmSyncDeep;
    originalRmSyncDeep.call(fs, deepDir, { recursive: true, force: true });
    process.env.WINDIR = deepEnvBackup.WINDIR;
    process.env.SystemDrive = deepEnvBackup.SystemDrive;
    process.env.LOCALAPPDATA = deepEnvBackup.LOCALAPPDATA;
    process.env.APPDATA = deepEnvBackup.APPDATA;
  }

  // advancedWindowsClean без прав адміністратора
  const commandsNoAdmin = [];
  setExecSyncHandler(null);

  try {
    setExecSyncHandler((cmd) => {
      commandsNoAdmin.push(cmd);
      if (cmd.startsWith('net session')) {
        throw new Error('відмова у доступі');
      }
      return '';
    });
    advancedWindowsClean();
    assert.strictEqual(
      commandsNoAdmin.length,
      1,
      'Без прав адміністратора має виконуватися лише перевірка net session'
    );
  } finally {
    setExecSyncHandler(null);
  }

  // advancedWindowsClean з підміненою реалізацією команд
  const commandsAdmin = [];
  const originalEnv = {
    WINDIR: process.env.WINDIR,
    SystemDrive: process.env.SystemDrive,
    LOCALAPPDATA: process.env.LOCALAPPDATA
  };
  process.env.WINDIR = process.env.WINDIR || 'C:/Windows';
  process.env.SystemDrive = process.env.SystemDrive || 'C:';
  process.env.LOCALAPPDATA = process.env.LOCALAPPDATA || 'C:/Users/Test/AppData/Local';
  const originalRmSync = fs.rmSync;
  try {
    fs.rmSync = (target) => {
      commandsAdmin.push(`rm:${target}`);
    };
    setExecSyncHandler((cmd, options = {}) => {
      commandsAdmin.push(cmd);
      if (cmd.startsWith('net session')) {
        return '';
      }
      if (cmd.startsWith('wevtutil.exe el')) {
        return options.encoding === 'utf8' ? 'Application\nSystem\n' : Buffer.from('Application\n');
      }
      return '';
    });
    advancedWindowsClean();
    assert.ok(
      commandsAdmin.some((cmd) => cmd.includes('Clear-RecycleBin')),
      'Повинна запускатися команда очищення кошика'
    );
    assert.ok(
      commandsAdmin.some((cmd) => cmd.startsWith('wevtutil.exe cl')),
      'Очікується очищення журналів подій'
    );
    assert.ok(
      commandsAdmin.some((cmd) => typeof cmd === 'string' && cmd.startsWith('rm:')),
      'Очікується спроба видалити каталог SoftwareDistribution'
    );
  } finally {
    fs.rmSync = originalRmSync;
    process.env.WINDIR = originalEnv.WINDIR;
    process.env.SystemDrive = originalEnv.SystemDrive;
    process.env.LOCALAPPDATA = originalEnv.LOCALAPPDATA;
    setExecSyncHandler(null);
  }

  // Контроль мінімальної версії Node.js
  const originalExit = process.exit;
  const originalError = console.error;
  const exitCodesVersion = [];
  const errorMessages = [];
  try {
    process.exit = (code) => {
      exitCodesVersion.push(code);
    };
    console.error = (...args) => {
      errorMessages.push(args.join(' '));
    };
    setNodeVersionOverride(10);
    runCli();
    assert.ok(
      exitCodesVersion.includes(1),
      'При застарілій версії Node.js має відбуватися вихід із кодом 1'
    );
    assert.ok(
      errorMessages.some((msg) => msg.includes('Потрібна Node.js >= ')),
      'Повідомлення про несумісну версію має виводитися у stderr'
    );
  } finally {
    setNodeVersionOverride(null);
    console.error = originalError;
    process.exit = originalExit;
  }

  // Режим --validate з коректною конфігурацією
  resetOptions();
  const validateOkConfig = path.join(os.tmpdir(), 'db-validate-ok.json');
  fs.writeFileSync(validateOkConfig, JSON.stringify({ dirs: ['./tmp'], summary: true }));
  assert.ok(
    parseArgs(['--config', validateOkConfig, '--validate']),
    '--validate з переданою конфігурацією має зчитуватися без помилок'
  );
  const exitCodesValidateOk = [];
  const logMessagesValidateOk = [];
  const errorMessagesValidateOk = [];
  const originalExitValidateOk = process.exit;
  const originalLogValidateOk = console.log;
  const originalErrorValidateOk = console.error;
  try {
    process.exit = (code) => {
      exitCodesValidateOk.push(code);
    };
    console.log = (...args) => {
      logMessagesValidateOk.push(args.join(' '));
    };
    console.error = (...args) => {
      errorMessagesValidateOk.push(args.join(' '));
    };
    setMainOverride(true);
    setNodeVersionOverride(CURRENT_NODE_MAJOR);
    setParsedOkOverride(true);
    runCli();
  } finally {
    setParsedOkOverride(null);
    setMainOverride(null);
    setNodeVersionOverride(null);
    console.error = originalErrorValidateOk;
    console.log = originalLogValidateOk;
    process.exit = originalExitValidateOk;
  }
  assert.ok(exitCodesValidateOk.includes(0), 'CLI у режимі валідації має завершуватися з кодом 0');
  assert.ok(
    logMessagesValidateOk.some((msg) => msg.includes('Конфігурації успішно пройшли перевірку.')),
    'CLI має повідомляти про успішну перевірку конфігів'
  );
  assert.strictEqual(
    errorMessagesValidateOk.length,
    0,
    'Успішна валідація не повинна виводити помилки у stderr'
  );
  resetOptions();
  fs.unlinkSync(validateOkConfig);

  // Режим --validate без переданих конфігів
  resetOptions();
  assert.ok(parseArgs(['--validate']), '--validate без конфігів має розпізнаватися');
  const exitCodesValidateMissing = [];
  const errorMessagesValidateMissing = [];
  const originalExitValidateMissing = process.exit;
  const originalErrorValidateMissing = console.error;
  const originalLogValidateMissing = console.log;
  try {
    process.exit = (code) => {
      exitCodesValidateMissing.push(code);
    };
    console.error = (...args) => {
      errorMessagesValidateMissing.push(args.join(' '));
    };
    console.log = () => {};
    setMainOverride(true);
    setNodeVersionOverride(CURRENT_NODE_MAJOR);
    setParsedOkOverride(true);
    runCli();
  } finally {
    setParsedOkOverride(null);
    setMainOverride(null);
    setNodeVersionOverride(null);
    console.error = originalErrorValidateMissing;
    console.log = originalLogValidateMissing;
    process.exit = originalExitValidateMissing;
  }
  assert.ok(exitCodesValidateMissing.includes(1), 'CLI має завершуватися з кодом 1 без конфігів');
  assert.ok(
    errorMessagesValidateMissing.some((msg) => msg.includes('Прапорець --validate вимагає')),
    'CLI має попереджати про відсутність конфігів'
  );
  resetOptions();

  // Режим --config-schema
  resetOptions();
  assert.ok(parseArgs(['--config-schema']), '--config-schema має зчитуватися без помилок');
  const exitCodesSchemaCli = [];
  const schemaOutputsCli = [];
  const originalExitSchemaCli = process.exit;
  const originalLogSchemaCli = console.log;
  try {
    process.exit = (code) => {
      exitCodesSchemaCli.push(code);
    };
    console.log = (...args) => {
      schemaOutputsCli.push(args.join(' '));
    };
    setMainOverride(true);
    setNodeVersionOverride(CURRENT_NODE_MAJOR);
    setParsedOkOverride(true);
    runCli();
  } finally {
    setParsedOkOverride(null);
    setMainOverride(null);
    setNodeVersionOverride(null);
    console.log = originalLogSchemaCli;
    process.exit = originalExitSchemaCli;
  }
  const schemaCombined = schemaOutputsCli.join('\n');
  assert.ok(exitCodesSchemaCli.includes(0), 'CLI з --config-schema має завершуватися з кодом 0');
  assert.ok(schemaCombined.includes('"$schema"'), 'JSON Schema має містити посилання на стандарт');
  assert.ok(schemaCombined.includes('"properties"'), 'JSON Schema має містити опис полів');
  resetOptions();

  // Режим --help у CLI
  resetOptions();
  parseArgs(['--help']);
  const exitCodesHelp = [];
  const originalExitHelp = process.exit;
  const originalLog = console.log;
  try {
    process.exit = (code) => {
      exitCodesHelp.push(code);
    };
    console.log = () => {};
    setMainOverride(true);
    setNodeVersionOverride(CURRENT_NODE_MAJOR);
    setParsedOkOverride(true);
    runCli();
    assert.ok(exitCodesHelp.includes(0), 'У режимі допомоги процес має завершуватися з кодом 0');
  } finally {
    setParsedOkOverride(null);
    setMainOverride(null);
    setNodeVersionOverride(null);
    process.exit = originalExitHelp;
    console.log = originalLog;
  }
  resetOptions();

  // Помилка розбору аргументів у CLI
  const exitCodesError = [];
  const originalExitError = process.exit;
  try {
    process.exit = (code) => {
      exitCodesError.push(code);
    };
    setMainOverride(true);
    setNodeVersionOverride(CURRENT_NODE_MAJOR);
    setParsedOkOverride(false);
    runCli();
    assert.ok(exitCodesError.includes(1), 'При помилці розбору CLI має завершуватися з кодом 1');
  } finally {
    setParsedOkOverride(null);
    setMainOverride(null);
    setNodeVersionOverride(null);
    process.exit = originalExitError;
  }

  // Обробка помилки виконання clean у CLI
  const exitCodesRun = [];
  const originalExitRun = process.exit;
  const originalErrorRun = console.error;
  const cliErrors = [];
  try {
    process.exit = (code) => {
      exitCodesRun.push(code);
    };
    console.error = (...args) => {
      cliErrors.push(args.join(' '));
    };
    setMainOverride(true);
    setNodeVersionOverride(CURRENT_NODE_MAJOR);
    setParsedOkOverride(true);
    setCleanOverride(() => Promise.reject(new Error('тестова помилка CLI')));
    runCli();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(exitCodesRun.length, 0, 'Помилка clean не має завершувати процес');
    assert.ok(
      cliErrors.some((msg) => msg.includes('Помилка виконання скрипту')),
      'Повідомлення про помилку clean має бути залоговано'
    );
  } finally {
    setCleanOverride(null);
    setParsedOkOverride(null);
    setMainOverride(null);
    setNodeVersionOverride(null);
    console.error = originalErrorRun;
    process.exit = originalExitRun;
  }

  console.log('Усі тести пройшли');
})();
