export type BidOpportunityStatus = 'tracking' | 'deciding' | 'won' | 'lost' | 'archived';

export interface BidOpportunityRecord {
  id: string;
  title: string;
  source: string;
  region: string;
  budget: string;
  deadline: string;
  owner: string;
  score: number;
  status: BidOpportunityStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface BidOpportunityWorkspaceState {
  records: BidOpportunityRecord[];
}
