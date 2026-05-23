export interface BusinessBidWorkspaceState {
  projectName?: string;
  responseNotes?: string;
  currentStage?: BusinessBidStage;
  updatedAt?: string;
}

export type BusinessBidStage = 'import' | 'matrix' | 'quote';
