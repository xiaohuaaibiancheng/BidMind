const fs = require('node:fs');
const path = require('node:path');
const { getMysqlPool } = require('./clients.cjs');

function createAuthStore({
  runtimeConfig,
  authFile,
  createId,
  normalizeAuthSession,
  toIsoTimestamp,
}) {
  const driver = runtimeConfig?.drivers?.auth || 'local';
  let initialized = false;

  async function ensureMysqlSchema() {
    if (initialized || driver !== 'mysql') return;
    const pool = await getMysqlPool(runtimeConfig);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bm_users (
        id VARCHAR(96) PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(120) NOT NULL,
        company VARCHAR(160) NOT NULL DEFAULT '',
        phone VARCHAR(64) NOT NULL DEFAULT '',
        avatar_filename VARCHAR(255) NOT NULL DEFAULT '',
        created_at VARCHAR(40) NOT NULL,
        updated_at VARCHAR(40) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bm_sessions (
        id VARCHAR(96) PRIMARY KEY,
        token VARCHAR(96) NOT NULL UNIQUE,
        user_id VARCHAR(96) NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        last_active_at VARCHAR(40) NOT NULL,
        user_agent VARCHAR(300) NOT NULL DEFAULT '',
        INDEX idx_bm_sessions_user_id (user_id),
        CONSTRAINT fk_bm_sessions_user FOREIGN KEY (user_id) REFERENCES bm_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    initialized = true;
  }

  async function loadLocal() {
    try {
      if (!fs.existsSync(authFile)) {
        return { users: [], sessions: [] };
      }
      const raw = fs.readFileSync(authFile, 'utf-8');
      const data = JSON.parse(raw);
      const users = Array.isArray(data.users) ? data.users : [];
      const userIds = new Set(users.map((item) => String(item?.id || '')));
      const sessions = Array.isArray(data.sessions)
        ? data.sessions
          .map((item) => normalizeAuthSession(item))
          .filter((item) => item.token && item.user_id && userIds.has(item.user_id))
        : [];
      return { users, sessions };
    } catch {
      return { users: [], sessions: [] };
    }
  }

  async function saveLocal(data) {
    fs.mkdirSync(path.dirname(authFile), { recursive: true });
    fs.writeFileSync(authFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  async function loadMysql() {
    await ensureMysqlSchema();
    const pool = await getMysqlPool(runtimeConfig);
    const [userRows] = await pool.query('SELECT * FROM bm_users');
    const [sessionRows] = await pool.query('SELECT * FROM bm_sessions');
    const users = Array.isArray(userRows) ? userRows.map((row) => ({
      id: String(row.id),
      email: String(row.email || ''),
      password_hash: String(row.password_hash || ''),
      display_name: String(row.display_name || ''),
      company: String(row.company || ''),
      phone: String(row.phone || ''),
      avatar_filename: String(row.avatar_filename || ''),
      created_at: toIsoTimestamp(row.created_at),
      updated_at: toIsoTimestamp(row.updated_at),
    })) : [];
    const userIds = new Set(users.map((item) => item.id));
    const sessions = Array.isArray(sessionRows)
      ? sessionRows
        .map((row) => normalizeAuthSession({
          id: row.id,
          token: row.token,
          user_id: row.user_id,
          created_at: row.created_at,
          last_active_at: row.last_active_at,
          user_agent: row.user_agent,
        }))
        .filter((session) => session.token && session.user_id && userIds.has(session.user_id))
      : [];
    return { users, sessions };
  }

  async function saveMysql(data) {
    await ensureMysqlSchema();
    const pool = await getMysqlPool(runtimeConfig);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM bm_sessions');
      await connection.query('DELETE FROM bm_users');

      const users = Array.isArray(data?.users) ? data.users : [];
      for (const user of users) {
        await connection.query(
          `INSERT INTO bm_users
          (id, email, password_hash, display_name, company, phone, avatar_filename, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            String(user.id || createId('user')),
            String(user.email || ''),
            String(user.password_hash || ''),
            String(user.display_name || ''),
            String(user.company || ''),
            String(user.phone || ''),
            String(user.avatar_filename || ''),
            toIsoTimestamp(user.created_at),
            toIsoTimestamp(user.updated_at || user.created_at),
          ]
        );
      }

      const userIds = new Set(users.map((item) => String(item.id || '')));
      const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
      for (const session of sessions) {
        const normalized = normalizeAuthSession(session);
        if (!normalized.token || !normalized.user_id || !userIds.has(normalized.user_id)) {
          continue;
        }
        await connection.query(
          `INSERT INTO bm_sessions
          (id, token, user_id, created_at, last_active_at, user_agent)
          VALUES (?, ?, ?, ?, ?, ?)`,
          [
            normalized.id,
            normalized.token,
            normalized.user_id,
            normalized.created_at,
            normalized.last_active_at,
            normalized.user_agent,
          ]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return {
    async read() {
      if (driver === 'mysql') {
        return loadMysql();
      }
      return loadLocal();
    },
    async write(data) {
      if (driver === 'mysql') {
        return saveMysql(data);
      }
      return saveLocal(data);
    },
  };
}

module.exports = {
  createAuthStore,
};
