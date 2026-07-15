const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const Module = require('node:module');
const mime = require('mime-types');
const express = require('express');
const multer = require('multer');
const { createRuntimeConfig } = require('./infrastructure/runtimeConfig.cjs');
const { createAuthStore } = require('./infrastructure/authStore.cjs');
const { createEventStore } = require('./infrastructure/eventStore.cjs');
const { createBlobStore } = require('./infrastructure/blobStore.cjs');
const { createStatePersistence } = require('./infrastructure/stateStore.cjs');

const RUNTIME_CONFIG = createRuntimeConfig();
const DATA_ROOT = RUNTIME_CONFIG.app.dataRoot;
const USERS_ROOT = path.join(DATA_ROOT, 'users');
const UPLOAD_ROOT = path.join(DATA_ROOT, 'uploads');
const LEGACY_EXPORT_ROOT = path.join(DATA_ROOT, 'exports');
const AVATAR_ROOT = path.join(DATA_ROOT, 'avatars');
const AUTH_FILE = path.join(DATA_ROOT, 'users.json');
const PORT = Number(RUNTIME_CONFIG.app.port || 8788);

fs.mkdirSync(DATA_ROOT, { recursive: true });
fs.mkdirSync(USERS_ROOT, { recursive: true });
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
fs.mkdirSync(LEGACY_EXPORT_ROOT, { recursive: true });
fs.mkdirSync(AVATAR_ROOT, { recursive: true });

function sanitizeFilename(value) {
  return String(value || 'file')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'file';
}

function countCjkChars(value) {
  return (String(value || '').match(/[\u3400-\u9fff]/g) || []).length;
}

function countMojibakeMarkers(value) {
  return (String(value || '').match(/[ÃÂÆÇÐÑØÞßæðøþ]/g) || []).length;
}

function normalizeUploadedFilename(value) {
  const raw = String(value || '').replace(/\0/g, '').trim();
  if (!raw) return 'file';

  if (!/[\u0080-\u00ff]/.test(raw)) {
    return raw;
  }

  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8').replace(/\0/g, '').trim();
    if (!decoded || decoded.includes('\uFFFD')) {
      return raw;
    }
    if (countCjkChars(decoded) > countCjkChars(raw)) {
      return decoded;
    }
    if (countMojibakeMarkers(raw) >= 2 && countMojibakeMarkers(decoded) < countMojibakeMarkers(raw)) {
      return decoded;
    }
  } catch {
    return raw;
  }

  return raw;
}

function createId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function toIsoTimestamp(value, fallback = new Date().toISOString()) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date.toISOString();
}

function normalizeAuthSession(session) {
  const now = new Date().toISOString();
  return {
    id: String(session?.id || createId('session')),
    token: String(session?.token || '').trim(),
    user_id: String(session?.user_id || '').trim(),
    created_at: toIsoTimestamp(session?.created_at, now),
    last_active_at: toIsoTimestamp(session?.last_active_at || session?.created_at, now),
    user_agent: String(session?.user_agent || '').slice(0, 300),
  };
}

const authStore = createAuthStore({
  runtimeConfig: RUNTIME_CONFIG,
  authFile: AUTH_FILE,
  createId,
  normalizeAuthSession,
  toIsoTimestamp,
});

async function readAuthStore() {
  return authStore.read();
}

async function writeAuthStore(data) {
  await authStore.write(data);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function createSession(userId, options = {}) {
  const now = new Date().toISOString();
  return {
    id: createId('session'),
    token: crypto.randomUUID(),
    user_id: userId,
    created_at: now,
    last_active_at: now,
    user_agent: String(options.userAgent || '').slice(0, 300),
  };
}

function userAvatarUrl(filename) {
  if (!filename) return '';
  return `/api/auth/avatar/${encodeURIComponent(filename)}`;
}

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name || '',
    company: user.company || '',
    phone: user.phone || '',
    avatar_url: userAvatarUrl(user.avatar_filename || ''),
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

function touchSession(store, token, updatedAt = new Date().toISOString()) {
  if (!store || !Array.isArray(store.sessions)) return false;
  const index = store.sessions.findIndex((item) => item.token === token);
  if (index < 0) return false;
  const session = normalizeAuthSession(store.sessions[index]);
  store.sessions[index] = {
    ...session,
    last_active_at: updatedAt,
  };
  return true;
}

function describeSessionDevice(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (!ua) return '未知设备';
  const os = ua.includes('mac os') || ua.includes('macintosh')
    ? 'macOS'
    : ua.includes('windows')
      ? 'Windows'
      : ua.includes('android')
        ? 'Android'
        : ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')
          ? 'iOS'
          : ua.includes('linux')
            ? 'Linux'
            : '';
  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('electron/')
      ? 'Electron'
    : ua.includes('chrome/')
      ? 'Chrome'
      : ua.includes('safari/') && !ua.includes('chrome/')
        ? 'Safari'
        : ua.includes('firefox/')
          ? 'Firefox'
          : '浏览器';
  return [os, browser].filter(Boolean).join(' · ') || browser;
}

function listUserSessions(store, userId, currentToken) {
  return (store.sessions || [])
    .filter((item) => item.user_id === userId)
    .map((item) => {
      const normalized = normalizeAuthSession(item);
      return {
        id: normalized.id,
        is_current: normalized.token === currentToken,
        created_at: normalized.created_at,
        last_active_at: normalized.last_active_at || normalized.created_at,
        device: describeSessionDevice(normalized.user_agent),
      };
    })
    .sort((a, b) => String(b.last_active_at).localeCompare(String(a.last_active_at)));
}

function trimUserSessions(store, userId, maxCount = 20) {
  if (!store || !Array.isArray(store.sessions)) return;
  const targetSessions = store.sessions
    .filter((item) => item.user_id === userId)
    .map((item) => normalizeAuthSession(item))
    .sort((a, b) => String(b.last_active_at).localeCompare(String(a.last_active_at)));
  if (targetSessions.length <= maxCount) return;
  const keepTokens = new Set(targetSessions.slice(0, maxCount).map((item) => item.token));
  store.sessions = store.sessions.filter((item) => item.user_id !== userId || keepTokens.has(item.token));
}

async function findUserByToken(token) {
  const safeToken = String(token || '').trim();
  if (!safeToken) return null;
  const store = await readAuthStore();
  const session = store.sessions.find((item) => item.token === safeToken);
  if (!session) return null;
  const user = store.users.find((item) => item.id === session.user_id);
  if (!user) return null;
  return { store, user, session: normalizeAuthSession(session), token: safeToken };
}

function createLocalFileSelection(filePath, originalName, extra = {}) {
  const stats = fs.statSync(filePath);
  const normalizedName = normalizeUploadedFilename(originalName || path.basename(filePath));
  const extension = path.extname(normalizedName || filePath).toLowerCase();
  return {
    id: crypto.createHash('sha1').update(filePath).digest('hex'),
    file_name: normalizedName || path.basename(filePath),
    file_path: filePath,
    extension,
    size: stats.size,
    modified_at: stats.mtime.toISOString(),
    ...extra,
  };
}

function getUserUploadRootById(userId) {
  const root = userId
    ? path.join(UPLOAD_ROOT, normalizeUserPathSegment(userId))
    : path.join(UPLOAD_ROOT, 'anonymous');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function createUploadBlobKey(userId, selection) {
  const safeUser = normalizeUserPathSegment(userId || 'anonymous');
  const safeFileName = sanitizeFilename(selection?.file_name || 'file');
  return `uploads/${safeUser}/${selection?.id || createId('file')}-${safeFileName}`;
}

function getAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
    return pkg.version || '0.1.0-web';
  } catch {
    return '0.1.0-web';
  }
}

function normalizeUserPathSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120) || 'anonymous';
}

function getUserDataRoot(userId) {
  const safeUserId = normalizeUserPathSegment(userId);
  return path.join(USERS_ROOT, safeUserId);
}

function shouldMigrateLegacyData(userId, userDataRoot) {
  if (RUNTIME_CONFIG.drivers.auth !== 'local') {
    return false;
  }
  const hasScopedData = fs.existsSync(path.join(userDataRoot, 'user_config.json'))
    || fs.existsSync(path.join(userDataRoot, 'workspace'));
  if (hasScopedData) {
    return false;
  }
  const markerPath = path.join(userDataRoot, '.legacy-migrated');
  if (fs.existsSync(markerPath)) {
    return false;
  }
  let users = [];
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
      users = Array.isArray(parsed?.users) ? parsed.users : [];
    }
  } catch {
    users = [];
  }
  if (users.length !== 1) {
    return false;
  }
  return users.some((item) => String(item?.id || '') === String(userId || ''));
}

function migrateLegacyDataToUser(userId, userDataRoot) {
  if (!shouldMigrateLegacyData(userId, userDataRoot)) {
    return;
  }
  const legacyConfigPath = path.join(DATA_ROOT, 'user_config.json');
  const legacyWorkspacePath = path.join(DATA_ROOT, 'workspace');
  const markerPath = path.join(userDataRoot, '.legacy-migrated');
  let migrated = false;

  try {
    if (fs.existsSync(legacyConfigPath)) {
      fs.copyFileSync(legacyConfigPath, path.join(userDataRoot, 'user_config.json'));
      migrated = true;
    }
    if (fs.existsSync(legacyWorkspacePath)) {
      fs.cpSync(legacyWorkspacePath, path.join(userDataRoot, 'workspace'), {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
      migrated = true;
    }
  } catch (error) {
    console.warn('[bidmind-web-api] migrate legacy data failed', error);
  } finally {
    if (migrated || !fs.existsSync(markerPath)) {
      try {
        fs.writeFileSync(markerPath, new Date().toISOString(), 'utf-8');
      } catch {
        // ignore marker errors
      }
    }
  }
}

function createAppShim({ userDataRoot, exportRoot }) {
  return {
    getPath(name) {
      if (name === 'userData') {
        return userDataRoot;
      }
      if (name === 'documents') {
        return exportRoot;
      }
      return userDataRoot;
    },
    getVersion: getAppVersion,
  };
}

function createUserAppShim(userId) {
  const userDataRoot = getUserDataRoot(userId);
  const exportRoot = path.join(userDataRoot, 'exports');
  fs.mkdirSync(userDataRoot, { recursive: true });
  migrateLegacyDataToUser(userId, userDataRoot);
  fs.mkdirSync(exportRoot, { recursive: true });
  return createAppShim({ userDataRoot, exportRoot });
}

const legacyAppShim = createAppShim({
  userDataRoot: DATA_ROOT,
  exportRoot: LEGACY_EXPORT_ROOT,
});

const electronShim = {
  app: legacyAppShim,
  dialog: {
    async showOpenDialog() {
      return { canceled: true, filePaths: [] };
    },
    async showSaveDialog() {
      return { canceled: true, filePath: '' };
    },
  },
  nativeImage: {
    createFromBuffer(buffer) {
      return {
        isEmpty: () => !buffer || !buffer.length,
        toPNG: () => buffer,
      };
    },
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return electronShim;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { createConfigStore } = require('../backend-core/services/configStore.cjs');
const { createWorkspaceStore } = require('../backend-core/services/workspaceStore.cjs');
const { createAiService } = require('../backend-core/services/aiService.cjs');
const { parseDocumentWithConfig, resolveFileParser } = require('../backend-core/services/fileService.cjs');
const { createTaskService } = require('../backend-core/services/taskService.cjs');
const { createKnowledgeBaseService } = require('../backend-core/services/knowledgeBaseService.cjs');
const { createDuplicateCheckService } = require('../backend-core/services/duplicateCheckService.cjs');
const { buildDocxResult } = require('../backend-core/services/exportService.cjs');
const { getGeneratedImagesDir, getImportedImagesDir } = require('../backend-core/utils/paths.cjs');

const EVENT_LIMIT = 600;
const EVENT_CHANNELS = ['tasks', 'knowledge', 'duplicate', 'export'];
const userServiceContexts = new Map();
const userServiceContextPromises = new Map();
const eventStore = createEventStore(RUNTIME_CONFIG, { limit: EVENT_LIMIT });
const blobStore = createBlobStore(RUNTIME_CONFIG, {
  localRoot: path.join(DATA_ROOT, 'blob-store'),
});
const userStatePersistence = new Map();

function logRuntimeStorageConfig() {
  console.log('[bidmind-web-api] storage drivers', {
    auth: RUNTIME_CONFIG.drivers.auth,
    state: RUNTIME_CONFIG.drivers.state,
    blob: RUNTIME_CONFIG.drivers.blob,
    events: RUNTIME_CONFIG.drivers.events,
    dataRoot: DATA_ROOT,
  });
}

async function pushUserEvent(context, channel, payload) {
  if (!context?.userId || !EVENT_CHANNELS.includes(channel)) return;
  await eventStore.push(context.userId, channel, payload);
}

async function readUserEvents(context, channel, since = 0) {
  if (!context?.userId || !EVENT_CHANNELS.includes(channel)) return [];
  return eventStore.read(context.userId, channel, since);
}

function createBridgeWebContents(context) {
  return {
    isDestroyed() {
      return false;
    },
    send(channel, payload) {
      if (channel === 'tasks:event') {
        void pushUserEvent(context, 'tasks', payload);
        return;
      }
      if (channel === 'knowledge-base:event') {
        void pushUserEvent(context, 'knowledge', payload);
        return;
      }
      if (channel === 'duplicate-check:event') {
        void pushUserEvent(context, 'duplicate', payload);
      }
    },
    once() {
      // Node 服务不会销毁 webContents，占位实现。
    },
  };
}

async function createUserServiceContext(userId) {
  const appShim = createUserAppShim(userId);
  const baseConfigStore = createConfigStore(appShim);
  const baseWorkspaceStore = createWorkspaceStore(appShim);
  const statePersistence = createStatePersistence({
    runtimeConfig: RUNTIME_CONFIG,
    userId,
    baseWorkspaceStore,
    baseConfigStore,
    logger: console,
  });
  await statePersistence.hydrate();
  const configStore = statePersistence.configStore;
  const workspaceStore = statePersistence.workspaceStore;
  const aiService = createAiService({ app: appShim, configStore });
  const knowledgeBaseService = createKnowledgeBaseService({ app: appShim, aiService, configStore });
  const duplicateCheckService = createDuplicateCheckService({ app: appShim, configStore, workspaceStore });
  const taskService = createTaskService({ aiService, workspaceStore, knowledgeBaseService });
  const context = {
    userId,
    runtimeConfig: RUNTIME_CONFIG,
    appShim,
    configStore,
    workspaceStore,
    aiService,
    knowledgeBaseService,
    duplicateCheckService,
    taskService,
    exportRoot: appShim.getPath('documents'),
  };
  context.bridgeWebContents = createBridgeWebContents(context);
  taskService.subscribe(context.bridgeWebContents);
  userStatePersistence.set(userId, statePersistence);
  return context;
}

async function getUserServiceContext(userId) {
  const safeUserId = String(userId || '').trim();
  if (!safeUserId) {
    return null;
  }
  const cached = userServiceContexts.get(safeUserId);
  if (cached) {
    return cached;
  }
  const pending = userServiceContextPromises.get(safeUserId);
  if (pending) {
    return pending;
  }
  const task = createUserServiceContext(safeUserId)
    .then((context) => {
      userServiceContexts.set(safeUserId, context);
      return context;
    })
    .finally(() => {
      userServiceContextPromises.delete(safeUserId);
    });
  userServiceContextPromises.set(safeUserId, task);
  return task;
}

function resolveUploadRoot(req) {
  const userId = req?.auth?.user?.id || '';
  return getUserUploadRootById(userId);
}

const uploadStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    cb(null, resolveUploadRoot(req));
  },
  filename: (_req, file, cb) => {
    const originalName = normalizeUploadedFilename(file.originalname || 'file');
    const ext = path.extname(originalName || '').toLowerCase();
    const baseName = sanitizeFilename(path.basename(originalName || 'file', ext));
    cb(null, `${Date.now()}-${crypto.randomUUID()}-${baseName}${ext}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: 1024 * 1024 * 1024,
    files: 200,
  },
});

const avatarUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, AVATAR_ROOT);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext || '.png'}`);
  },
});

const avatarUpload = multer({
  storage: avatarUploadStorage,
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1,
  },
});

