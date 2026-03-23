const { state } = require('../state');
const {
  setMaxAge,
  setConcurrency,
  addExtraDir,
  addExclusion,
  handleConfigArgument,
  handlePresetArgument
} = require('../config');

let lastParseOk = true;

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
        console.error(require('../i18n').t('cli.errors.logRequiresPath'));
        ok = false;
      } else {
        state.logFile = args[++i];
      }
    } else if (a === '--dir') {
      if (!args[i + 1]) {
        console.error(require('../i18n').t('cli.errors.dirRequiresPath'));
        ok = false;
      } else {
        addExtraDir(args[++i]);
      }
    } else if (a === '--exclude') {
      if (!args[i + 1]) {
        console.error(require('../i18n').t('cli.errors.excludeRequiresPath'));
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
        console.error(require('../i18n').t('cli.errors.maxAgeRequiresValue'));
        ok = false;
      } else if (!setMaxAge(args[++i])) {
        ok = false;
      }
    } else if (a === '--concurrency') {
      if (!args[i + 1]) {
        console.error(require('../i18n').t('cli.errors.concurrencyRequiresValue'));
        ok = false;
      } else if (!setConcurrency(args[++i])) {
        ok = false;
      }
    } else if (a === '--config') {
      if (!args[i + 1]) {
        console.error(require('../i18n').t('cli.errors.configRequiresPath'));
        ok = false;
      } else if (!handleConfigArgument(args[++i])) {
        ok = false;
      } else {
        state.configSourceProvided = true;
      }
    } else if (a === '--preset') {
      if (!args[i + 1]) {
        console.error(require('../i18n').t('cli.errors.presetRequiresValue'));
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

function resetParserState() {
  lastParseOk = true;
}

module.exports = {
  parseArgs,
  isParsedOk,
  resetParserState
};
