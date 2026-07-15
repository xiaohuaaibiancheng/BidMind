const { getMysqlPool } = require('./clients.cjs');

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeProjectIdFromKey(rawProjectId) {
  const value = String(rawProjectId || '');
  return value === '__global__' ? '' : value;
}

function stateKey(prefix, projectId = '') {
  return `${prefix}:${String(projectId || '__global__')}`;
}

function technicalPlanSummaryFromState(state) {
  if (!state || typeof state !== 'object') return null;
  const outline = Array.isArray(state.outlineData?.outline) ? state.outlineData.outline : [];
  const contentGenerationSections = state.contentGenerationSections && typeof state.contentGenerationSections === 'object'
    ? state.contentGenerationSections
    : {};
  return {
    step: typeof state.step === 'string' ? state.step : 'document-analysis',
    fileName: typeof state.fileName === 'string' ? state.fileName : '',
    hasFileContent: typeof state.fileContent === 'string' && state.fileContent.length > 0,
    fileContentLength: typeof state.fileContent === 'string' ? state.fileContent.length : 0,
    bidAnalysisMode: state.bidAnalysisMode || 'key',
    bidAnalysisProgress: Number(state.bidAnalysisProgress) || 0,
    outlineMode: state.outlineMode || 'aligned',
    outlineRootCount: outline.length,
    contentSectionCount: Object.keys(contentGenerationSections).length,
    updatedAt: new Date().toISOString(),
  };
}