const parserLabels = {
  local: '本地解析',
  'mineru-accurate-api': 'MinerU 精准解析 API',
  'mineru-agent-api': 'MinerU-Agent 轻量解析 API',
};
const duplicateCheckSupportedExtensions = new Set(['.doc', '.docx', '.wps', '.pdf', '.md', '.markdown']);

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function readBearerToken(headerValue) {
  const raw = String(headerValue || '').trim();
  if (!raw) return '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match) return '';
  return String(match[1] || '').trim();
}

function readTokenFromRequest(req) {
  const fromAuthHeader = readBearerToken(req.headers?.authorization);
  if (fromAuthHeader) return fromAuthHeader;
  const fromQuery = String(req.query?.token || '').trim();
  if (fromQuery) return fromQuery;
  return String(req.body?.token || '').trim();
}

function getRequestUserContext(req) {
  return req?.userContext || null;
}

async function requireUserContext(req, res, next) {
  const token = readTokenFromRequest(req);
  const auth = await findUserByToken(token);
  if (!auth) {
    res.status(401).json({
      success: false,
      message: '登录状态已失效，请重新登录',
    });
    return;
  }
  const context = await getUserServiceContext(auth.user.id);
  if (!context) {
    res.status(500).json({
      success: false,
      message: '无法加载用户上下文',
    });
    return;
  }
  req.auth = auth;
  req.userContext = context;
  next();
}

