let mysqlPool = null;
let mysqlModuleLoaded = false;
let redisClient = null;
let minioClient = null;

async function getMysqlPool(runtimeConfig) {
  if (mysqlPool) return mysqlPool;
  if (!runtimeConfig?.mysql?.enabled) {
    throw new Error('MySQL 未启用，请设置 BIDMIND_MYSQL_ENABLED=true');
  }

  if (!mysqlModuleLoaded) {
    mysqlModuleLoaded = true;
  }
  const mysql = require('mysql2/promise');
  mysqlPool = mysql.createPool({
    host: runtimeConfig.mysql.host,
    port: runtimeConfig.mysql.port,
    user: runtimeConfig.mysql.user,
    password: runtimeConfig.mysql.password,
    database: runtimeConfig.mysql.database,
    waitForConnections: true,
    connectionLimit: runtimeConfig.mysql.connectionLimit,
    timezone: runtimeConfig.mysql.timezone,
    charset: 'utf8mb4',
  });
  return mysqlPool;
}

function getRedisClient(runtimeConfig) {
  if (redisClient) return redisClient;
  if (!runtimeConfig?.redis?.enabled) {
    throw new Error('Redis 未启用，请设置 BIDMIND_REDIS_ENABLED=true');
  }
  const Redis = require('ioredis');
  const client = runtimeConfig.redis.url
    ? new Redis(runtimeConfig.redis.url, { lazyConnect: true })
    : new Redis({
      host: '127.0.0.1',
      port: 6379,
      lazyConnect: true,
    });
  client.connect().catch(() => undefined);
  redisClient = client;
  return redisClient;
}

function getMinioClient(runtimeConfig) {
  if (minioClient) return minioClient;
  if (!runtimeConfig?.minio?.enabled) {
    throw new Error('MinIO 未启用，请设置 BIDMIND_MINIO_ENABLED=true');
  }
  const Minio = require('minio');
  minioClient = new Minio.Client({
    endPoint: runtimeConfig.minio.endpoint,
    port: runtimeConfig.minio.port,
    useSSL: runtimeConfig.minio.useSSL,
    accessKey: runtimeConfig.minio.accessKey,
    secretKey: runtimeConfig.minio.secretKey,
    region: runtimeConfig.minio.region || undefined,
  });
  return minioClient;
}

module.exports = {
  getMysqlPool,
  getRedisClient,
  getMinioClient,
};
