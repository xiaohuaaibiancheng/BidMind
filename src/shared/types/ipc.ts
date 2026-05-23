import type { AiStreamEvent, ChatCompletionRequest, JsonCompletionRequest } from './ai';
import type { DuplicateCheckProjectSummary, DuplicateCheckWorkspaceState, DuplicateMetadataAnalysisState, FileImportResult, FileSelectionResult } from './bid';
import type { ClientConfig, ConfigSaveResult, ImageModelTestResult, ModelListResult } from './config';
import type { KnowledgeAnalysisSnapshot, KnowledgeBaseEvent, KnowledgeBaseIndex, KnowledgeBaseMutationResult, KnowledgeBaseStartMatchingResult, KnowledgeBaseUploadResult, KnowledgeDocument, KnowledgeFolder, KnowledgeItem } from '../../features/knowledge-base/types';
import type { ProjectWorkspaceState } from '../../features/project-management/types';
import type { BusinessBidWorkspaceState } from '../../features/business-bid/types';
import type { RejectionCheckWorkspaceState } from '../../features/rejection-check/types';
import type { BidOpportunityWorkspaceState } from '../../features/bid-opportunity/types';
import type { AuthResult, UserProfile, UserSessionInfo } from '../../features/user-center/types';

export interface TaskEvent<TState = unknown> {
  task: unknown;
  technicalPlan: TState;
  project_id?: string;
}

export interface WordExportProgressEvent {
  requestId?: string;
  phase: 'running' | 'success' | 'error' | 'canceled';
  progress: number;
  message: string;
  warnings?: string[];
}

export interface WordExportResult {
  success: boolean;
  canceled?: boolean;
  path?: string;
  message?: string;
  warnings?: string[];
}

export interface LatestReleaseInfo {
  version: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
}

export interface UpdateCheckResult {
  enabled: boolean;
  updateAvailable: boolean;
  version?: string;
  downloaded?: boolean;
  failed?: boolean;
  message?: string;
}