function parseProjectId(req) {
  const rawProjectId = req.query?.projectId || req.body?.projectId || req.body?.project_id || '';
  return String(rawProjectId || '').trim();
}

function normalizeProjectId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function normalizeManagedProjects(state) {
  const projects = Array.isArray(state?.projects) ? state.projects : [];
  return projects
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string')
    .map((item) => ({
      id: String(item.id),
      name: String(item.name || ''),
      code: String(item.code || ''),
      workbench: item.workbench === 'business-bid' ? 'business-bid' : 'technical-plan',
      status: item.status === 'completed' || item.status === 'deleted' ? item.status : 'in-progress',
      updated_at: String(item.updated_at || item.created_at || new Date().toISOString()),
    }));
}

function parseDuplicateHistorySummary(state) {
  const records = Array.isArray(state?.historyRecords) ? state.historyRecords : [];
  const sorted = records
    .filter((item) => item && typeof item === 'object')
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const latest = sorted[0] || null;
  const latestStatus = latest?.status;
  return {
    history_count: sorted.length,
    last_checked_at: latest?.updated_at || '',
    current_result_status: latestStatus === 'success' || latestStatus === 'error' || latestStatus === 'running' || latestStatus === 'pending'
      ? latestStatus
      : undefined,
  };
}

async function ensureFileSelectionUsableForServer(file, userId) {
  if (!file || typeof file !== 'object') return file;
  const currentPath = String(file.file_path || '');
  if (currentPath && fs.existsSync(currentPath)) {
    return file;
  }

  const blobKey = String(file.blob_key || '').trim();
  if (!blobKey) {
    return file;
  }

  const extFromName = path.extname(String(file.file_name || '')).toLowerCase();
  const ext = extFromName || String(file.extension || '').toLowerCase() || '.bin';
  const cacheRoot = path.join(getUserUploadRootById(userId), 'blob-cache');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const tempPath = path.join(cacheRoot, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  const buffer = await blobStore.getBuffer(blobKey);
  await fsp.writeFile(tempPath, buffer);
  return {
    ...file,
    file_path: tempPath,
  };
}

async function ensureDuplicatePayloadFiles(payload, userId) {
  const next = { ...(payload || {}) };
  if (next.tenderFile) {
    next.tenderFile = await ensureFileSelectionUsableForServer(next.tenderFile, userId);
  }
  if (Array.isArray(next.bidFiles)) {
    next.bidFiles = await Promise.all(next.bidFiles.map((file) => ensureFileSelectionUsableForServer(file, userId)));
  }
  return next;
}

app.get('/api/version', (_req, res) => {
  res.json({ version: getAppVersion() });
});

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const displayName = String(req.body?.displayName || '').trim();
  if (!email || !password || !displayName) {
    res.json({ success: false, message: '请完整填写邮箱、密码和昵称' });
    return;
  }
  if (password.length < 6) {
    res.json({ success: false, message: '密码至少 6 位' });
    return;
  }

  const store = await readAuthStore();
  if (store.users.some((item) => item.email === email)) {
    res.json({ success: false, message: '该邮箱已注册，请直接登录' });
    return;
  }

  const now = new Date().toISOString();
  const user = {
    id: createId('user'),
    email,
    password_hash: sha256(password),
    display_name: displayName,
    company: '',
    phone: '',
    avatar_filename: '',
    created_at: now,
    updated_at: now,
  };
  const session = createSession(user.id, { userAgent: req.headers['user-agent'] });
  store.users.push(user);
  store.sessions.push(session);
  trimUserSessions(store, user.id);
  await writeAuthStore(store);
  res.json({ success: true, token: session.token, user: toPublicUser(user) });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (!email || !password) {
    res.json({ success: false, message: '请输入邮箱和密码' });
    return;
  }
  const store = await readAuthStore();
  const user = store.users.find((item) => item.email === email);
  if (!user || user.password_hash !== sha256(password)) {
    res.json({ success: false, message: '邮箱或密码错误' });
    return;
  }
  const session = createSession(user.id, { userAgent: req.headers['user-agent'] });
  store.sessions.push(session);
  trimUserSessions(store, user.id);
  await writeAuthStore(store);
  res.json({ success: true, token: session.token, user: toPublicUser(user) });
}));

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  const token = readTokenFromRequest(req);
  if (!token) {
    res.json({ success: true, message: '已退出登录' });
    return;
  }
  const store = await readAuthStore();
  store.sessions = store.sessions.filter((item) => item.token !== token);
  await writeAuthStore(store);
  res.json({ success: true, message: '已退出登录' });
}));

app.post('/api/auth/logout-all', asyncRoute(async (req, res) => {
  const token = readTokenFromRequest(req);
  const auth = await findUserByToken(token);
  if (!auth) {
    res.json({ success: false, message: '登录状态已失效，请重新登录' });
    return;
  }
  auth.store.sessions = auth.store.sessions.filter((item) => item.user_id !== auth.user.id);
  await writeAuthStore(auth.store);
  res.json({ success: true, message: '已退出该账号在所有设备上的登录' });
}));

app.get('/api/auth/me', asyncRoute(async (req, res) => {
  const token = readTokenFromRequest(req);
  const auth = await findUserByToken(token);
  if (!auth) {
    res.json({ user: null });
    return;
  }
  const touchedAt = new Date().toISOString();
  if (touchSession(auth.store, auth.token, touchedAt)) {
    await writeAuthStore(auth.store);
  }
  res.json({ user: toPublicUser(auth.user) });
}));

