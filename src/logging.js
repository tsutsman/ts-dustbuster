const winston = require('winston');
const { state } = require('./state');

let fileLogger = null;

function getLogLevel() {
  const envLevel = process.env.LOG_LEVEL;
  if (envLevel && ['error', 'warn', 'info', 'debug'].includes(envLevel)) {
    return envLevel;
  }
  return 'info';
}

function getFileLogger() {
  if (!fileLogger && state.logFile) {
    fileLogger = winston.createLogger({
      level: getLogLevel(),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({
          filename: state.logFile,
          maxsize: 10 * 1024 * 1024,
          maxFiles: 10,
          tailable: true
        })
      ]
    });
  }
  return fileLogger;
}

function log(message, level = 'info') {
  const levelPrefix = level === 'warn' ? '[warn] ' : level === 'error' ? '[error] ' : '';
  if (level === 'error') {
    console.error(message);
  } else {
    console.log(levelPrefix + message);
  }

  const logger = getFileLogger();
  if (logger) {
    logger.log(level, message);
  }
}

function logError(message, error) {
  console.error(message, error);

  const logger = getFileLogger();
  if (logger) {
    logger.error(message, { error: error.message, stack: error.stack });
  }
}

function logWarn(message) {
  log(message, 'warn');
}

function logDebug(message) {
  log(message, 'debug');
}

module.exports = {
  log,
  logError,
  logWarn,
  logDebug
};