export interface BidMindBridge {
  appName: string;
  platform: string;
  getVersion: () => Promise<string>;
  getLatestVersion: () => Promise<LatestReleaseInfo>;
  openExternal: (url: string) => Promise<{ success: boolean; message?: string }>;
  checkUpdate: () => Promise<UpdateCheckResult>;
  startUpdate: () => Promise<UpdateCheckResult>;
  quitAndInstall: () => Promise<void>;
  onUpdateProgress: (callback: (event: { percent: number }) => void) => () => void;
  onUpdateDownloaded: (callback: (event: { version: string }) => void) => () => void;
  onUpdateError: (callback: (event: { message: string }) => void) => () => void;
  config: {
    load: () => Promise<ClientConfig>;
    save: (config: ClientConfig) => Promise<ConfigSaveResult>;
    listModels: (config?: ClientConfig) => Promise<ModelListResult>;
    openConfigFolder: () => Promise<{ success: boolean; path: string }>;
  };
  ai: {
    chat: (request: ChatCompletionRequest) => Promise<string>;
    requestJson: <TResult = unknown>(request: JsonCompletionRequest) => Promise<TResult>;
    testImageModel: (config: ClientConfig) => Promise<ImageModelTestResult>;
    streamChat: (request: ChatCompletionRequest, onEvent: (event: AiStreamEvent) => void) => () => void;
  };
  file: {
    importDocument: () => Promise<FileImportResult>;
    selectDuplicateCheckFiles: (options?: { multiple?: boolean }) => Promise<FileSelectionResult>;
  };
  knowledgeBase: {
    list: () => Promise<KnowledgeBaseIndex>;
    createFolder: (name: string) => Promise<KnowledgeFolder>;
    renameFolder: (folderId: string, name: string) => Promise<KnowledgeFolder>;
    deleteFolder: (folderId: string) => Promise<KnowledgeBaseMutationResult>;
    deleteDocument: (documentId: string) => Promise<KnowledgeBaseMutationResult>;
    uploadDocuments: (folderId: string) => Promise<KnowledgeBaseUploadResult>;
    startMatching: (documentId: string, batchSize: number) => Promise<KnowledgeBaseStartMatchingResult>;
    readMarkdown: (documentId: string) => Promise<string>;
    readItems: (documentId: string) => Promise<KnowledgeItem[]>;
    readAnalysis: (documentId: string) => Promise<KnowledgeAnalysisSnapshot>;
    onEvent: (callback: (event: KnowledgeBaseEvent) => void) => () => void;
  };
  duplicateCheck: {
    startMetadataAnalysis: (payload: { tenderFile: DuplicateCheckWorkspaceState['tenderFile']; bidFiles: DuplicateCheckWorkspaceState['bidFiles']; force?: boolean }) => Promise<DuplicateMetadataAnalysisState>;
    listProjectSummaries: () => Promise<{ projects: DuplicateCheckProjectSummary[] }>;
    onEvent: (callback: (event: { duplicateCheck: DuplicateCheckWorkspaceState; project_id?: string }) => void) => () => void;
  };
  workspace: {
    loadTechnicalPlanSummary: <TState = unknown>() => Promise<TState | null>;
    loadTechnicalPlan: <TState = unknown>() => Promise<TState | null>;
    saveTechnicalPlan: (state: unknown) => Promise<unknown>;
    updateTechnicalPlan: <TState = unknown>(partial: unknown) => Promise<TState>;
    clearTechnicalPlan: () => Promise<unknown>;
    loadDuplicateCheck: () => Promise<DuplicateCheckWorkspaceState | null>;
    saveDuplicateCheck: (state: DuplicateCheckWorkspaceState) => Promise<unknown>;
    clearDuplicateCheck: () => Promise<unknown>;
    loadProjects: () => Promise<ProjectWorkspaceState | null>;
    saveProjects: (state: ProjectWorkspaceState) => Promise<unknown>;
    updateProjects: (partial: Partial<ProjectWorkspaceState>) => Promise<ProjectWorkspaceState>;
    clearProjects: () => Promise<unknown>;
    loadBusinessBid: () => Promise<BusinessBidWorkspaceState | null>;
    saveBusinessBid: (state: BusinessBidWorkspaceState) => Promise<unknown>;
    updateBusinessBid: (partial: Partial<BusinessBidWorkspaceState>) => Promise<BusinessBidWorkspaceState>;
    clearBusinessBid: () => Promise<unknown>;
    loadRejectionCheck: () => Promise<RejectionCheckWorkspaceState | null>;
    saveRejectionCheck: (state: RejectionCheckWorkspaceState) => Promise<unknown>;
    updateRejectionCheck: (partial: Partial<RejectionCheckWorkspaceState>) => Promise<RejectionCheckWorkspaceState>;
    clearRejectionCheck: () => Promise<unknown>;
    loadBidOpportunity: () => Promise<BidOpportunityWorkspaceState | null>;
    saveBidOpportunity: (state: BidOpportunityWorkspaceState) => Promise<unknown>;
    updateBidOpportunity: (partial: Partial<BidOpportunityWorkspaceState>) => Promise<BidOpportunityWorkspaceState>;
    clearBidOpportunity: () => Promise<unknown>;
  };
  tasks: {
    startBidAnalysis: (payload: unknown) => Promise<unknown>;
    startOutlineGeneration: (payload: unknown) => Promise<unknown>;
    startContentGeneration: (payload: unknown) => Promise<unknown>;
    getActiveTasks: () => Promise<unknown[]>;
    onTaskEvent: <TState = unknown>(callback: (event: TaskEvent<TState>) => void) => () => void;
  };
  export: {
    exportWord: (payload: unknown) => Promise<WordExportResult>;
    onWordExportProgress: (callback: (event: WordExportProgressEvent) => void) => () => void;
  };
  user: {
    register: (payload: { email: string; password: string; displayName: string }) => Promise<AuthResult>;
    login: (payload: { email: string; password: string }) => Promise<AuthResult>;
    logout: (token: string) => Promise<{ success: boolean; message?: string }>;
    logoutAll: (token: string) => Promise<{ success: boolean; message?: string }>;
    me: (token: string) => Promise<{ user: UserProfile | null }>;
    listSessions: (token: string) => Promise<{ success: boolean; message?: string; sessions: UserSessionInfo[] }>;
    changePassword: (payload: { token: string; oldPassword: string; newPassword: string }) => Promise<{ success: boolean; message?: string }>;
    updateProfile: (payload: { token: string; displayName?: string; company?: string; phone?: string }) => Promise<{ success: boolean; user?: UserProfile | null; message?: string }>;
    uploadAvatar: (payload: { token: string; file: File }) => Promise<{ success: boolean; user?: UserProfile | null; message?: string }>;
  };
}
