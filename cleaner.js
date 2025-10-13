#!/usr/bin/env node
const { state, resetState, getOptions } = require('./src/state');
const {
  setExecSyncHandler,
  setPlatformOverride,
  setNodeVersionOverride,
  setMainOverride,
  setParsedOkOverride,
  setPreviewPromptHandler,
  closePreviewInterface,
  pushIfExists,
  removeDirContents,
  clean,
  setCleanOverride,
  runWithLimit,
  advancedWindowsClean
} = require('./src/core');
const {
  parseArgs,
  runCli: runCliInternal,
  resetCliState,
  invokeDefaultClean
} = require('./src/cli');

function isRunningAsMain() {
  if (typeof state.mainOverride === 'boolean') {
    return state.mainOverride;
  }
  return require.main === module;
}

function runCli() {
  runCliInternal({
    isRunningAsMain,
    invokeClean: invokeDefaultClean
  });
}

function resetOptions() {
  closePreviewInterface();
  resetState();
  resetCliState();
}

parseArgs();
runCli();

module.exports = {
  pushIfExists,
  removeDirContents,
  parseArgs,
  advancedWindowsClean,
  getOptions,
  clean,
  resetOptions,
  setPreviewPromptHandler,
  setExecSyncHandler,
  setPlatformOverride,
  setNodeVersionOverride,
  setMainOverride,
  setParsedOkOverride,
  runCli,
  setCleanOverride,
  runWithLimit
};