app.patch('/api/auth/profile', asyncRoute(async (req, res) => {
  const token = readTokenFromRequest(req);
  const auth = await findUserByToken(token);
  if (!auth) {
    res.json({ success: false, message: '登录状态已失效，请重新登录' });
    return;
  }

  const displayName = String(req.body?.displayName ?? auth.user.display_name ?? '').trim();
  if (!displayName) {
    res.json({ success: false, message: '昵称不能为空' });
    return;
  }

  auth.user.display_name = displayName;
  auth.user.company = String(req.body?.company ?? auth.user.company ?? '').trim();
  auth.user.phone = String(req.body?.phone ?? auth.user.phone ?? '').trim();
  auth.user.updated_at = new Date().toISOString();
  touchSession(auth.store, auth.token, auth.user.updated_at);
  await writeAuthStore(auth.store);
  res.json({ success: true, user: toPublicUser(auth.user) });
}));

app.post('/api/auth/change-password', asyncRoute(async (req, res) => {
  const token = readTokenFromRequest(req);
  const auth = await findUserByToken(token);
  if (!auth) {
    res.json({ success: false, message: '登录状态已失效，请重新登录' });
    return;
  }

  const oldPassword = String(req.body?.oldPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!oldPassword || !newPassword) {
    res.json({ success: false, message: '请输入旧密码和新密码' });
    return;
  }
  if (auth.user.password_hash !== sha256(oldPassword)) {
    res.json({ success: false, message: '旧密码不正确' });
    return;
  }
  if (newPassword.length < 6) {
    res.json({ success: false, message: '新密码至少 6 位' });
    return;
  }
  if (oldPassword === newPassword) {
    res.json({ success: false, message: '新密码不能与旧密码相同' });
    return;
  }

  auth.user.password_hash = sha256(newPassword);
  auth.user.updated_at = new Date().toISOString();
  auth.store.sessions = auth.store.sessions.filter((item) => item.user_id !== auth.user.id || item.token === auth.token);
  touchSession(auth.store, auth.token, auth.user.updated_at);
  await writeAuthStore(auth.store);
  res.json({ success: true, message: '密码修改成功，其他设备已自动退出' });
}));

app.get('/api/auth/sessions', asyncRoute(async (req, res) => {
  const token = readTokenFromRequest(req);
  const auth = await findUserByToken(token);
  if (!auth) {
    res.json({ success: false, message: '登录状态已失效，请重新登录', sessions: [] });
    return;
  }
  const touchedAt = new Date().toISOString();
  touchSession(auth.store, auth.token, touchedAt);
  await writeAuthStore(auth.store);
  const sessions = listUserSessions(auth.store, auth.user.id, auth.token);
  res.json({ success: true, sessions });
}));

app.post('/api/auth/avatar', avatarUpload.single('avatar'), asyncRoute(async (req, res) => {
  const token = readTokenFromRequest(req);
  const auth = await findUserByToken(token);
  if (!auth) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.json({ success: false, message: '登录状态已失效，请重新登录' });
    return;
  }
  if (!req.file?.path) {
    res.json({ success: false, message: '未选择头像文件' });
    return;
  }

  const ext = path.extname(req.file.path || '').toLowerCase();
  const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
  if (!allowed.has(ext)) {
    fs.unlinkSync(req.file.path);
    res.json({ success: false, message: '仅支持 png/jpg/webp/gif 图片' });
    return;
  }

  const nextAvatarName = path.basename(req.file.path);
  if (auth.user.avatar_filename) {
    await blobStore.remove(`avatars/${auth.user.avatar_filename}`).catch(() => undefined);
  }

  await blobStore.putFile(`avatars/${nextAvatarName}`, req.file.path, req.file.mimetype || 'application/octet-stream');
  if (fs.existsSync(req.file.path)) {
    fs.unlinkSync(req.file.path);
  }

  auth.user.avatar_filename = nextAvatarName;
  auth.user.updated_at = new Date().toISOString();
  touchSession(auth.store, auth.token, auth.user.updated_at);
  await writeAuthStore(auth.store);
  res.json({ success: true, user: toPublicUser(auth.user) });
}));

app.get('/api/auth/avatar/:filename', asyncRoute(async (req, res) => {
  const safeName = path.basename(String(req.params.filename || ''));
  if (!safeName) {
    res.status(404).send('avatar not found');
    return;
  }
  const key = `avatars/${safeName}`;
  const exists = await blobStore.exists(key);
  if (!exists) {
    const legacyPath = path.join(AVATAR_ROOT, safeName);
    if (fs.existsSync(legacyPath)) {
      const legacyContentType = mime.lookup(safeName) || 'application/octet-stream';
      res.setHeader('Content-Type', String(legacyContentType));
      res.sendFile(legacyPath);
      return;
    }
    res.status(404).send('avatar not found');
    return;
  }
  const buffer = await blobStore.getBuffer(key);
  const contentType = mime.lookup(safeName) || 'application/octet-stream';
  res.setHeader('Content-Type', String(contentType));
  res.send(buffer);
}));

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) {
    next();
    return;
  }
  if (req.path === '/version') {
    next();
    return;
  }
  Promise.resolve(requireUserContext(req, res, next)).catch(next);
});

app.get('/api/config', (req, res) => {
  const context = getRequestUserContext(req);
  res.json(context.configStore.load());
});

app.post('/api/config', (req, res) => {
  const context = getRequestUserContext(req);
  const result = context.configStore.save(req.body || {});
  res.json(result);
});

app.post('/api/config/list-models', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const data = await context.aiService.listModels(req.body || context.configStore.load());
  res.json(data);
}));

app.get('/api/config/open-folder', (req, res) => {
  const context = getRequestUserContext(req);
  res.json({ success: true, path: context.appShim.getPath('userData') });
});

app.post('/api/ai/chat', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const content = await context.aiService.chat(req.body || {});
  res.json({ content });
}));

app.post('/api/ai/request-json', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const data = await context.aiService.requestJson(req.body || {});
  res.json({ data });
}));

