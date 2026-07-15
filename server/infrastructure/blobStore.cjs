const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { getMinioClient } = require('./clients.cjs');

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function normalizeKey(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\./g, '_')
    .trim();
}

function createLocalBlobStore(rootDir) {
  fs.mkdirSync(rootDir, { recursive: true });

  function resolveFile(key) {
    const normalized = normalizeKey(key);
    const resolved = path.resolve(rootDir, normalized);
    const safeRoot = path.resolve(rootDir);
    if (resolved !== safeRoot && !resolved.startsWith(`${safeRoot}${path.sep}`)) {
      throw new Error('非法文件路径');
    }
    return resolved;
  }

  return {
    async putBuffer(key, buffer) {
      const filePath = resolveFile(key);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, buffer);
      return { key: normalizeKey(key) };
    },
    async putFile(key, filePath) {
      const target = resolveFile(key);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(filePath, target);
      return { key: normalizeKey(key) };
    },
    async getBuffer(key) {
      const filePath = resolveFile(key);
      return fsp.readFile(filePath);
    },
    async remove(key) {
      const filePath = resolveFile(key);
      await fsp.rm(filePath, { force: true });
    },
    async exists(key) {
      const filePath = resolveFile(key);
      return fs.existsSync(filePath);
    },
    async getLocalPath(key) {
      return resolveFile(key);
    },
  };
}

function createMinioBlobStore(runtimeConfig) {
  const client = getMinioClient(runtimeConfig);
  const bucket = runtimeConfig.minio.bucket;
  const prefix = normalizeKey(runtimeConfig.minio.prefix || 'app');
  let ensured = false;

  async function ensureBucket() {
    if (ensured) return;
    const exists = await client.bucketExists(bucket).catch(() => false);
    if (!exists) {
      await client.makeBucket(bucket, runtimeConfig.minio.region || undefined);
    }
    ensured = true;
  }

  function objectKey(key) {
    const normalized = normalizeKey(key);
    return `${prefix}/${normalized}`;
  }

  return {
    async putBuffer(key, buffer, contentType = 'application/octet-stream') {
      await ensureBucket();
      const target = objectKey(key);
      await client.putObject(bucket, target, buffer, buffer.length, {
        'Content-Type': contentType,
      });
      return { key: normalizeKey(key) };
    },
    async putFile(key, filePath, contentType = 'application/octet-stream') {
      const buffer = await fsp.readFile(filePath);
      return this.putBuffer(key, buffer, contentType);
    },
    async getBuffer(key) {
      await ensureBucket();
      const stream = await client.getObject(bucket, objectKey(key));
      return streamToBuffer(stream);
    },
    async remove(key) {
      await ensureBucket();
      await client.removeObject(bucket, objectKey(key));
    },
    async exists(key) {
      await ensureBucket();
      try {
        await client.statObject(bucket, objectKey(key));
        return true;
      } catch {
        return false;
      }
    },
    async getLocalPath(key) {
      const tempName = `blob-${Date.now()}-${crypto.randomUUID()}`;
      const tempPath = path.join('/tmp', tempName);
      const buffer = await this.getBuffer(key);
      await fsp.writeFile(tempPath, buffer);
      return tempPath;
    },
  };
}

function createBlobStore(runtimeConfig, options = {}) {
  const localRoot = options.localRoot || path.join(process.cwd(), '.web-data', 'blob-store');
  const localStore = createLocalBlobStore(localRoot);
  if (runtimeConfig?.drivers?.blob === 'minio') {
    const minioStore = createMinioBlobStore(runtimeConfig);
    let warned = false;

    function warnFallback(error) {
      if (warned) return;
      warned = true;
      console.warn('[bidmind-web-api] MinIO 不可用，已降级为本地对象存储。', error?.message || error);
    }

    return {
      async putBuffer(key, buffer, contentType) {
        try {
          return await minioStore.putBuffer(key, buffer, contentType);
        } catch (error) {
          warnFallback(error);
          return localStore.putBuffer(key, buffer, contentType);
        }
      },
      async putFile(key, filePath, contentType) {
        try {
          return await minioStore.putFile(key, filePath, contentType);
        } catch (error) {
          warnFallback(error);
          return localStore.putFile(key, filePath, contentType);
        }
      },
      async getBuffer(key) {
        try {
          return await minioStore.getBuffer(key);
        } catch (error) {
          warnFallback(error);
          return localStore.getBuffer(key);
        }
      },
      async remove(key) {
        try {
          await minioStore.remove(key);
        } catch (error) {
          warnFallback(error);
        }
        await localStore.remove(key).catch(() => undefined);
      },
      async exists(key) {
        try {
          if (await minioStore.exists(key)) {
            return true;
          }
        } catch (error) {
          warnFallback(error);
        }
        return localStore.exists(key);
      },
      async getLocalPath(key) {
        try {
          return await minioStore.getLocalPath(key);
        } catch (error) {
          warnFallback(error);
          return localStore.getLocalPath(key);
        }
      },
    };
  }
  return localStore;
}

module.exports = {
  createBlobStore,
};
