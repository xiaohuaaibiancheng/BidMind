import type {
  AiStreamEvent,
  ChatCompletionRequest,
  ClientConfig,
  DuplicateCheckProjectSummary,
  ConfigSaveResult,
  DuplicateCheckWorkspaceState,
  FileImportResult,
  FileSelectionResult,
  JsonCompletionRequest,
  LatestReleaseInfo,
  UpdateCheckResult,
  BidMindBridge,
  WordExportProgressEvent,
  WordExportResult,
} from '../shared/types';
import type { BusinessBidWorkspaceState } from '../features/business-bid/types';
import type { KnowledgeItem } from '../features/knowledge-base/types';
import type { ProjectWorkspaceState } from '../features/project-management/types';
import type { RejectionCheckWorkspaceState } from '../features/rejection-check/types';
import type { BidOpportunityWorkspaceState } from '../features/bid-opportunity/types';
import type { AuthResult, UserProfile, UserSessionInfo } from '../features/user-center/types';

const API_BASE = String(import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const USER_TOKEN_KEY = 'bidmind:web:user-token';
const EVENT_POLL_INTERVAL = 1000;
const EVENT_POLL_INTERVAL_BY_CHANNEL: Record<'tasks' | 'knowledge' | 'duplicate' | 'export', number> = {
  tasks: 480,
  knowledge: EVENT_POLL_INTERVAL,
  duplicate: EVENT_POLL_INTERVAL,
  export: 400,
};
const localDocumentExtensions = ['.txt', '.md', '.markdown', '.docx', '.pdf', '.doc', '.wps'];
const mineruAgentDocumentExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp', '.xls', '.xlsx'];
const mineruAccurateDocumentExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp', '.html'];
const WORKSPACE_KEY = 'bidmind:client:workspace:v1';

let cachedConfig: ClientConfig | null = null;

function apiUrl(path: string) {
  if (!API_BASE) {
    return path;
  }
  return `${API_BASE}${path}`;
}

function getStoredUserToken() {
  try {
    return localStorage.getItem(USER_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function createAuthHeader(): Record<string, string> {
  const token = getStoredUserToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(text || `请求失败（${response.status}）`);
    }
  }

  if (!response.ok) {
    const message = (data as { message?: string } | null)?.message || `请求失败（${response.status}）`;
    throw new Error(message);
  }

  return (data || {}) as T;
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...createAuthHeader(),
      ...(options.headers || {}),
    },
  });
  return parseJsonResponse<T>(response);
}

function toErrorMessage(error: unknown, fallback = '请求失败') {
  if (error instanceof Error) return error.message;
  return fallback;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function uniqueExtensions(values: string[]) {
  return Array.from(new Set(values.map((item) => item.toLowerCase())));
}

function getDocumentAcceptFromCachedConfig() {
  const provider = cachedConfig?.file_parser?.provider;
  if (provider === 'mineru-agent-api') {
    return uniqueExtensions([...mineruAgentDocumentExtensions, ...localDocumentExtensions]).join(',');
  }
  if (provider === 'mineru-accurate-api') {
    return uniqueExtensions([...mineruAccurateDocumentExtensions, ...localDocumentExtensions]).join(',');
  }
  return localDocumentExtensions.join(',');
}

function pickLocalFiles(options?: { multiple?: boolean; accept?: string }) {
  return new Promise<File[] | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = options?.accept || getDocumentAcceptFromCachedConfig();
    input.multiple = Boolean(options?.multiple);
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    input.style.opacity = '0';

    let settled = false;
    let focusFallbackArmed = false;
    let fallbackResolveTimer: number | null = null;
    const armFocusFallbackTimer = window.setTimeout(() => {
      focusFallbackArmed = true;
    }, 300);

    const readFiles = () => (input.files ? Array.from(input.files) : []);
    const cleanup = () => {
      window.clearTimeout(armFocusFallbackTimer);
      if (fallbackResolveTimer !== null) {
        window.clearTimeout(fallbackResolveTimer);
        fallbackResolveTimer = null;
      }
      input.removeEventListener('change', handleChange);
      input.removeEventListener('cancel', handleCancel);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.setTimeout(() => input.remove(), 0);
    };

    const finalize = (files: File[] | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(files && files.length ? files : null);
    };

    function handleChange() {
      finalize(readFiles());
    }

    function handleCancel() {
      finalize(null);
    }

    function finalizeAfterDialogClosed() {
      if (!focusFallbackArmed || settled) return;
      // Some filesystems (e.g. iCloud/Downloads with larger files) may update
      // input.files noticeably later than the focus event. Poll briefly to avoid
      // false "已取消选择" while still keeping a cancellation fallback.
      const maxAttempts = 40;
      const intervalMs = 120;
      let attempts = 0;
      const poll = () => {
        if (settled) return;
        const files = readFiles();
        if (files.length > 0) {
          finalize(files);
          return;
        }
        if (attempts >= maxAttempts) {
          finalize(null);
          return;
        }
        attempts += 1;
        fallbackResolveTimer = window.setTimeout(poll, intervalMs);
      };
      poll();
    }

    function handleWindowFocus() {
      finalizeAfterDialogClosed();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        finalizeAfterDialogClosed();
      }
    }

    input.addEventListener('change', handleChange);
    input.addEventListener('cancel', handleCancel);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    document.body.appendChild(input);
    input.click();
  });
}