app.post('/api/ai/stream-chat', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const writeEvent = (event) => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    await context.aiService.streamChat(req.body || {}, (event) => {
      writeEvent(event);
    });
    writeEvent({ type: 'done', message: '流式输出完成' });
  } catch (error) {
    writeEvent({ type: 'error', message: error.message || '流式请求失败' });
  } finally {
    res.end();
  }
}));

app.post('/api/ai/test-image-model', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const data = await context.aiService.testImageModel(req.body || context.configStore.load());
  res.json(data);
}));

app.post('/api/file/import-document', upload.single('file'), asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  if (!req.file?.path) {
    res.json({ success: false, message: '未选择文件' });
    return;
  }

  const config = context.configStore.load();
  const filePath = req.file.path;
  const originalName = normalizeUploadedFilename(req.file.originalname || path.basename(filePath));
  const parser = resolveFileParser(config, filePath);
  const projectId = normalizeProjectId(parseProjectId(req));

  if (!parser.supported) {
    res.json({
      success: false,
      message: `当前${parserLabels[parser.requestedProvider] || '解析方式'}不支持该文件格式`,
      file_name: originalName,
      parser_provider: parser.requestedProvider,
      parser_label: parserLabels[parser.requestedProvider] || '本地解析',
    });
    return;
  }

  let markdown = '';
  try {
    markdown = (await parseDocumentWithConfig(context.appShim, filePath, config, {
      assetScope: projectId ? `technical-plan-${projectId}` : 'technical-plan',
      preserveImages: false,
    })).trim();
  } catch (error) {
    res.json({
      success: false,
      message: `文件解析失败：${error.message || String(error)}`,
      file_name: originalName,
      parser_provider: parser.provider,
      parser_label: parserLabels[parser.provider] || '本地解析',
    });
    return;
  }

  if (!markdown) {
    res.json({
      success: false,
      message: '未提取到有效 Markdown 内容，请检查文件内容',
      file_name: originalName,
      parser_provider: parser.provider,
      parser_label: parserLabels[parser.provider] || '本地解析',
    });
    return;
  }

  res.json({
    success: true,
    message: parser.fallbackToLocal ? '文件解析完成，当前格式已自动使用本地解析' : '文件解析完成',
    file_name: originalName,
    file_content: markdown,
    parser_provider: parser.provider,
    parser_label: parserLabels[parser.provider] || '本地解析',
  });
}));

app.post('/api/files/register', upload.array('files', 200), asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const userId = context?.userId || req?.auth?.user?.id || '';
  const files = Array.isArray(req.files) ? req.files : [];
  const supportedFiles = files.filter((file) => {
    const originalName = normalizeUploadedFilename(file.originalname || file.path);
    return duplicateCheckSupportedExtensions.has(path.extname(originalName || file.path).toLowerCase());
  });
  const selections = [];
  for (const file of supportedFiles) {
    const selection = createLocalFileSelection(
      file.path,
      normalizeUploadedFilename(file.originalname || path.basename(file.path))
    );
    if (RUNTIME_CONFIG.drivers.blob === 'minio') {
      const blobKey = createUploadBlobKey(userId, selection);
      try {
        await blobStore.putFile(blobKey, file.path, file.mimetype || 'application/octet-stream');
        selection.blob_key = blobKey;
      } catch (error) {
        console.warn('[bidmind-web-api] 上传文件镜像到 MinIO 失败', error?.message || error);
      }
    }
    selections.push(selection);
  }
  res.json({
    success: Boolean(selections.length),
    message: selections.length ? `已选择 ${selections.length} 个文件` : (files.length ? '未选择支持的文件类型' : '未选择文件'),
    files: selections,
  });
}));

app.get('/api/workspace/technical-plan', (_req, res) => {
  const context = getRequestUserContext(_req);
  const projectId = normalizeProjectId(parseProjectId(_req));
  res.json({ state: context.workspaceStore.loadTechnicalPlan(projectId) });
});

app.get('/api/workspace/technical-plan-summary', (_req, res) => {
  const context = getRequestUserContext(_req);
  const projectId = normalizeProjectId(parseProjectId(_req));
  res.json({ state: context.workspaceStore.loadTechnicalPlanSummary(projectId) });
});

app.post('/api/workspace/technical-plan', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const result = context.workspaceStore.saveTechnicalPlan(req.body || null, projectId);
  res.json(result);
});

app.patch('/api/workspace/technical-plan', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const next = context.workspaceStore.updateTechnicalPlan(req.body || {}, projectId);
  res.json({ state: next });
});

app.delete('/api/workspace/technical-plan', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const result = context.workspaceStore.clearTechnicalPlan(projectId);
  res.json(result);
});

app.get('/api/workspace/business-bid', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  res.json({ state: context.workspaceStore.loadBusinessBid(projectId) });
});

app.post('/api/workspace/business-bid', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const result = context.workspaceStore.saveBusinessBid(req.body || null, projectId);
  res.json(result);
});

app.patch('/api/workspace/business-bid', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const next = context.workspaceStore.updateBusinessBid(req.body || {}, projectId);
  res.json({ state: next });
});

app.delete('/api/workspace/business-bid', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const result = context.workspaceStore.clearBusinessBid(projectId);
  res.json(result);
});

app.get('/api/workspace/duplicate-check', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  res.json({ state: context.workspaceStore.loadDuplicateCheck(projectId) });
});

app.post('/api/workspace/duplicate-check', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const result = context.workspaceStore.saveDuplicateCheck(req.body || null, projectId);
  res.json(result);
});

app.patch('/api/workspace/duplicate-check', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const next = context.workspaceStore.updateDuplicateCheck(req.body || {}, projectId);
  res.json({ state: next });
});

app.delete('/api/workspace/duplicate-check', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const result = context.workspaceStore.clearDuplicateCheck(projectId);
  res.json(result);
});

