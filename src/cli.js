const { state } = require('./state');
const {
  setMaxAge,
  setConcurrency,
  addExtraDir,
  addExclusion,
  handleConfigArgument,
  handlePresetArgument,
  buildConfigSchema
} = require('./config');
const { MIN_NODE_MAJOR, currentNodeMajor, getCleanInvoker } = require('./core');

let lastParseOk = true;

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
      '  --validate            Перевірити конфігурації та пресети без очищення.',
      '  --config-schema       Вивести JSON Schema для конфігурацій.',
      '  --max-age <тривалість>Видаляти лише елементи старші за вказаний час.',
      '  --summary             Показати підсумкову статистику.',
      '  --preview             Інтерактивно підтверджувати очищення.',
      '  --log <файл>          Зберігати журнал виконання у файл.',
      '  --deep                Запускати додаткове очищення (Windows).'
    ].join('\n')
  );
}

function parseArgs(args = process.argv.slice(2)) {
  let ok = true;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--dry-run') {
      state.dryRun = true;
    } else if (a === '--parallel') {
      state.parallel = true;
    } else if (a === '--deep') {
      state.deepClean = true;
    } else if (a === '--help' || a === '-h') {
      state.helpRequested = true;
    } else if (a === '--log') {
      if (!args[i + 1]) {
        console.error('Прапорець --log вимагає шлях до файлу.');
        ok = false;
      } else {
        state.logFile = args[++i];
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
      state.summary = true;
    } else if (a === '--preview') {
      state.interactivePreview = true;
    } else if (a === '--validate') {
      state.validateConfigOnly = true;
    } else if (a === '--config-schema') {
      state.schemaRequested = true;
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
      } else {
        state.configSourceProvided = true;
      }
    } else if (a === '--preset') {
      if (!args[i + 1]) {
        console.error('Прапорець --preset вимагає назву або шлях до пресету.');
        ok = false;
      } else if (!handlePresetArgument(args[++i])) {
        ok = false;
      } else {
        state.configSourceProvided = true;
      }
    }
  }

  lastParseOk = ok;
  return ok;
}

function isParsedOk() {
  return state.parsedOkOverride !== null ? state.parsedOkOverride : lastParseOk;
}

function resetCliState() {
  lastParseOk = true;
}

function runCli({ isRunningAsMain, invokeClean }) {
  if (currentNodeMajor() < MIN_NODE_MAJOR) {
    console.error(`Потрібна Node.js >= ${MIN_NODE_MAJOR}. Поточна ${process.versions.node}`);
    process.exit(1);
    return;
  }

  if (!isRunningAsMain()) {
    return;
  }

  if (state.helpRequested) {
    printHelp();
    process.exit(isParsedOk() ? 0 : 1);
    return;
  }

  if (!isParsedOk()) {
    process.exit(1);
    return;
  }

  if (state.schemaRequested) {
    console.log(JSON.stringify(buildConfigSchema(), null, 2));
    process.exit(0);
    return;
  }

  if (state.validateConfigOnly) {
    if (!state.configSourceProvided) {
      console.error('Прапорець --validate вимагає принаймні один --config або --preset.');
      process.exit(1);
      return;
    }
    console.log('Конфігурації успішно пройшли перевірку.');
    process.exit(0);
    return;
  }

  Promise.resolve(invokeClean()).catch((err) => {
    console.error('Помилка виконання скрипту:', err);
  });
}

function invokeDefaultClean() {
  const handler = getCleanInvoker();
  return handler();
}

module.exports = {
  parseArgs,
  runCli,
  isParsedOk,
  printHelp,
  resetCliState,
  invokeDefaultClean
};
