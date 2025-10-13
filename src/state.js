const childProcess = require('child_process');

function createDefaults() {
  return {
    dryRun: false,
    parallel: false,
    deepClean: false,
    logFile: null,
    extraDirs: [],
    summary: false,
    maxAgeMs: null,
    exclusions: [],
    concurrency: null,
    interactivePreview: false,
    previewPromptHandler: null,
    previewInterface: null,
    helpRequested: false,
    validateConfigOnly: false,
    schemaRequested: false,
    configSourceProvided: false
  };
}

const defaultExecSync = childProcess.execSync;

const state = {
  ...createDefaults(),
  execSyncHandler: defaultExecSync,
  execSyncFallback: defaultExecSync,
  platformOverride: null,
  nodeVersionOverride: null,
  mainOverride: null,
  parsedOkOverride: null,
  cleanOverride: null
};

function resetState() {
  const defaults = createDefaults();
  state.dryRun = defaults.dryRun;
  state.parallel = defaults.parallel;
  state.deepClean = defaults.deepClean;
  state.logFile = defaults.logFile;
  state.extraDirs = defaults.extraDirs;
  state.summary = defaults.summary;
  state.maxAgeMs = defaults.maxAgeMs;
  state.exclusions = defaults.exclusions;
  state.concurrency = defaults.concurrency;
  state.interactivePreview = defaults.interactivePreview;
  state.previewPromptHandler = defaults.previewPromptHandler;
  state.previewInterface = defaults.previewInterface;
  state.helpRequested = defaults.helpRequested;
  state.validateConfigOnly = defaults.validateConfigOnly;
  state.schemaRequested = defaults.schemaRequested;
  state.configSourceProvided = defaults.configSourceProvided;
  state.execSyncHandler = state.execSyncFallback;
  state.platformOverride = null;
  state.nodeVersionOverride = null;
  state.mainOverride = null;
  state.parsedOkOverride = null;
  state.cleanOverride = null;
}

function getOptions() {
  return {
    dryRun: state.dryRun,
    parallel: state.parallel,
    deepClean: state.deepClean,
    logFile: state.logFile,
    extraDirs: [...state.extraDirs],
    summary: state.summary,
    maxAgeMs: state.maxAgeMs,
    exclusions: [...state.exclusions],
    concurrency: state.concurrency,
    interactivePreview: state.interactivePreview,
    helpRequested: state.helpRequested,
    validateOnly: state.validateConfigOnly,
    schemaRequested: state.schemaRequested,
    configSourceProvided: state.configSourceProvided
  };
}

module.exports = {
  state,
  resetState,
  getOptions
};
