const winston = require('winston');
const { state } = require('./state');

let fileLogger = null;

function getFileLogger() {
  if (!fileLogger && state.logFile) {
    fileLogger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      transports: [
        new winston.transports.File({
          filename: state.logFile,
          maxsize: 5 * 1024 * 1024,
          maxFiles: 5,
          tailable: true
        })
      ]
    });
  }
  return fileLogger;
}

function log(message, level = 'info') {
  // Keep console.log for backward compatibility and test capture
  console.log(message);

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

module.exports = {
  log,
  logError
};
