export interface RejectionRiskItem {
  id: string;
  title: string;
  source: string;
  suggestion: string;
  severity: 'low' | 'medium' | 'high';
}

export interface RejectionCheckReport {
  passed: boolean;
  risks: RejectionRiskItem[];
}

export type RejectionRecordStatus = 'draft' | 'running' | 'completed' | 'archived';

export interface RejectionCheckRecord {
  id: string;
  title: string;
  bidFileName: string;
  status: RejectionRecordStatus;
  riskLevel: 'low' | 'medium' | 'high';
  resultSummary: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface RejectionCheckWorkspaceState {
  records: RejectionCheckRecord[];
}