async function uploadFiles(files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file, file.name));
  return requestJson<FileSelectionResult>(withProjectId('/api/files/register'), {
    method: 'POST',
    body: formData,
  });
}

function subscribeEventChannel<TPayload>(channel: 'tasks' | 'knowledge' | 'duplicate' | 'export', callback: (payload: TPayload) => void) {
  let active = true;
  let since = 0;
  const interval = EVENT_POLL_INTERVAL_BY_CHANNEL[channel] || EVENT_POLL_INTERVAL;

  const pull = async () => {
    if (!active) return;

    try {
      const result = await requestJson<{ events: Array<{ id: number; payload: TPayload }> }>(`/api/events/${channel}?since=${since}`);
      const events = Array.isArray(result.events) ? result.events : [];
      if (channel === 'tasks' && events.length > 1) {
        const latestByTaskKey = new Map<string, { id: number; payload: TPayload }>();
        events.forEach((event) => {
          const payload = event.payload as { project_id?: string; task?: { type?: string } } | null;
          const projectId = String(payload?.project_id || '');
          const taskType = String(payload?.task?.type || '');
          const key = `${projectId}:${taskType}`;
          const current = latestByTaskKey.get(key);
          if (!current || current.id < event.id) {
            latestByTaskKey.set(key, event);
          }
        });
        Array.from(latestByTaskKey.values())
          .sort((a, b) => a.id - b.id)
          .forEach((event) => {
            since = Math.max(since, event.id);
            callback(event.payload);
          });
        return;
      }
      events.forEach((event) => {
        since = Math.max(since, event.id);
        callback(event.payload);
      });
    } catch {
      // 事件轮询失败不打断主流程，下次轮询继续。
    }
  };

  void pull();
  const timer = window.setInterval(() => {
    void pull();
  }, interval);

  return () => {
    active = false;
    window.clearInterval(timer);
  };
}

function createDisabledUpdateResult(message: string): UpdateCheckResult {
  return {
    enabled: false,
    updateAvailable: false,
    message,
  };
}

function getActiveProjectId() {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { activeProjectId?: string } | null;
    return String(parsed?.activeProjectId || '').trim();
  } catch {
    return '';
  }
}

