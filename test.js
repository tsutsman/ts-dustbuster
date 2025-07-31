const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pushIfExists, removeDirContents, parseArgs, getOptions } = require('./cleaner');

(async () => {
  // Тест pushIfExists
  // Test for pushIfExists
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
  const list = [];
  pushIfExists(list, tmp);
  assert.strictEqual(list.length, 1, 'Каталог повинен додатися');
  pushIfExists(list, path.join(tmp, 'неіснуючий'));
  assert.strictEqual(list.length, 1, 'Неіснуючий каталог не додається');

  // Тест removeDirContents
  // Test for removeDirContents
  const file = path.join(tmp, 'a.txt');
  fs.writeFileSync(file, 'data');
  const sub = path.join(tmp, 'sub');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'b.txt'), 'data');
  await removeDirContents(tmp);
  const entries = fs.readdirSync(tmp);
  assert.strictEqual(entries.length, 0, 'Каталог має бути порожнім');
  fs.rmdirSync(tmp);

  // Тест parseArgs
  // Test for parseArgs
  parseArgs(['--dry-run', '--parallel', '--deep']);
  const opts = getOptions();
  assert.ok(opts.dryRun, 'dry-run має бути увімкнено');
  assert.ok(opts.parallel, 'parallel має бути увімкнено');
  assert.ok(opts.deepClean, 'deep має бути увімкнено');
  console.log('Усі тести пройшли');
})();