app.get('/api/workspace/rejection-check', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  res.json({ state: context.workspaceStore.loadRejectionCheck(projectId) });
});

app.post('/api/workspace/rejection-check', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const result = context.workspaceStore.saveRejectionCheck(req.body || null, projectId);
  res.json(result);
});

app.patch('/api/workspace/rejection-check', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const next = context.workspaceStore.updateRejectionCheck(req.body || {}, projectId);
  res.json({ state: next });
});

app.delete('/api/workspace/rejection-check', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const result = context.workspaceStore.clearRejectionCheck(projectId);
  res.json(result);
});

app.get('/api/workspace/bid-opportunity', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  res.json({ state: context.workspaceStore.loadBidOpportunity(projectId) });
});

app.post('/api/workspace/bid-opportunity', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const result = context.workspaceStore.saveBidOpportunity(req.body || null, projectId);
  res.json(result);
});

app.patch('/api/workspace/bid-opportunity', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const next = context.workspaceStore.updateBidOpportunity(req.body || {}, projectId);
  res.json({ state: next });
});

app.delete('/api/workspace/bid-opportunity', (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const result = context.workspaceStore.clearBidOpportunity(projectId);
  res.json(result);
});

app.get('/api/workspace/projects', (_req, res) => {
  const context = getRequestUserContext(_req);
  res.json({ state: context.workspaceStore.loadProjects() });
});

app.post('/api/workspace/projects', (req, res) => {
  const context = getRequestUserContext(req);
  const result = context.workspaceStore.saveProjects(req.body || null);
  res.json(result);
});

app.patch('/api/workspace/projects', (req, res) => {
  const context = getRequestUserContext(req);
  const next = context.workspaceStore.updateProjects(req.body || {});
  res.json({ state: next });
});

app.delete('/api/workspace/projects', (_req, res) => {
  const context = getRequestUserContext(_req);
  const result = context.workspaceStore.clearProjects();
  res.json(result);
});

app.post('/api/tasks/start-bid-analysis', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const task = await context.taskService.startBidAnalysis({ ...(req.body || {}), project_id: normalizeProjectId(parseProjectId(req)) });
  res.json(task);
}));

app.post('/api/tasks/start-outline-generation', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const task = await context.taskService.startOutlineGeneration({ ...(req.body || {}), project_id: normalizeProjectId(parseProjectId(req)) });
  res.json(task);
}));

app.post('/api/tasks/start-content-generation', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const task = await context.taskService.startContentGeneration({ ...(req.body || {}), project_id: normalizeProjectId(parseProjectId(req)) });
  res.json(task);
}));

app.get('/api/tasks/active', (_req, res) => {
  const context = getRequestUserContext(_req);
  res.json({ tasks: context.taskService.getActiveTasks() });
});

app.get('/api/knowledge/list', (_req, res) => {
  const context = getRequestUserContext(_req);
  res.json(context.knowledgeBaseService.list());
});

app.post('/api/knowledge/folders', (req, res) => {
  const context = getRequestUserContext(req);
  const folder = context.knowledgeBaseService.createFolder(req.body?.name || '未命名文件夹');
  res.json(folder);
});

app.patch('/api/knowledge/folders/:folderId', (req, res) => {
  const context = getRequestUserContext(req);
  const folder = context.knowledgeBaseService.renameFolder(req.params.folderId, req.body?.name || '未命名文件夹');
  res.json(folder);
});

app.delete('/api/knowledge/folders/:folderId', (req, res) => {
  const context = getRequestUserContext(req);
  const result = context.knowledgeBaseService.deleteFolder(req.params.folderId);
  res.json(result);
});

app.delete('/api/knowledge/documents/:documentId', (req, res) => {
  const context = getRequestUserContext(req);
  const result = context.knowledgeBaseService.deleteDocument(req.params.documentId);
  res.json(result);
});

app.post('/api/knowledge/upload-documents', upload.array('files', 200), asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const folderId = String(req.body?.folderId || '');
  const files = Array.isArray(req.files) ? req.files : [];
  const uploadedFiles = files.map((file) => ({
    filePath: file.path,
    fileName: normalizeUploadedFilename(file.originalname || path.basename(file.path)),
  }));
  const result = context.knowledgeBaseService.uploadDocumentsByPaths(folderId, uploadedFiles, context.bridgeWebContents);
  res.json(result);
}));

app.post('/api/knowledge/start-matching', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const result = context.knowledgeBaseService.startMatching(
    String(req.body?.documentId || ''),
    Number(req.body?.batchSize || 20),
    context.bridgeWebContents
  );
  res.json(result);
}));

app.get('/api/knowledge/documents/:documentId/markdown', (req, res) => {
  const context = getRequestUserContext(req);
  const data = context.knowledgeBaseService.readMarkdown(req.params.documentId);
  res.json({ markdown: data });
});

app.get('/api/knowledge/documents/:documentId/items', (req, res) => {
  const context = getRequestUserContext(req);
  const data = context.knowledgeBaseService.readItems(req.params.documentId);
  res.json({ items: data });
});

app.get('/api/knowledge/documents/:documentId/analysis', (req, res) => {
  const context = getRequestUserContext(req);
  const data = context.knowledgeBaseService.readAnalysis(req.params.documentId);
  res.json({ analysis: data });
});

app.post('/api/duplicate/start-metadata-analysis', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const projectId = normalizeProjectId(parseProjectId(req));
  const payload = await ensureDuplicatePayloadFiles(
    { ...(req.body || {}), project_id: projectId },
    context?.userId || ''
  );
  const result = await context.duplicateCheckService.startMetadataAnalysis(payload, context.bridgeWebContents);
  res.json(result);
}));

