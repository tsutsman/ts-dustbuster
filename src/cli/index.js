const { state } = require('../state');
const { buildConfigSchema } = require('../config');
const { MIN_NODE_MAJOR, currentNodeMajor, getCleanInvoker } = require('../core');
const { t } = require('../i18n');
const { parseArgs, isParsedOk, resetParserState } = require('./parser');

function printHelp() {
  console.log(t('cli.help'));
}

function runCli({ isRunningAsMain, invokeClean }) {
  if (currentNodeMajor() < MIN_NODE_MAJOR) {
    console.error(
      t('cli.errors.nodeVersion', { required: MIN_NODE_MAJOR, current: process.versions.node })
    );
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
      console.error(t('cli.errors.validateRequiresSource'));
      process.exit(1);
      return;
    }
    console.log(t('cli.messages.validationSuccess'));
    process.exit(0);
    return;
  }

  Promise.resolve(invokeClean()).catch((err) => {
    console.error(`${t('cli.errors.executionFailed')}:`, err);
  });
}

function invokeDefaultClean() {
  const handler = getCleanInvoker();
  return handler();
}

function resetCliState() {
  resetParserState();
}

module.exports = {
  parseArgs,
  runCli,
  isParsedOk,
  printHelp,
  resetCliState,
  invokeDefaultClean,
  buildConfigSchema
};
