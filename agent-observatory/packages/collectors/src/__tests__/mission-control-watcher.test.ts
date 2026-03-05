import { describe, expect, it } from 'vitest';
import { MissionControlWatcher } from '../mission-control/watcher.js';

describe('MissionControlWatcher', () => {
  it('parses task cards with explicit ids, goal refs, and dependencies', () => {
    const watcher = new MissionControlWatcher([]);
    const tasks = (watcher as any).parseTaskMarkdown(`
### T-101: (moonlit) Ship goal drilldown #high
- Owner: frontend
- Goal ID: G-100
- Status: in_progress
- Goal (1 sentence): Build the goal to project to task view.
- Risks:
  - depends:T-099
`, '/tmp/TASK.md');

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'T-101',
      title: 'Ship goal drilldown',
      project: 'moonlit',
      goal_id: 'G-100',
      assigned_to: 'frontend',
      priority: 'high',
      status: 'in_progress',
      dependencies: ['T-099'],
    });
  });

  it('parses hierarchical goals from headings', () => {
    const watcher = new MissionControlWatcher([]);
    const goals = (watcher as any).parseGoalsMarkdown(`
# GOALS

## G-100: Observatory Phase 2
Status: active
Goal progress and structure.

### G-110: Goal Hierarchy
Status: blocked
`, '/tmp/GOALS.md');

    expect(goals).toHaveLength(2);
    expect(goals[0]).toMatchObject({
      id: 'G-100',
      title: 'Observatory Phase 2',
      level: 1,
      status: 'active',
    });
    expect(goals[1]).toMatchObject({
      id: 'G-110',
      parent_id: 'G-100',
      status: 'blocked',
    });
  });
});