app.get('/api/duplicate/project-summaries', asyncRoute(async (_req, res) => {
  const context = getRequestUserContext(_req);
  const projectsState = context.workspaceStore.loadProjects() || { projects: [] };
  const projects = normalizeManagedProjects(projectsState);
  const summaries = projects.map((project) => {
    const duplicateState = context.workspaceStore.loadDuplicateCheck(project.id) || {};
    const summary = parseDuplicateHistorySummary(duplicateState);
    return {
      project_id: project.id,
      project_name: project.name,
      project_code: project.code,
      workbench: project.workbench,
      status: project.status,
      updated_at: project.updated_at,
      history_count: summary.history_count,
      last_checked_at: summary.last_checked_at,
      current_result_status: summary.current_result_status,
    };
  });
  res.json({ projects: summaries });
}));

app.post('/api/export/word', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const payload = req.body || {};
  const requestId = String(payload.requestId || createId('export'));
  const warnings = [];

  await pushUserEvent(context, 'export', {
    requestId,
    phase: 'running',
    progress: 2,
    message: '正在准备导出 Word。',
    warnings,
  });

  const result = await buildDocxResult(payload, {
    warnings,
    onProgress: (event) => {
      void pushUserEvent(context, 'export', {
        requestId,
        phase: event.phase || 'running',
        progress: event.progress,
        message: event.message,
        warnings: event.warnings || warnings,
      });
    },
  });

  const fileName = `${sanitizeFilename(payload.project_name || '标书文档')}.docx`;
  const token = createId('docx');
  const exportKey = `exports/${normalizeUserPathSegment(context.userId)}/${token}.docx`;
  await blobStore.putBuffer(
    exportKey,
    result.buffer,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  const message = result.warnings.length
    ? `Word 已导出，但有 ${result.warnings.length} 处图片未能插入，请核对文档。`
    : 'Word 已导出，请核对文档版式。';

  await pushUserEvent(context, 'export', {
    requestId,
    phase: 'success',
    progress: 100,
    message,
    warnings: result.warnings,
  });

  res.json({
    success: true,
    message,
    warnings: result.warnings,
    file_token: token,
    file_name: fileName,
  });
}));

app.get('/api/export/download/:token/:fileName?', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const token = String(req.params.token || '');
  const exportKey = `exports/${normalizeUserPathSegment(context.userId)}/${token}.docx`;
  const exists = await blobStore.exists(exportKey);
  if (!exists) {
    res.status(404).json({ message: '文件不存在' });
    return;
  }

  const fileName = sanitizeFilename(req.params.fileName || '标书文档.docx');
  const buffer = await blobStore.getBuffer(exportKey);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.send(buffer);
}));

function resolveAssetPath(appShim, assetUrl) {
  const parsed = new URL(assetUrl);
  const host = parsed.hostname;
  const relativePath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const baseDir = host === 'generated-images'
    ? getGeneratedImagesDir(appShim || legacyAppShim)
    : host === 'imported-images'
      ? getImportedImagesDir(appShim || legacyAppShim)
      : '';

  if (!baseDir) {
    return '';
  }

  const safeBase = path.resolve(baseDir);
  const resolved = path.resolve(safeBase, relativePath);
  if (resolved !== safeBase && !resolved.startsWith(`${safeBase}${path.sep}`)) {
    return '';
  }
  return resolved;
}

app.get('/api/assets', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const src = String(req.query.src || '');
  if (!src.startsWith('bidmind-asset://')) {
    res.status(400).send('invalid asset source');
    return;
  }

  const filePath = resolveAssetPath(context.appShim, src);
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).send('asset not found');
    return;
  }

  res.sendFile(filePath);
}));

app.get('/api/events/:channel', asyncRoute(async (req, res) => {
  const context = getRequestUserContext(req);
  const channel = String(req.params.channel || '');
  const since = Number(req.query.since || 0);
  if (!EVENT_CHANNELS.includes(channel)) {
    res.status(404).json({ message: 'unknown channel' });
    return;
  }

  const events = await readUserEvents(context, channel, Number.isFinite(since) ? since : 0);
  res.json({ events });
}));

app.use((error, req, res, _next) => {
  if (error?.type === 'request.aborted' || error?.code === 'ECONNABORTED') {
    console.warn('[bidmind-web-api] request aborted', {
      method: req?.method,
      url: req?.originalUrl || req?.url,
      expected: Number(error?.expected || error?.length || 0),
      received: Number(error?.received || 0),
    });
    if (!res.headersSent) {
      res.status(499).json({
        success: false,
        message: '请求已取消',
      });
    }
    return;
  }

  if (error?.type === 'entity.too.large') {
    if (!res.headersSent) {
      res.status(413).json({
        success: false,
        message: '请求体过大，请减少单次提交内容',
      });
    }
    return;
  }

  console.error('[bidmind-web-api] error', error);
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      message: error?.message || '服务器内部错误',
    });
  }
});

async function cleanupTempExports() {
  try {
    const userIds = await fsp.readdir(USERS_ROOT).catch(() => []);
    await Promise.all(userIds.map(async (userId) => {
      const exportRoot = path.join(USERS_ROOT, userId, 'exports');
      if (!fs.existsSync(exportRoot)) {
        return;
      }
      const files = await fsp.readdir(exportRoot);
      await Promise.all(files
        .filter((file) => file.endsWith('.docx'))
        .map((file) => fsp.rm(path.join(exportRoot, file), { force: true })));
    }));
  } catch {
    // ignore cleanup errors
  }
}

async function flushStatePersistenceQueues() {
  const tasks = Array.from(userStatePersistence.values())
    .map((item) => (typeof item?.flush === 'function' ? item.flush().catch(() => undefined) : Promise.resolve()));
  await Promise.all(tasks);
}

if (require.main === module) {
  logRuntimeStorageConfig();
  const server = app.listen(PORT, () => {
    console.log(`[bidmind-web-api] listening on http://0.0.0.0:${PORT}`);
  });

  process.on('SIGINT', async () => {
    await flushStatePersistenceQueues();
    await cleanupTempExports();
    server.close(() => {
      process.exit(0);
    });
  });
}

module.exports = app;
