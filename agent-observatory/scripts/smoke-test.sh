#!/usr/bin/env bash
# smoke-test.sh — Backend smoke test (서버가 이미 실행 중이어야 함)
# Usage: ./scripts/smoke-test.sh [PORT]

PORT=${1:-3000}
BASE="http://localhost:$PORT"
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

check() {
  local desc="$1"
  local status="$2"
  local expected="$3"
  if [ "$status" -eq "$expected" ]; then
    echo -e "  ${GREEN}✓${NC} $desc (HTTP $status)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $desc (expected HTTP $expected, got $status)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "=== Agent Observatory — Backend Smoke Test (port $PORT) ==="
echo ""

# ── Health / config ──────────────────────────────────────────────────────────
echo "── Config & Docs ──"
check "GET /api/v1/config" \
  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/config)" 200
check "GET /api-docs/openapi.json" \
  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api-docs/openapi.json)" 200
check "GET /api-docs/swagger-initializer.js" \
  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api-docs/swagger-initializer.js)" 200

# ── Agents (empty at start) ───────────────────────────────────────────────────
echo ""
echo "── Agents ──"
AGENTS=$(curl -s $BASE/api/v1/agents)
check "GET /api/v1/agents" \
  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/agents)" 200
check "GET /api/v1/agents/hierarchy" \
  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/agents/hierarchy)" 200
check "GET /api/v1/agents/nonexistent → 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/agents/nonexistent)" 404

# ── Metrics ──────────────────────────────────────────────────────────────────
echo ""
echo "── Metrics ──"
check "GET /api/v1/metrics/summary" \
  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/metrics/summary)" 200
check "GET /api/v1/metrics/timeseries" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/metrics/timeseries?metric=tokens_per_minute&from=30")" 200

# ── Sessions ─────────────────────────────────────────────────────────────────
echo ""
echo "── Sessions ──"
check "GET /api/v1/sessions" \
  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/sessions)" 200

# ── Collectors ───────────────────────────────────────────────────────────────
echo ""
echo "── Collectors ──"
check "GET /api/v1/collectors" \
  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/collectors)" 200

# ── Event injection ──────────────────────────────────────────────────────────
echo ""
echo "── Event injection (HTTP Collector) ──"

SESSION_ID="smoke-session-$(date +%s)"
AGENT_ID="smoke-agent-01"

SESSION_START=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/v1/events \
  -H "Content-Type: application/json" \
  -d "{
    \"ts\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"event_id\": \"evt-$(uuidgen | tr '[:upper:]' '[:lower:]' 2>/dev/null || echo "00000000-0000-0000-0000-$(date +%s%N | md5 | head -c12)")\",
    \"source\": \"claude_code\",
    \"agent_id\": \"$AGENT_ID\",
    \"agent_name\": \"Smoke Test Agent\",
    \"session_id\": \"$SESSION_ID\",
    \"type\": \"session.start\",
    \"data\": {}
  }")
check "POST /api/v1/events (session.start)" "$SESSION_START" 201

sleep 0.1

TOOL_START=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/v1/events \
  -H "Content-Type: application/json" \
  -d "{
    \"ts\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"event_id\": \"evt-$(uuidgen | tr '[:upper:]' '[:lower:]' 2>/dev/null || echo "00000000-0000-0000-0001-$(date +%s%N | md5 | head -c12)")\",
    \"source\": \"claude_code\",
    \"agent_id\": \"$AGENT_ID\",
    \"session_id\": \"$SESSION_ID\",
    \"type\": \"tool.start\",
    \"data\": {\"tool_name\": \"Read\", \"tool_use_id\": \"tool-001\"}
  }")
check "POST /api/v1/events (tool.start)" "$TOOL_START" 201

sleep 0.1

TOOL_END=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/v1/events \
  -H "Content-Type: application/json" \
  -d "{
    \"ts\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"event_id\": \"evt-$(uuidgen | tr '[:upper:]' '[:lower:]' 2>/dev/null || echo "00000000-0000-0000-0002-$(date +%s%N | md5 | head -c12)")\",
    \"source\": \"claude_code\",
    \"agent_id\": \"$AGENT_ID\",
    \"session_id\": \"$SESSION_ID\",
    \"type\": \"tool.end\",
    \"data\": {\"tool_use_id\": \"tool-001\"}
  }")
check "POST /api/v1/events (tool.end)" "$TOOL_END" 201

sleep 0.2

# ── State verification ────────────────────────────────────────────────────────
echo ""
echo "── State verification (after events) ──"

AGENT_STATUS=$(curl -s $BASE/api/v1/agents/$AGENT_ID | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('agent',{}).get('status','?'))" 2>/dev/null || echo "?")
AGENT_CODE=$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/agents/$AGENT_ID)
check "GET /api/v1/agents/$AGENT_ID" "$AGENT_CODE" 200
echo -e "     agent status: ${YELLOW}$AGENT_STATUS${NC}"

EVENTS_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agents/$AGENT_ID/events")
check "GET /api/v1/agents/$AGENT_ID/events" "$EVENTS_CODE" 200

SESSIONS_COUNT=$(curl -s $BASE/api/v1/sessions | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('total',0))" 2>/dev/null || echo "?")
check "GET /api/v1/sessions (has data)" \
  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/sessions)" 200
echo -e "     session count: ${YELLOW}$SESSIONS_COUNT${NC}"

SESSION_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/sessions/$SESSION_ID")
check "GET /api/v1/sessions/$SESSION_ID" "$SESSION_CODE" 200

REPLAY_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/sessions/$SESSION_ID/replay")
check "GET /api/v1/sessions/$SESSION_ID/replay" "$REPLAY_CODE" 200

METRICS_ACTIVE=$(curl -s $BASE/api/v1/metrics/summary | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('metrics',{}).get('active_agents',0))" 2>/dev/null || echo "?")
echo -e "     active agents: ${YELLOW}$METRICS_ACTIVE${NC}"

# ── Analytics ────────────────────────────────────────────────────────────────
echo ""
echo "── Analytics ──"
check "GET /api/v1/analytics/cost" \
  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/analytics/cost)" 200
check "GET /api/v1/analytics/cost/by-agent" \
  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/analytics/cost/by-agent)" 200
check "GET /api/v1/analytics/tokens" \
  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/analytics/tokens)" 200

# ── Search ───────────────────────────────────────────────────────────────────
echo ""
echo "── Search ──"
check "GET /api/v1/events/search?q=Read" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/events/search?q=Read")" 200
check "GET /api/v1/events/search (no q) → 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/events/search")" 400

# ── Result ───────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
TOTAL=$((PASS + FAIL))
if [ $FAIL -eq 0 ]; then
  echo -e "  ${GREEN}All $TOTAL checks passed${NC}"
else
  echo -e "  ${GREEN}$PASS passed${NC}  ${RED}$FAIL failed${NC}  (total $TOTAL)"
fi
echo "═══════════════════════════════════════"
echo ""
exit $FAIL
