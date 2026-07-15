const { getRedisClient } = require('./clients.cjs');

function createLocalEventStore(limit = 600) {
  const byUser = new Map();

  function getState(userId) {
    const key = String(userId || '');
    if (!byUser.has(key)) {
      byUser.set(key, {
        seq: { tasks: 0, knowledge: 0, duplicate: 0, export: 0 },
        items: { tasks: [], knowledge: [], duplicate: [], export: [] },
      });
    }
    return byUser.get(key);
  }

  return {
    async push(userId, channel, payload) {
      const state = getState(userId);
      if (!state.items[channel]) return;
      const id = ++state.seq[channel];
      state.items[channel].push({ id, payload });
      if (state.items[channel].length > limit) {
        state.items[channel] = state.items[channel].slice(-limit);
      }
    },
    async read(userId, channel, since = 0) {
      const state = getState(userId);
      if (!state.items[channel]) return [];
      return state.items[channel].filter((item) => item.id > since);
    },
  };
}

function createRedisEventStore(runtimeConfig, limit = 600) {
  const redis = getRedisClient(runtimeConfig);
  const localFallback = createLocalEventStore(limit);
  const prefix = `${runtimeConfig.redis.keyPrefix || 'bidmind:'}events`;
  let warned = false;

  function warnFallback(error) {
    if (warned) return;
    warned = true;
    console.warn('[bidmind-web-api] Redis 事件存储不可用，已降级为本地内存事件。', error?.message || error);
  }

  function keyFor(userId, channel) {
    return `${prefix}:${String(userId || 'anonymous')}:${channel}`;
  }

  function seqKeyFor(userId, channel) {
    return `${prefix}:seq:${String(userId || 'anonymous')}:${channel}`;
  }

  return {
    async push(userId, channel, payload) {
      try {
        const id = await redis.incr(seqKeyFor(userId, channel));
        const key = keyFor(userId, channel);
        await redis.rpush(key, JSON.stringify({ id, payload }));
        await redis.ltrim(key, -limit, -1);
        await redis.expire(key, 60 * 60 * 8);
        await redis.expire(seqKeyFor(userId, channel), 60 * 60 * 8);
      } catch (error) {
        warnFallback(error);
        await localFallback.push(userId, channel, payload);
      }
    },
    async read(userId, channel, since = 0) {
      try {
        const key = keyFor(userId, channel);
        const rows = await redis.lrange(key, 0, -1);
        return rows
          .map((row) => {
            try {
              return JSON.parse(row);
            } catch {
              return null;
            }
          })
          .filter((item) => item && Number(item.id) > since);
      } catch (error) {
        warnFallback(error);
        return localFallback.read(userId, channel, since);
      }
    },
  };
}

function createEventStore(runtimeConfig, options = {}) {
  const limit = Number(options.limit || 600);
  if (runtimeConfig?.drivers?.events === 'redis') {
    return createRedisEventStore(runtimeConfig, limit);
  }
  return createLocalEventStore(limit);
}

module.exports = {
  createEventStore,
};
