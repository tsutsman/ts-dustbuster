const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pushIfExists, removeDirContents, parseArgs, getOptions, clean, resetOptions } = require('./cleaner');

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
  parseArgs(['--dry-run', '--parallel', '--deep', '--summary', '--max-age', '2d', '--exclude', excludeDir, '--log', 'out.log']);
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

  // Тест --concurrency
  resetOptions();
  parseArgs(['--concurrency', '3']);
  const optsConcurrency = getOptions();
  assert.strictEqual(optsConcurrency.concurrency, 3, 'concurrency має дорівнювати 3');
  assert.ok(optsConcurrency.parallel, 'parallel має бути активованим при concurrency > 1');

  resetOptions();
  parseArgs(['--concurrency', '1']);
  const optsConcurrencyOne = getOptions();
  assert.strictEqual(optsConcurrencyOne.concurrency, 1, 'concurrency має дорівнювати 1');
  assert.ok(!optsConcurrencyOne.parallel, 'parallel не має активуватися при concurrency = 1 без прапорця parallel');

  resetOptions();
  const cfgPath = path.join(os.tmpdir(), 'db-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ concurrency: 2 }));
  parseArgs(['--config', cfgPath]);
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
  parseArgs(['--dry-run', '--summary']);
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
  parseArgs(['--max-age', '2d', '--exclude', protectedDir]);
  const resultMetrics = await clean({ targets: [tmp3] });
  assert.ok(!fs.existsSync(oldFile), 'Старий файл має бути видалений');
  assert.ok(fs.existsSync(newFile), 'Новий файл має бути збережений через max-age');
  assert.ok(fs.existsSync(protectedFile), 'Файл у виключеній директорії має залишитися');
  assert.ok(resultMetrics.files >= 1, 'Повинен бути щонайменше один видалений файл');
  assert.ok(resultMetrics.skipped >= 2, 'Повинні бути пропуски через max-age та exclude');
  fs.rmSync(tmp3, { recursive: true, force: true });

  console.log('Усі тести пройшли');
})();
