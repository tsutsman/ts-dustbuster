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
  setPreviewPromptHandler
} = require('./cleaner');

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
  assert.strictEqual(metricsAfterRemove.files, 2, 'Має бути видалено два файли (включно з вкладеними)');
  assert.strictEqual(metricsAfterRemove.dirs, 1, 'Має бути видалено одну піддиректорію');
  fs.rmdirSync(tmp);

  // Тест parseArgs
  resetOptions();
  const excludeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-exclude-'));
  assert.ok(
    parseArgs(['--dry-run', '--parallel', '--deep', '--summary', '--max-age', '2d', '--exclude', excludeDir, '--log', 'out.log']),
    'Аргументи командного рядка мають оброблятися без помилок'
  );
  const opts = getOptions();
  assert.ok(opts.dryRun, 'dry-run має бути увімкнено');
  assert.ok(opts.parallel, 'parallel має бути увімкнено');
  assert.ok(opts.deepClean, 'deep має бути увімкнено');
  assert.ok(opts.summary, 'summary має бути увімкнено');
  assert.strictEqual(opts.maxAgeMs, 2 * 24 * 60 * 60 * 1000, 'maxAge має відповідати 2 дням');
  assert.ok(opts.exclusions.includes(path.resolve(excludeDir)), 'Шлях має бути у переліку виключень');
  assert.strictEqual(opts.logFile, 'out.log', 'Шлях до лог-файлу зберігається як передано');
  resetOptions();
  fs.rmSync(excludeDir, { recursive: true, force: true });

  // Тест --help
  resetOptions();
  assert.ok(parseArgs(['--help']), 'Прапорець --help має зчитуватися без помилок');
  const optsHelp = getOptions();
  assert.ok(optsHelp.helpRequested, 'Опція help має позначати необхідність показу довідки');

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
  assert.ok(!optsConcurrencyOne.parallel, 'parallel не має активуватися при concurrency = 1 без прапорця parallel');

  resetOptions();
  const cfgPath = path.join(os.tmpdir(), 'db-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ concurrency: 2 }));
  assert.ok(parseArgs(['--config', cfgPath]), 'JSON-конфігурація має застосовуватися без помилок');
  const optsFromConfig = getOptions();
  assert.strictEqual(optsFromConfig.concurrency, 2, 'concurrency має зчитуватися з конфігурації');
  assert.ok(optsFromConfig.parallel, 'parallel має вмикатися, якщо concurrency > 1 у конфігурації');
  fs.unlinkSync(cfgPath);

  // Тест clean у режимі dry-run
  resetOptions();
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
  const tmpFile = path.join(tmp2, 'c.txt');
  fs.writeFileSync(tmpFile, 'data');
  const nestedDir = path.join(tmp2, 'nested');
  fs.mkdirSync(nestedDir);
  const nestedFile = path.join(nestedDir, 'd.txt');
  fs.writeFileSync(nestedFile, 'd');
  assert.ok(parseArgs(['--dry-run', '--summary']), 'Аргументи dry-run і summary мають зчитуватися без помилок');
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
  assert.ok(parseArgs(['--max-age', '2d', '--exclude', protectedDir]), 'max-age та exclude мають застосовуватися без помилок');
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
  fs.writeFileSync(sharedPreset, [
    'dirs:',
    '  - ./cache',
    'exclude:',
    '  - ./cache/tmp',
    'summary: true'
  ].join('\n'));
  const mainPreset = path.join(presetTmp, 'main.json');
  fs.writeFileSync(mainPreset, JSON.stringify({
    presets: ['shared.yaml'],
    dirs: ['./logs'],
    dryRun: true,
    maxAge: '2h',
    concurrency: 2,
    logFile: './run.log',
    preview: true
  }));
  assert.ok(parseArgs(['--config', mainPreset]), 'Комбінована конфігурація має застосовуватися без помилок');
  const optsFromPreset = getOptions();
  assert.ok(optsFromPreset.dryRun, 'dry-run з пресету має бути увімкнено');
  assert.ok(optsFromPreset.summary, 'summary із вкладеного пресету має бути увімкнено');
  assert.strictEqual(optsFromPreset.maxAgeMs, 2 * 60 * 60 * 1000, 'maxAge з YAML має бути сконвертовано у мілісекунди');
  assert.strictEqual(optsFromPreset.concurrency, 2, 'concurrency має застосовуватися з конфігурації');
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
  assert.ok(parseArgs(['--preset', 'ci']), 'Пресет за назвою має бути знайдений у каталозі presets');
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
  fs.writeFileSync(baseConfig, [
    'dryRun: true',
    'summary: true',
    'dirs:',
    '  - ./cache'
  ].join('\n'));
  const overrideConfig = path.join(bundleDir, '20-override.json');
  fs.writeFileSync(overrideConfig, JSON.stringify({
    parallel: true,
    dryRun: false,
    dirs: ['./logs']
  }));
  fs.mkdirSync(path.join(bundleDir, 'cache'), { recursive: true });
  fs.mkdirSync(path.join(bundleDir, 'logs'), { recursive: true });
  assert.ok(parseArgs(['--config', bundleDir]), 'Каталог конфігурацій має застосовуватися як пакет');
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
  assert.strictEqual(optsAfterEmptyBundle.extraDirs.length, 0, 'Опції не мають змінюватися після порожнього каталогу');
  resetOptions();
  fs.rmSync(emptyBundleDir, { recursive: true, force: true });

  // Тест валідації конфігурації
  resetOptions();
  const badConfig = path.join(os.tmpdir(), 'db-bad.yaml');
  fs.writeFileSync(badConfig, 'dirs: 123\n');
  assert.ok(!parseArgs(['--config', badConfig]), 'Помилкова конфігурація має сигналізувати про помилку');
  const optsAfterBad = getOptions();
  assert.strictEqual(optsAfterBad.extraDirs.length, 0, 'Налаштування не мають змінюватися після помилки конфігурації');
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

  console.log('Усі тести пройшли');
})();