function createMysqlStateBackend(runtimeConfig, userId) {
  let initialized = false;

  async function ensureTable() {
    if (initialized) return;
    const pool = await getMysqlPool(runtimeConfig);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bm_user_states (
        user_id VARCHAR(96) NOT NULL,
        state_key VARCHAR(180) NOT NULL,
        state_value LONGTEXT NOT NULL,
        updated_at VARCHAR(40) NOT NULL,
        PRIMARY KEY (user_id, state_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    initialized = true;
  }

  return {
    async readAll() {
      await ensureTable();
      const pool = await getMysqlPool(runtimeConfig);
      const [rows] = await pool.query(
        'SELECT state_key, state_value, updated_at FROM bm_user_states WHERE user_id = ?',
        [String(userId || '')]
      );
      return (Array.isArray(rows) ? rows : []).map((row) => {
        const key = String(row.state_key || '');
        let value = null;
        try {
          value = JSON.parse(String(row.state_value || 'null'));
        } catch {
          value = null;
        }
        return {
          key,
          value,
          updatedAt: String(row.updated_at || ''),
        };
      });
    },

    async write(key, value) {
      await ensureTable();
      const pool = await getMysqlPool(runtimeConfig);
      await pool.query(
        `INSERT INTO bm_user_states (user_id, state_key, state_value, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
        [
          String(userId || ''),
          String(key || ''),
          JSON.stringify(value ?? null),
          new Date().toISOString(),
        ]
      );
    },

    async remove(key) {
      await ensureTable();
      const pool = await getMysqlPool(runtimeConfig);
      await pool.query(
        'DELETE FROM bm_user_states WHERE user_id = ? AND state_key = ?',
        [String(userId || ''), String(key || '')]
      );
    },
  };
}

function createLocalStateBackend() {
  return {
    async readAll() {
      return [];
    },
    async write() {
      return undefined;
    },
    async remove() {
      return undefined;
    },
  };
}

function createMirrorQueue(logger = console) {
  let chain = Promise.resolve();

  function enqueue(task, label) {
    chain = chain
      .then(() => task())
      .catch((error) => {
        logger.warn(`[bidmind-web-api] 状态镜像失败 (${label})`, error?.message || error);
      });
  }

  async function flush() {
    await chain.catch(() => undefined);
  }

  return {
    enqueue,
    flush,
  };
}

function createConfigStoreMirror(baseStore, backend, mirrorQueue, enabled) {
  const configKey = 'config:__global__';

  function mirrorLatestConfig(label) {
    if (!enabled) return;
    const latest = baseStore.load();
    mirrorQueue.enqueue(() => backend.write(configKey, latest), label);
  }

  return {
    getConfigFilePath() {
      return baseStore.getConfigFilePath();
    },
    load() {
      return baseStore.load();
    },
    save(config) {
      const result = baseStore.save(config || {});
      mirrorLatestConfig('config.save');
      return result;
    },
  };
}

function createWorkspaceStoreMirror(baseStore, backend, mirrorQueue, enabled) {
  function mirrorWrite(key, value, label) {
    if (!enabled) return;
    mirrorQueue.enqueue(() => backend.write(key, value), label);
  }

  function mirrorRemove(key, label) {
    if (!enabled) return;
    mirrorQueue.enqueue(() => backend.remove(key), label);
  }

  function mirrorTechnicalPlanSummary(state, projectId, label) {
    const summaryKey = stateKey('technical-plan-summary', projectId);
    const summary = technicalPlanSummaryFromState(state);
    if (!summary) {
      mirrorRemove(summaryKey, `${label}.summary.remove`);
      return;
    }
    mirrorWrite(summaryKey, summary, `${label}.summary.save`);
  }

  return {
    getTechnicalPlanFilePath(projectId = '') {
      return baseStore.getTechnicalPlanFilePath(projectId);
    },

    loadTechnicalPlan(projectId = '') {
      return baseStore.loadTechnicalPlan(projectId);
    },

    saveTechnicalPlan(state, projectId = '') {
      const result = baseStore.saveTechnicalPlan(state, projectId);
      mirrorWrite(stateKey('technical-plan', projectId), state, 'workspace.saveTechnicalPlan');
      mirrorTechnicalPlanSummary(state, projectId, 'workspace.saveTechnicalPlan');
      return result;
    },

    updateTechnicalPlan(partial, projectId = '') {
      const next = baseStore.updateTechnicalPlan(partial, projectId);
      mirrorWrite(stateKey('technical-plan', projectId), next, 'workspace.updateTechnicalPlan');
      mirrorTechnicalPlanSummary(next, projectId, 'workspace.updateTechnicalPlan');
      return next;
    },

    clearTechnicalPlan(projectId = '') {
      const result = baseStore.clearTechnicalPlan(projectId);
      mirrorRemove(stateKey('technical-plan', projectId), 'workspace.clearTechnicalPlan');
      mirrorRemove(stateKey('technical-plan-summary', projectId), 'workspace.clearTechnicalPlan.summary');
      return result;
    },

    loadTechnicalPlanSummary(projectId = '') {
      return baseStore.loadTechnicalPlanSummary(projectId);
    },

    loadBusinessBid(projectId = '') {
      return baseStore.loadBusinessBid(projectId);
    },

    saveBusinessBid(state, projectId = '') {
      const result = baseStore.saveBusinessBid(state, projectId);
      mirrorWrite(stateKey('business-bid', projectId), state, 'workspace.saveBusinessBid');
      return result;
    },

    updateBusinessBid(partial, projectId = '') {
      const next = baseStore.updateBusinessBid(partial, projectId);
      mirrorWrite(stateKey('business-bid', projectId), next, 'workspace.updateBusinessBid');
      return next;
    },

    clearBusinessBid(projectId = '') {
      const result = baseStore.clearBusinessBid(projectId);
      mirrorRemove(stateKey('business-bid', projectId), 'workspace.clearBusinessBid');
      return result;
    },

    loadDuplicateCheck(projectId = '') {
      return baseStore.loadDuplicateCheck(projectId);
    },

    saveDuplicateCheck(state, projectId = '') {
      const result = baseStore.saveDuplicateCheck(state, projectId);
      mirrorWrite(stateKey('duplicate-check', projectId), state, 'workspace.saveDuplicateCheck');
      return result;
    },

    updateDuplicateCheck(partial, projectId = '') {
      const next = baseStore.updateDuplicateCheck(partial, projectId);
      mirrorWrite(stateKey('duplicate-check', projectId), next, 'workspace.updateDuplicateCheck');
      return next;
    },

    clearDuplicateCheck(projectId = '') {
      const result = baseStore.clearDuplicateCheck(projectId);
      mirrorRemove(stateKey('duplicate-check', projectId), 'workspace.clearDuplicateCheck');
      return result;
    },

    loadRejectionCheck(projectId = '') {
      return baseStore.loadRejectionCheck(projectId);
    },

    saveRejectionCheck(state, projectId = '') {
      const result = baseStore.saveRejectionCheck(state, projectId);
      mirrorWrite(stateKey('rejection-check', projectId), state, 'workspace.saveRejectionCheck');
      return result;
    },

    updateRejectionCheck(partial, projectId = '') {
      const next = baseStore.updateRejectionCheck(partial, projectId);
      mirrorWrite(stateKey('rejection-check', projectId), next, 'workspace.updateRejectionCheck');
      return next;
    },

    clearRejectionCheck(projectId = '') {
      const result = baseStore.clearRejectionCheck(projectId);
      mirrorRemove(stateKey('rejection-check', projectId), 'workspace.clearRejectionCheck');
      return result;
    },

    loadBidOpportunity(projectId = '') {
      return baseStore.loadBidOpportunity(projectId);
    },

    saveBidOpportunity(state, projectId = '') {
      const result = baseStore.saveBidOpportunity(state, projectId);
      mirrorWrite(stateKey('bid-opportunity', projectId), state, 'workspace.saveBidOpportunity');
      return result;
    },

    updateBidOpportunity(partial, projectId = '') {
      const next = baseStore.updateBidOpportunity(partial, projectId);
      mirrorWrite(stateKey('bid-opportunity', projectId), next, 'workspace.updateBidOpportunity');
      return next;
    },

    clearBidOpportunity(projectId = '') {
      const result = baseStore.clearBidOpportunity(projectId);
      mirrorRemove(stateKey('bid-opportunity', projectId), 'workspace.clearBidOpportunity');
      return result;
    },

    loadProjects() {
      return baseStore.loadProjects();
    },

    saveProjects(state) {
      const result = baseStore.saveProjects(state);
      mirrorWrite('projects:__global__', state, 'workspace.saveProjects');
      return result;
    },

    updateProjects(partial) {
      const next = baseStore.updateProjects(partial);
      mirrorWrite('projects:__global__', next, 'workspace.updateProjects');
      return next;
    },

    clearProjects() {
      const result = baseStore.clearProjects();
      mirrorRemove('projects:__global__', 'workspace.clearProjects');
      return result;
    },
  };
}

function parseStateKey(key) {
  const value = String(key || '');
  const index = value.indexOf(':');
  if (index < 0) {
    return { prefix: value, projectId: '' };
  }
  const prefix = value.slice(0, index);
  const projectId = normalizeProjectIdFromKey(value.slice(index + 1));
  return { prefix, projectId };
}

async function hydrateFromMysqlState(rows, baseConfigStore, baseWorkspaceStore, logger = console) {
  if (!Array.isArray(rows) || !rows.length) {
    return { restored: 0 };
  }

  const entries = rows
    .filter((item) => item && typeof item.key === 'string')
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));

  const byKey = new Map(entries.map((item) => [item.key, clone(item.value)]));

  let restored = 0;

  if (byKey.has('config:__global__')) {
    const config = byKey.get('config:__global__');
    if (config && typeof config === 'object') {
      baseConfigStore.save(config);
      restored += 1;
    }
  }

  if (byKey.has('projects:__global__')) {
    const projects = byKey.get('projects:__global__');
    if (projects && typeof projects === 'object') {
      baseWorkspaceStore.saveProjects(projects);
      restored += 1;
    }
  }

  for (const [key, value] of byKey.entries()) {
    if (key === 'config:__global__' || key === 'projects:__global__') {
      continue;
    }
    const { prefix, projectId } = parseStateKey(key);
    try {
      if (prefix === 'technical-plan') {
        baseWorkspaceStore.saveTechnicalPlan(value, projectId);
        restored += 1;
      } else if (prefix === 'business-bid') {
        baseWorkspaceStore.saveBusinessBid(value, projectId);
        restored += 1;
      } else if (prefix === 'duplicate-check') {
        baseWorkspaceStore.saveDuplicateCheck(value, projectId);
        restored += 1;
      } else if (prefix === 'rejection-check') {
        baseWorkspaceStore.saveRejectionCheck(value, projectId);
        restored += 1;
      } else if (prefix === 'bid-opportunity') {
        baseWorkspaceStore.saveBidOpportunity(value, projectId);
        restored += 1;
      }
    } catch (error) {
      logger.warn(`[bidmind-web-api] 恢复状态失败 (${key})`, error?.message || error);
    }
  }

  return { restored };
}

function createStatePersistence({ runtimeConfig, userId, baseWorkspaceStore, baseConfigStore, logger = console }) {
  const mysqlMode = runtimeConfig?.drivers?.state === 'mysql';
  const backend = mysqlMode
    ? createMysqlStateBackend(runtimeConfig, userId)
    : createLocalStateBackend();
  const mirrorQueue = createMirrorQueue(logger);

  const workspaceStore = createWorkspaceStoreMirror(baseWorkspaceStore, backend, mirrorQueue, mysqlMode);
  const configStore = createConfigStoreMirror(baseConfigStore, backend, mirrorQueue, mysqlMode);

  return {
    workspaceStore,
    configStore,
    async hydrate() {
      if (!mysqlMode) {
        return { restored: 0 };
      }
      const rows = await backend.readAll();
      const result = await hydrateFromMysqlState(rows, baseConfigStore, baseWorkspaceStore, logger);
      logger.log(`[bidmind-web-api] MySQL 状态恢复完成 user=${userId} restored=${result.restored}`);
      return result;
    },
    async flush() {
      await mirrorQueue.flush();
    },
  };
}

module.exports = {
  createStatePersistence,
};
