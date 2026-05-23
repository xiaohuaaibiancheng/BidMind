const app = require('../server/index.cjs');

module.exports = (req, res) => {
  if (!req.url.startsWith('/api/')) {
    const normalized = req.url.startsWith('/') ? req.url : `/${req.url}`;
    req.url = `/api${normalized}`;
  }
  return app(req, res);
};
