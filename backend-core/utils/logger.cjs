function logInfo(...args) {
  console.log('[bidmind]', ...args);
}

function logError(...args) {
  console.error('[bidmind]', ...args);
}

module.exports = {
  logError,
  logInfo,
};
