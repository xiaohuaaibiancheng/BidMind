export type ProjectStatus = 'in-progress' | 'completed' | 'deleted';
export type ProjectWorkbenchType = 'technical-plan' | 'business-bid';

export interface ManagedProject {
  id: string;
  name: string;
  code?: string;
  owner?: string;
  workbench: ProjectWorkbenchType;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface ProjectWorkspaceState {
  projects: ManagedProject[];
}
