const path = require('node:path');

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDriver(value, supported, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return supported.has(normalized) ? normalized : fallback;
}

function createRuntimeConfig() {
  const defaultDataRoot = process.env.VERCEL
    ? path.join('/tmp', 'bidmind-web-data')
    : path.join(process.cwd(), '.web-data');

  const dataRoot = path.resolve(process.env.BIDMIND_DATA_ROOT || defaultDataRoot);
  const mysqlEnabled = parseBoolean(process.env.BIDMIND_MYSQL_ENABLED, false);
  const redisEnabled = parseBoolean(process.env.BIDMIND_REDIS_ENABLED, false);
  const minioEnabled = parseBoolean(process.env.BIDMIND_MINIO_ENABLED, false);

  const preferredAuthDriver = normalizeDriver(process.env.BIDMIND_AUTH_DRIVER, new Set(['local', 'mysql']), 'local');
  const preferredStateDriver = normalizeDriver(process.env.BIDMIND_STATE_DRIVER, new Set(['local', 'mysql']), 'local');
  const preferredEventDriver = normalizeDriver(process.env.BIDMIND_EVENT_DRIVER, new Set(['local', 'redis']), 'local');
  const preferredBlobDriver = normalizeDriver(process.env.BIDMIND_BLOB_DRIVER, new Set(['local', 'minio']), 'local');

  return {
    app: {
      dataRoot,
      port: parseNumber(process.env.BIDMIND_WEB_API_PORT || process.env.YIBIAO_WEB_API_PORT, 8788),
    },
    drivers: {
      auth: preferredAuthDriver === 'mysql' && mysqlEnabled ? 'mysql' : 'local',
      state: preferredStateDriver === 'mysql' && mysqlEnabled ? 'mysql' : 'local',
      events: preferredEventDriver === 'redis' && redisEnabled ? 'redis' : 'local',
      blob: preferredBlobDriver === 'minio' && minioEnabled ? 'minio' : 'local',
    },
    mysql: {
      enabled: mysqlEnabled,
      host: process.env.BIDMIND_MYSQL_HOST || '127.0.0.1',
      port: parseNumber(process.env.BIDMIND_MYSQL_PORT, 3306),
      user: process.env.BIDMIND_MYSQL_USER || '',
      password: process.env.BIDMIND_MYSQL_PASSWORD || '',
      database: process.env.BIDMIND_MYSQL_DATABASE || '',
      connectionLimit: parseNumber(process.env.BIDMIND_MYSQL_POOL_SIZE, 10),
      timezone: process.env.BIDMIND_MYSQL_TIMEZONE || 'Z',
    },
    redis: {
      enabled: redisEnabled,
      url: process.env.BIDMIND_REDIS_URL || '',
      keyPrefix: process.env.BIDMIND_REDIS_PREFIX || 'bidmind:',
    },
    minio: {
      enabled: minioEnabled,
      endpoint: process.env.BIDMIND_MINIO_ENDPOINT || '127.0.0.1',
      port: parseNumber(process.env.BIDMIND_MINIO_PORT, 9000),
      useSSL: parseBoolean(process.env.BIDMIND_MINIO_USE_SSL, false),
      accessKey: process.env.BIDMIND_MINIO_ACCESS_KEY || '',
      secretKey: process.env.BIDMIND_MINIO_SECRET_KEY || '',
      bucket: process.env.BIDMIND_MINIO_BUCKET || 'bidmind',
      prefix: process.env.BIDMIND_MINIO_PREFIX || 'app',
      region: process.env.BIDMIND_MINIO_REGION || '',
    },
  };
}

module.exports = {
  createRuntimeConfig,
};
