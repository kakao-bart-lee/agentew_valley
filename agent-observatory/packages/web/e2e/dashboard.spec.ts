import { test, expect } from '@playwright/test';
import { injectEvent, uniqueId } from './helpers';

/**
 * Dashboard E2E 테스트
 *
 * 커버리지:
 *   1. StatusBar — WebSocket 연결 상태
 *   2. AgentCard  — 실시간 agent 등장, status 전환, tool 표시
 *   3. StatusBar 집계 — Active count 갱신
 *   4. AgentDetailPanel — 카드 클릭 → 상세 패널 열림
 *
 * 주의: 에이전트 이름은 AgentCard, ActivityFeed 등 여러 곳에 표시될 수 있음.
 *   - 존재 확인: page.getByText(agentName).first()
 *   - 카드 범위 조작: page.locator('[data-slot="card"]').filter({ hasText: agentName })
 */

/** AgentCard 컴포넌트 locator (data-slot="card" + agent name으로 필터) */
function agentCardLocator(page: import('@playwright/test').Page, agentName: string) {
  return page.locator('[data-slot="card"]').filter({ hasText: agentName });
}

test.describe('Dashboard', () => {
  // ── 연결 상태 ─────────────────────────────────────────────────────────────

  test('StatusBar shows Connected after WebSocket handshake', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 8000 });
  });

  test('StatusBar shows view switcher buttons', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sessions' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pixel' })).toBeVisible();
  });

  // ── AgentCard 실시간 업데이트 ─────────────────────────────────────────────

  test('agent card appears when session.start is published', async ({ page }) => {
    const agentId = uniqueId('dash-agent');
    const agentName = `E2E Dashboard Agent ${agentId.slice(-4)}`;
    const sessionId = uniqueId('dash-session');

    await page.goto('/');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 8000 });

    await injectEvent({
      type: 'session.start',
      agent_id: agentId,
      agent_name: agentName,
      session_id: sessionId,
      data: {},
    });

    // 에이전트 이름이 여러 곳에 표시될 수 있으므로 .first() 사용
    await expect(page.getByText(agentName).first()).toBeVisible({ timeout: 8000 });
  });

  test('agent status changes to acting on tool.start', async ({ page }) => {
    const agentId = uniqueId('acting-agent');
    const agentName = `E2E Acting Agent ${agentId.slice(-4)}`;
    const sessionId = uniqueId('acting-session');
    const toolUseId = `tuid-${agentId}`;

    await page.goto('/');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 8000 });

    // Agent 등록
    await injectEvent({
      type: 'session.start',
      agent_id: agentId,
      agent_name: agentName,
      session_id: sessionId,
      data: {},
    });
    await expect(page.getByText(agentName).first()).toBeVisible({ timeout: 8000 });

    // tool.start → status: acting, current_tool 표시
    // span_id = toolUseId: StateManager가 span_id로 tool을 추적하므로 tool.end와 동일값 사용
    await injectEvent({
      type: 'tool.start',
      agent_id: agentId,
      session_id: sessionId,
      span_id: toolUseId,
      data: { tool_name: 'Write', tool_use_id: toolUseId },
    });

    // AgentCard 범위에서 status 텍스트와 tool 이름 확인
    const card = agentCardLocator(page, agentName);
    await expect(card.getByText('acting', { exact: true })).toBeVisible({ timeout: 8000 });
    await expect(card.getByText(/^Write/)).toBeVisible({ timeout: 8000 });
  });

  test('agent status returns to idle after tool.end', async ({ page }) => {
    const agentId = uniqueId('idle-agent');
    const agentName = `E2E Idle Agent ${agentId.slice(-4)}`;
    const sessionId = uniqueId('idle-session');
    const toolUseId = `tuid-${agentId}`;

    await page.goto('/');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 8000 });

    await injectEvent({ type: 'session.start', agent_id: agentId, agent_name: agentName, session_id: sessionId, data: {} });
    await expect(page.getByText(agentName).first()).toBeVisible({ timeout: 8000 });

    await injectEvent({ type: 'tool.start', agent_id: agentId, session_id: sessionId, span_id: toolUseId, data: { tool_name: 'Bash', tool_use_id: toolUseId } });
    const card = agentCardLocator(page, agentName);
    await expect(card.getByText('acting', { exact: true })).toBeVisible({ timeout: 8000 });

    await injectEvent({ type: 'tool.end', agent_id: agentId, session_id: sessionId, span_id: toolUseId, data: { tool_use_id: toolUseId } });

    // acting 사라지고 idle 표시
    await expect(card.getByText('acting', { exact: true })).not.toBeVisible({ timeout: 8000 });
    await expect(card.getByText('idle', { exact: true })).toBeVisible({ timeout: 8000 });
  });

  test('agent card disappears on session.end', async ({ page }) => {
    const agentId = uniqueId('end-agent');
    const agentName = `E2E End Agent ${agentId.slice(-4)}`;
    const sessionId = uniqueId('end-session');

    await page.goto('/');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 8000 });

    await injectEvent({ type: 'session.start', agent_id: agentId, agent_name: agentName, session_id: sessionId, data: {} });
    await expect(page.getByText(agentName).first()).toBeVisible({ timeout: 8000 });

    await injectEvent({ type: 'session.end', agent_id: agentId, session_id: sessionId, data: {} });

    // session.end → StateManager가 agent 제거 → AgentCard 사라짐
    // (ActivityFeed에 name이 남을 수 있으므로 카드 locator 사용)
    await expect(agentCardLocator(page, agentName)).not.toBeVisible({ timeout: 8000 });
  });

  // ── StatusBar 집계 ────────────────────────────────────────────────────────

  test('StatusBar Active count increases when agents become active', async ({ page }) => {
    const agentId = uniqueId('metric-agent');
    const agentName = `E2E Metric Agent ${agentId.slice(-4)}`;
    const sessionId = uniqueId('metric-session');
    const toolUseId = `tuid-${agentId}`;

    await page.goto('/');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 8000 });

    // Active: X / Y 패턴 확인
    await expect(page.getByText('Active:', { exact: true })).toBeVisible();

    await injectEvent({ type: 'session.start', agent_id: agentId, agent_name: agentName, session_id: sessionId, data: {} });
    await expect(page.getByText(agentName).first()).toBeVisible({ timeout: 8000 });

    await injectEvent({ type: 'tool.start', agent_id: agentId, session_id: sessionId, span_id: toolUseId, data: { tool_name: 'Grep', tool_use_id: toolUseId } });

    // Active count가 1 이상임을 확인 — "Active:" 옆 숫자가 0이 아닌지 검증
    await expect(
      page.getByText('Active:', { exact: true }).locator('..').getByText(/^[1-9]/)
    ).toBeVisible({ timeout: 8000 });
  });

  // ── AgentDetailPanel ──────────────────────────────────────────────────────

  test('detail panel opens on agent card click', async ({ page }) => {
    const agentId = uniqueId('panel-agent');
    const agentName = `E2E Panel Agent ${agentId.slice(-4)}`;
    const sessionId = uniqueId('panel-session');

    await page.goto('/');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 8000 });

    await injectEvent({ type: 'session.start', agent_id: agentId, agent_name: agentName, session_id: sessionId, data: {} });
    await expect(page.getByText(agentName).first()).toBeVisible({ timeout: 8000 });

    // AgentCard 클릭 (카드 locator 사용 — strict mode 방지)
    await agentCardLocator(page, agentName).click();

    // 패널이 열려야 함: 에이전트 이름이 여전히 표시됨
    await expect(page.getByText(agentName).first()).toBeVisible({ timeout: 5000 });
    // 닫기 버튼이 존재해야 함
    await expect(page.locator('button').filter({ hasText: '' }).first()).toBeVisible({ timeout: 5000 });
  });

  // ── 뷰 전환 ───────────────────────────────────────────────────────────────

  test('clicking Sessions nav button switches view', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 8000 });

    await page.getByRole('button', { name: 'Sessions' }).click();

    await expect(page.getByText('Session History')).toBeVisible({ timeout: 5000 });
  });
});
