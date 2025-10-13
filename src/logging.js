const fs = require('fs');
const { state } = require('./state');

function log(message) {
  console.log(message);
  if (state.logFile) {
    fs.appendFileSync(state.logFile, `${message}\n`);
  }
}

module.exports = {
  log
};
