const path = require('path');

function normalizePath(target) {
  return path.resolve(target);
}

function isWithin(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

module.exports = {
  normalizePath,
  isWithin
};
