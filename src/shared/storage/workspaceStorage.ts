import { safeJsonParse } from '../utils/json';

const WORKSPACE_KEY = 'bidmind:client:workspace:v1';
const WORKSPACE_EVENT = 'bidmind:workspace-updated';

export interface WorkspaceState {
  activeSection?: string;
  activeProjectId?: string;
  updatedAt?: string;
}

export const workspaceStorage = {
  load(): WorkspaceState | null {
    return safeJsonParse<WorkspaceState>(localStorage.getItem(WORKSPACE_KEY));
  },

  save(partial: WorkspaceState) {
    const prev = workspaceStorage.load() || {};
    const next = { ...prev, ...partial, updatedAt: new Date().toISOString() };
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent<WorkspaceState>(WORKSPACE_EVENT, { detail: next }));
  },

  subscribe(callback: (state: WorkspaceState) => void) {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<WorkspaceState>;
      callback(customEvent.detail || workspaceStorage.load() || {});
    };
    window.addEventListener(WORKSPACE_EVENT, handler);
    return () => {
      window.removeEventListener(WORKSPACE_EVENT, handler);
    };
  },
};
