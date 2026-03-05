/**
 * Mission Control / task-governance domain types shared by server and web.
 */

export type GoalStatus = 'planned' | 'active' | 'blocked' | 'done' | 'archived';

export interface Goal {
  id: string;
  title: string;
  description?: string;
  level: number;
  parent_id?: string;
  status: GoalStatus;
  source_path?: string;
}

export interface GoalProgress extends Goal {
  total_tasks: number;
  completed_tasks: number;
  active_tasks: number;
  completion_ratio: number;
  projects: string[];
  children: GoalProgress[];
}

export type TaskRelationType = 'blocks' | 'blocked_by' | 'related';

export interface TaskRelation {
  id: string;
  type: TaskRelationType;
  task_id: string;
  related_task_id: string;
  source_path?: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_agent_id: string;
  body: string;
  created_at: number;
}

export interface TaskRelationSummary {
  blocks: string[];
  blocked_by: string[];
  related: string[];
}

export interface TaskGoalSummary {
  id: string;
  title: string;
  status: GoalStatus;
}

export interface MissionControlTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  project?: string;
  goal_id?: string;
  goal?: TaskGoalSummary;
  assigned_to?: string;
  checkout_agent_id?: string;
  checkout_at?: number;
  created_by?: string;
  created_at: number;
  started_at?: number;
  updated_at: number;
  due_date?: number;
  source_path?: string;
  tags?: string;
  metadata?: string;
  is_stale: boolean;
  is_blocked: boolean;
  open_dependency_count: number;
  relation_summary: TaskRelationSummary;
  comment_count: number;
}
