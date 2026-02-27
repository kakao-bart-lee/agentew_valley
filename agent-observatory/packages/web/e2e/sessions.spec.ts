import { test, expect } from '@playwright/test';
import { injectAgentSession, uniqueId } from './helpers';

/**
 * Sessions E2E 테스트
 *
 * 커버리지:
 *   1. Sessions 뷰 진입 — "Session History" 헤딩 표시
 *   2. 빈 상태 — "sessions recorded" 메타 텍스트
 *   3. 세션 카드 — 이벤트 주입 후 목록에 표시
 *   4. Replay 뷰 — 카드 클릭 시 SessionReplayView로 전환 (Event Timeline 확인)
 *   5. Refresh 버튼 동작
 *   6. Back 버튼 (ReplayView → ListView)
 */

test.describe('Sessions', () => {
  // ── 기본 뷰 ──────────────────────────────────────────────────────────────

  test('shows Session History heading and metadata', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 8000 });

    await page.getByRole('button', { name: 'Sessions' }).click();

    await expect(page.getByText('Session History')).toBeVisible();
    // "{N} sessions recorded" 패턴 — "No sessions recorded yet"와 구분
    await expect(page.getByText(/\d+ sessions recorded/)).toBeVisible();
  });

  test('Refresh button is visible and clickable', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sessions' }).click();

    const refreshBtn = page.getByRole('button', { name: /Refresh/ });
    await expect(refreshBtn).toBeVisible();
    await expect(refreshBtn).toBeEnabled();
    await refreshBtn.click();
    // 버튼이 여전히 표시되면 크래시 없음
    await expect(refreshBtn).toBeVisible();
  });

  // ── 세션 카드 ────────────────────────────────────────────────────────────

  test('session card appears after injecting agent events', async ({ page }) => {
    const agentId = uniqueId('sess-agent');
    const agentName = `E2E Session Agent ${agentId.slice(-4)}`;
    const sessionId = uniqueId('sess-session');

    // 세션 주입
    await injectAgentSession({ agentId, agentName, sessionId });

    await page.goto('/');
    await page.getByRole('button', { name: 'Sessions' }).click();

    // 세션 목록에 agent 이름이 보여야 함
    await expect(page.getByText(agentName)).toBeVisible({ timeout: 8000 });
  });

  test('session card shows source badge and event count', async ({ page }) => {
    const agentId = uniqueId('badge-agent');
    const agentName = `E2E Badge Agent ${agentId.slice(-4)}`;
    const sessionId = uniqueId('badge-session');

    await injectAgentSession({ agentId, agentName, sessionId });

    await page.goto('/');
    await page.getByRole('button', { name: 'Sessions' }).click();

    // 세션 카드는 <button> 요소 — agent name으로 필터링
    const sessionCard = page.getByRole('button').filter({ hasText: agentName });

    // CC 뱃지 (SOURCE_LABELS['claude_code'] = 'CC')
    await expect(sessionCard.getByText('CC')).toBeVisible({ timeout: 8000 });
    // event count
    await expect(sessionCard.getByText(/events/)).toBeVisible({ timeout: 8000 });
  });

  test('clicking session card opens replay view', async ({ page }) => {
    const agentId = uniqueId('replay-agent');
    const agentName = `E2E Replay Agent ${agentId.slice(-4)}`;
    const sessionId = uniqueId('replay-session');

    await injectAgentSession({ agentId, agentName, sessionId, toolName: 'Read' });

    await page.goto('/');
    await page.getByRole('button', { name: 'Sessions' }).click();

    const sessionCard = page.getByText(agentName);
    await expect(sessionCard).toBeVisible({ timeout: 8000 });
    await sessionCard.click();

    // SessionReplayView 로딩 — "Event Timeline" 헤더가 표시되면 리플레이 뷰
    await expect(page.getByText('Event Timeline')).toBeVisible({ timeout: 10000 });
  });

  // ── Back 버튼 (ReplayView → ListView) ────────────────────────────────────

  test('back button in replay view returns to session list', async ({ page }) => {
    const agentId = uniqueId('back-agent');
    const agentName = `E2E Back Agent ${agentId.slice(-4)}`;
    const sessionId = uniqueId('back-session');

    await injectAgentSession({ agentId, agentName, sessionId });

    await page.goto('/');
    await page.getByRole('button', { name: 'Sessions' }).click();

    await expect(page.getByText(agentName)).toBeVisible({ timeout: 8000 });
    await page.getByText(agentName).click();

    // Replay 뷰 진입 확인
    await expect(page.getByText('Event Timeline')).toBeVisible({ timeout: 10000 });

    // Back 버튼 클릭
    // StatusBar의 "Sessions" nav 버튼(first)과 Replay View의 "← Sessions" back 버튼(last)이 공존
    // → .last()로 Replay View의 back 버튼 클릭
    const backBtn = page.getByRole('button', { name: 'Sessions' }).last();
    await expect(backBtn).toBeVisible({ timeout: 5000 });
    await backBtn.click();

    // 다시 세션 목록으로
    await expect(page.getByText('Session History')).toBeVisible({ timeout: 5000 });
  });
});