function withProjectId(path: string) {
  const projectId = getActiveProjectId();
  if (!projectId) {
    return path;
  }
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}projectId=${encodeURIComponent(projectId)}`;
}

function withProjectPayload<T extends Record<string, unknown>>(payload: T): T & { project_id?: string } {
  const projectId = getActiveProjectId();
  if (!projectId) {
    return payload;
  }
  return {
    ...payload,
    project_id: projectId,
  };
}

function createBridge(): BidMindBridge {
  return {
    appName: 'BidMind（Web）',
    platform: 'web',

    async getVersion() {
      const result = await requestJson<{ version: string }>('/api/version');
      return result.version || '0.1.0-web';
    },

    async getLatestVersion(): Promise<LatestReleaseInfo> {
      const version = await this.getVersion();
      return {
        version,
        name: `v${version}`,
        body: '网页端不支持自动更新，请直接替换部署版本。',
        published_at: new Date().toISOString(),
        html_url: '',
      };
    },

    async openExternal(url: string) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return { success: true };
    },

    async checkUpdate() {
      return createDisabledUpdateResult('网页端不支持自动更新检查');
    },

    async startUpdate() {
      return createDisabledUpdateResult('网页端不支持自动更新');
    },

    async quitAndInstall() {
      return undefined;
    },

    onUpdateProgress() {
      return () => undefined;
    },

    onUpdateDownloaded() {
      return () => undefined;
    },

    onUpdateError() {
      return () => undefined;
    },

    config: {
      async load() {
        const config = await requestJson<ClientConfig>('/api/config');
        cachedConfig = config;
        return config;
      },

      async save(config: ClientConfig) {
        const result = await requestJson<ConfigSaveResult>('/api/config', {
          method: 'POST',
          body: JSON.stringify(config),
        });
        cachedConfig = config;
        return result;
      },

      async listModels(config?: ClientConfig) {
        return requestJson('/api/config/list-models', {
          method: 'POST',
          body: JSON.stringify(config || null),
        });
      },

      async openConfigFolder() {
        return requestJson('/api/config/open-folder');
      },
    },

    ai: {
      async chat(request: ChatCompletionRequest) {
        const data = await requestJson<{ content: string }>('/api/ai/chat', {
          method: 'POST',
          body: JSON.stringify(request),
        });
        return data.content || '';
      },

      async requestJson<TResult = unknown>(request: JsonCompletionRequest) {
        const data = await requestJson<{ data: TResult }>('/api/ai/request-json', {
          method: 'POST',
          body: JSON.stringify(request),
        });
        return data.data;
      },

      async testImageModel(config) {
        return requestJson('/api/ai/test-image-model', {
          method: 'POST',
          body: JSON.stringify(config),
        });
      },

      streamChat(request, onEvent) {
        const controller = new AbortController();
        let canceled = false;

        void (async () => {
          try {
            const response = await fetch(apiUrl('/api/ai/stream-chat'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...createAuthHeader(),
              },
              body: JSON.stringify(request),
              signal: controller.signal,
            });

            if (!response.ok || !response.body) {
              const message = await response.text().catch(() => response.statusText || '流式请求失败');
              throw new Error(message || '流式请求失败');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (!canceled) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() || '';

              lines.forEach((line) => {
                const text = line.trim();
                if (!text) return;
                try {
                  const event = JSON.parse(text) as AiStreamEvent;
                  onEvent(event);
                } catch {
                  onEvent({ type: 'progress', message: text });
                }
              });
            }

            if (!canceled) {
              onEvent({ type: 'done', message: '流式输出完成' });
            }
          } catch (error) {
            if (!canceled) {
              onEvent({ type: 'error', message: toErrorMessage(error, '流式请求失败') });
            }
          }
        })();

        return () => {
          canceled = true;
          controller.abort();
        };
      },
    },

    file: {
      async importDocument(): Promise<FileImportResult> {
        const files = await pickLocalFiles({
          multiple: false,
          accept: getDocumentAcceptFromCachedConfig(),
        });
        if (!files?.length) {
          return { success: false, message: '已取消选择' };
        }

        const formData = new FormData();
        formData.append('file', files[0], files[0].name);
        return requestJson(withProjectId('/api/file/import-document'), {
          method: 'POST',
          body: formData,
        });
      },

      async importDocumentFile(file: File): Promise<FileImportResult> {
        const formData = new FormData();
        formData.append('file', file, file.name);
        return requestJson(withProjectId('/api/file/import-document'), {
          method: 'POST',
          body: formData,
        });
      },

      async selectDuplicateCheckFiles(options?: { multiple?: boolean }): Promise<FileSelectionResult> {
        const files = await pickLocalFiles({
          multiple: options?.multiple !== false,
          accept: '.doc,.docx,.wps,.pdf,.md,.markdown',
        });

        if (!files?.length) {
          return { success: false, message: '已取消选择', files: [] };
        }

        return uploadFiles(files);
      },

      async selectDuplicateCheckFileList(files: File[]): Promise<FileSelectionResult> {
        if (!files?.length) {
          return { success: false, message: '未选择文件', files: [] };
        }

        return uploadFiles(files);
      },
    },

    knowledgeBase: {
      async list() {
        return requestJson('/api/knowledge/list');
      },

      async createFolder(name: string) {
        return requestJson('/api/knowledge/folders', {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
      },

      async renameFolder(folderId: string, name: string) {
        return requestJson(`/api/knowledge/folders/${encodeURIComponent(folderId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
      },

      async deleteFolder(folderId: string) {
        return requestJson(`/api/knowledge/folders/${encodeURIComponent(folderId)}`, {
          method: 'DELETE',
        });
      },

      async deleteDocument(documentId: string) {
        return requestJson(`/api/knowledge/documents/${encodeURIComponent(documentId)}`, {
          method: 'DELETE',
        });
      },

      async uploadDocuments(folderId: string) {
        const files = await pickLocalFiles({
          multiple: true,
          accept: '.doc,.docx,.wps,.pdf,.md,.markdown',
        });

        if (!files?.length) {
          return { success: false, message: '已取消选择' };
        }

        const formData = new FormData();
        formData.append('folderId', folderId);
        files.forEach((file) => formData.append('files', file, file.name));

        return requestJson('/api/knowledge/upload-documents', {
          method: 'POST',
          body: formData,
        });
      },

      async uploadDocumentFiles(folderId: string, files: File[]) {
        if (!files?.length) {
          return { success: false, message: '未选择文档' };
        }

        const formData = new FormData();
        formData.append('folderId', folderId);
        files.forEach((file) => formData.append('files', file, file.name));

        return requestJson('/api/knowledge/upload-documents', {
          method: 'POST',
          body: formData,
        });
      },

      async startMatching(documentId: string, batchSize: number) {
        return requestJson('/api/knowledge/start-matching', {
          method: 'POST',
          body: JSON.stringify({ documentId, batchSize }),
        });
      },

      async readMarkdown(documentId: string) {
        const data = await requestJson<{ markdown: string }>(`/api/knowledge/documents/${encodeURIComponent(documentId)}/markdown`);
        return data.markdown || '';
      },

      async readItems(documentId: string) {
        const data = await requestJson<{ items: KnowledgeItem[] }>(`/api/knowledge/documents/${encodeURIComponent(documentId)}/items`);
        return data.items || ([] as KnowledgeItem[]);
      },

      async readAnalysis(documentId: string) {
        const data = await requestJson<{ analysis: unknown }>(`/api/knowledge/documents/${encodeURIComponent(documentId)}/analysis`);
        return data.analysis as never;
      },

      onEvent(callback) {
        return subscribeEventChannel('knowledge', (payload) => callback((payload as { document: unknown }) as never));
      },
    },

    duplicateCheck: {
      async startMetadataAnalysis(payload) {
        return requestJson('/api/duplicate/start-metadata-analysis', {
          method: 'POST',
          body: JSON.stringify(withProjectPayload(payload || {})),
        });
      },

      async listProjectSummaries() {
        return requestJson<{ projects: DuplicateCheckProjectSummary[] }>('/api/duplicate/project-summaries');
      },

      onEvent(callback) {
        return subscribeEventChannel('duplicate', (payload) => callback(payload as never));
      },
    },

    workspace: {
      async loadTechnicalPlanSummary() {
        const data = await requestJson<{ state: unknown | null }>(withProjectId('/api/workspace/technical-plan-summary'));
        return data.state as never;
      },

      async loadTechnicalPlan() {
        const data = await requestJson<{ state: unknown | null }>(withProjectId('/api/workspace/technical-plan'));
        return data.state as never;
      },

      async saveTechnicalPlan(state: unknown) {
        return requestJson(withProjectId('/api/workspace/technical-plan'), {
          method: 'POST',
          body: JSON.stringify(state),
        });
      },

      async updateTechnicalPlan(partial: unknown) {
        const data = await requestJson<{ state: unknown }>(withProjectId('/api/workspace/technical-plan'), {
          method: 'PATCH',
          body: JSON.stringify(partial),
        });
        return data.state as never;
      },

      async clearTechnicalPlan() {
        return requestJson(withProjectId('/api/workspace/technical-plan'), {
          method: 'DELETE',
        });
      },

      async loadBusinessBid() {
        const data = await requestJson<{ state: BusinessBidWorkspaceState | null }>(withProjectId('/api/workspace/business-bid'));
        return data.state;
      },

      async saveBusinessBid(state: BusinessBidWorkspaceState) {
        return requestJson(withProjectId('/api/workspace/business-bid'), {
          method: 'POST',
          body: JSON.stringify(state),
        });
      },

      async updateBusinessBid(partial: Partial<BusinessBidWorkspaceState>) {
        const data = await requestJson<{ state: BusinessBidWorkspaceState }>(withProjectId('/api/workspace/business-bid'), {
          method: 'PATCH',
          body: JSON.stringify(partial),
        });
        return data.state;
      },

      async clearBusinessBid() {
        return requestJson(withProjectId('/api/workspace/business-bid'), {
          method: 'DELETE',
        });
      },

      async loadDuplicateCheck() {
        const data = await requestJson<{ state: DuplicateCheckWorkspaceState | null }>(withProjectId('/api/workspace/duplicate-check'));
        return data.state;
      },

      async saveDuplicateCheck(state: unknown) {
        return requestJson(withProjectId('/api/workspace/duplicate-check'), {
          method: 'POST',
          body: JSON.stringify(state),
        });
      },

      async clearDuplicateCheck() {
        return requestJson(withProjectId('/api/workspace/duplicate-check'), {
          method: 'DELETE',
        });
      },

      async loadRejectionCheck() {
        const data = await requestJson<{ state: RejectionCheckWorkspaceState | null }>(withProjectId('/api/workspace/rejection-check'));
        return data.state;
      },

      async saveRejectionCheck(state: RejectionCheckWorkspaceState) {
        return requestJson(withProjectId('/api/workspace/rejection-check'), {
          method: 'POST',
          body: JSON.stringify(state),
        });
      },

      async updateRejectionCheck(partial: Partial<RejectionCheckWorkspaceState>) {
        const data = await requestJson<{ state: RejectionCheckWorkspaceState }>(withProjectId('/api/workspace/rejection-check'), {
          method: 'PATCH',
          body: JSON.stringify(partial),
        });
        return data.state;
      },

      async clearRejectionCheck() {
        return requestJson(withProjectId('/api/workspace/rejection-check'), {
          method: 'DELETE',
        });
      },

      async loadBidOpportunity() {
        const data = await requestJson<{ state: BidOpportunityWorkspaceState | null }>(withProjectId('/api/workspace/bid-opportunity'));
        return data.state;
      },

      async saveBidOpportunity(state: BidOpportunityWorkspaceState) {
        return requestJson(withProjectId('/api/workspace/bid-opportunity'), {
          method: 'POST',
          body: JSON.stringify(state),
        });
      },

      async updateBidOpportunity(partial: Partial<BidOpportunityWorkspaceState>) {
        const data = await requestJson<{ state: BidOpportunityWorkspaceState }>(withProjectId('/api/workspace/bid-opportunity'), {
          method: 'PATCH',
          body: JSON.stringify(partial),
        });
        return data.state;
      },

      async clearBidOpportunity() {
        return requestJson(withProjectId('/api/workspace/bid-opportunity'), {
          method: 'DELETE',
        });
      },

      async loadProjects() {
        const data = await requestJson<{ state: ProjectWorkspaceState | null }>('/api/workspace/projects');
        return data.state;
      },

      async saveProjects(state: ProjectWorkspaceState) {
        return requestJson('/api/workspace/projects', {
          method: 'POST',
          body: JSON.stringify(state),
        });
      },

      async updateProjects(partial: Partial<ProjectWorkspaceState>) {
        const data = await requestJson<{ state: ProjectWorkspaceState }>('/api/workspace/projects', {
          method: 'PATCH',
          body: JSON.stringify(partial),
        });
        return data.state;
      },

      async clearProjects() {
        return requestJson('/api/workspace/projects', {
          method: 'DELETE',
        });
      },
    },

    tasks: {
      async startBidAnalysis(payload) {
        return requestJson(withProjectId('/api/tasks/start-bid-analysis'), {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      },

      async startOutlineGeneration(payload) {
        return requestJson(withProjectId('/api/tasks/start-outline-generation'), {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      },

      async startContentGeneration(payload) {
        return requestJson(withProjectId('/api/tasks/start-content-generation'), {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      },

      async getActiveTasks() {
        const data = await requestJson<{ tasks: unknown[] }>('/api/tasks/active');
        return data.tasks || [];
      },

      onTaskEvent(callback) {
        return subscribeEventChannel('tasks', (payload) => callback(payload as never));
      },
    },

    export: {
      async exportWord(payload: unknown): Promise<WordExportResult> {
        const data = await requestJson<{ success: boolean; message?: string; warnings?: string[]; file_token?: string; file_name?: string }>('/api/export/word', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        if (data.success && data.file_token) {
          try {
            const response = await fetch(apiUrl(`/api/export/download/${encodeURIComponent(data.file_token)}/${encodeURIComponent(data.file_name || '标书文档.docx')}`), {
              headers: createAuthHeader(),
            });
            if (response.ok) {
              const blob = await response.blob();
              downloadBlob(blob, data.file_name || '标书文档.docx');
            }
          } catch {
            // 下载失败不影响主结果返回。
          }
        }

        return {
          success: Boolean(data.success),
          message: data.message,
          warnings: data.warnings,
        };
      },

      onWordExportProgress(callback: (event: WordExportProgressEvent) => void) {
        return subscribeEventChannel('export', (payload) => callback(payload as WordExportProgressEvent));
      },
    },

    user: {
      async register(payload: { email: string; password: string; displayName: string }): Promise<AuthResult> {
        return requestJson<AuthResult>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      },

      async login(payload: { email: string; password: string }): Promise<AuthResult> {
        return requestJson<AuthResult>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      },

      async logout(token: string) {
        return requestJson<{ success: boolean; message?: string }>('/api/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
      },

      async logoutAll(token: string) {
        return requestJson<{ success: boolean; message?: string }>('/api/auth/logout-all', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
      },

      async me(token: string) {
        return requestJson<{ user: UserProfile | null }>(`/api/auth/me?token=${encodeURIComponent(token)}`);
      },

      async listSessions(token: string) {
        return requestJson<{ success: boolean; message?: string; sessions: UserSessionInfo[] }>(`/api/auth/sessions?token=${encodeURIComponent(token)}`);
      },

      async changePassword(payload: { token: string; oldPassword: string; newPassword: string }) {
        return requestJson<{ success: boolean; message?: string }>('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      },

      async updateProfile(payload: { token: string; displayName?: string; company?: string; phone?: string }) {
        return requestJson<{ success: boolean; user?: UserProfile | null; message?: string }>('/api/auth/profile', {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      },

      async uploadAvatar(payload: { token: string; file: File }) {
        const formData = new FormData();
        formData.append('token', payload.token);
        formData.append('avatar', payload.file, payload.file.name);
        return requestJson<{ success: boolean; user?: UserProfile | null; message?: string }>('/api/auth/avatar', {
          method: 'POST',
          body: formData,
        });
      },
    },
  };
}

export function installWebBridge() {
  if (window.bidmind) {
    return window.bidmind;
  }

  const bridge = createBridge();
  window.bidmind = bridge;
  window.bidmindClient = {
    appName: bridge.appName,
    platform: bridge.platform,
  };
  return bridge;
}
