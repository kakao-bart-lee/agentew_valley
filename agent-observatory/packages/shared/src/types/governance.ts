export type ApprovalType = 'dangerous_action' | 'budget_override' | 'new_agent';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'revision_requested';

export interface Approval {
  id: string;
  type: ApprovalType;
  requested_by: string;
  status: ApprovalStatus;
  payload?: Record<string, unknown>;
  decision_note?: string;
  decided_by?: string;
  decided_at?: number;
  created_at: number;
}

export type ActivityActorType = 'agent' | 'user' | 'system';

export type ActivityEntityType = 'task' | 'agent' | 'approval' | 'goal' | 'session';

export interface ActivityEntry {
  id: string;
  type: string;
  actor?: string;
  actor_type: ActivityActorType;
  entity_type: ActivityEntityType;
  entity_id?: string;
  description?: string;
  data?: Record<string, unknown>;
  created_at: number;
}

export interface CollectOptions {
  watchPaths?: string[];
  tailOnly?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AdapterCapabilities {
  costTracking: boolean;
  logStreaming: boolean;
  statusUpdates: boolean;
  goalParsing: boolean;
  taskSync: boolean;
}

export interface AdapterConnectionResult {
  ok: boolean;
  message?: string;
}

export interface ObservatoryAdapter {
  type: string;
  capabilities: AdapterCapabilities;
  collect(options: CollectOptions): Promise<void>;
  testConnection(): Promise<AdapterConnectionResult>;
}

export interface AdapterSummary {
  type: string;
  label: string;
  status: 'ready' | 'stub' | 'error';
  capabilities: AdapterCapabilities;
  last_tested_at?: number;
  last_test_result?: AdapterConnectionResult;
}
