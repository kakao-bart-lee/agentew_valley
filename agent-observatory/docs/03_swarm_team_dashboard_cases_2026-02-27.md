# (3) 유사 사례 조사 — 스웜/팀 대시보드 & 에이전트 관측 툴 (2026-02-27)

목표:
- “여러 에이전트/스웜의 활동을 모아 관찰/분석하는 UI”의 기존 사례를 카테고리별로 정리
- 우리 케이스(Claude Code JSONL, OpenClaw sessions/logs/OTel, pixel-agents 스타일 픽셀 뷰)에 적용 가능한 패턴을 추출

전제:
- 여기서 말하는 “대시보드”는 크게 2종:
  1) **빌더/실행 스튜디오**: 에이전트/워크플로 구성과 실행을 한 UI에서 제공
  2) **관측/추적(Observability)**: 실행 결과를 trace/log/metric으로 수집/시각화

---

## 1) 프레임워크 “Studio” 계열(스웜/그래프/워크플로 실행 UI)

### 1.1 LangGraph Studio (LangChain/LangGraph)
- 특징: LangGraph 워크플로/에이전트 실행을 UI에서 관찰/디버깅(그래프 기반)
- 시사점: “실행 단위 = 그래프 run”으로 모델링하고, 노드/스텝별 이벤트를 UI에 매핑
- 링크: https://langchain-ai.github.io/langgraph/concepts/langgraph_studio/

### 1.2 AutoGen Studio (Microsoft)
- 특징: 멀티 에이전트(팀) 구성/실행/관측을 위한 Studio UI(실험/프로토타이핑 지향)
- 시사점: 멀티 에이전트 모델(역할/메시지/툴)을 UI에서 다루는 패턴 참고
- 링크(논문): https://arxiv.org/abs/2408.15247
- 링크(GitHub): https://github.com/microsoft/autogen/tree/main/python/packages/autogen-studio

### 1.3 CrewAI / Crew Studio
- 특징: Crew(여러 에이전트) 구성 + 실행을 지원하는 Studio/플랫폼 존재
- 시사점: “crew run” 중심의 모델링과, 역할(agents)/task 분해를 UI에서 표현하는 방식 참고
- 링크: https://github.com/crewAIInc/crewAI
- 링크(Studio): https://github.com/crewAIInc/crew-studio

### 1.4 (내부 사례) OpenClaw Control UI
- 특징: gateway를 원격 제어/관찰(로그 tail, 상태 확인)하는 웹 UI
- 시사점: “gateway가 source of truth”인 경우, UI는 파일 직접 파싱 대신 RPC/diagnostics를 조회하는 패턴이 강함
- 참고(로컬 문서): `/Users/joy/workspace/openclaw/docs/web/control-ui.md`

---

## 2) 관측/추적(Observability) 계열: Trace/Metric/Session 분석

### 2.1 Langfuse
- 특징: LLM 앱/에이전트 실행을 traces로 수집/시각화하는 오픈소스 observability
- 시사점: “실행 추적”을 제품 레벨로 만들 때 필요한 기능(검색, 필터, 비용/토큰, 권한) 참고
- 링크: https://github.com/langfuse/langfuse

### 2.2 LangSmith (LangChain)
- 특징: LangChain/LangGraph 실행을 추적/평가/디버깅하는 플랫폼(상용 중심)
- 시사점: “trace + dataset/eval + 회귀 비교”까지 포함한 제품형 UX 참고
- 링크: https://www.langchain.com/langsmith

### 2.3 Arize Phoenix + OpenInference
- 특징: OpenInference(LLM 관측 규약) 기반으로 trace를 시각화/분석하는 툴(오픈소스)
- 시사점: “표준 규약(semantic conventions)”을 사용하면 서로 다른 런타임을 한 UI로 묶기가 쉬워짐
- 링크(Phoenix): https://github.com/Arize-ai/phoenix
- 링크(OpenInference spec): https://github.com/Arize-ai/openinference/tree/main/spec

### 2.4 OpenLLMetry (Traceloop)
- 특징: LLM 앱을 OpenTelemetry로 계측하기 위한 도구/라이브러리(“OTel-first”)
- 시사점: 장기적으로 OTel collector/백엔드에 붙이려면 “수집”보다 “계측 표준화”가 중요
- 링크: https://github.com/traceloop/openllmetry

### 2.5 OpenTelemetry Semantic Conventions
- 특징: 서비스/HTTP/RPC 같은 공통 영역을 표준 속성으로 통일(LLM 영역은 OpenInference 같은 확장이 필요)
- 링크: https://opentelemetry.io/docs/specs/semconv/

### 2.6 OpenAI Agents SDK / Swarm
- 특징: OpenAI 쪽은 Agents SDK 방향으로 정리되고, Swarm은 Agents SDK로 대체되는 흐름(오픈소스 Swarm repo는 유지되지만 “대체” 안내가 있음)
- 시사점: “스웜/멀티 에이전트”를 플랫폼 레벨에서 지원할 때, 실행 추적/디버깅(Trace)이 기본 구성으로 들어가는 패턴 참고
- 링크(Agents SDK): https://platform.openai.com/docs/guides/agents
- 링크(Swarm repo): https://github.com/openai/swarm

---

## 3) “Claude Code JSONL transcript” 뷰어/분석 도구

Pixel Agents 자체가 Claude Code JSONL을 이용한 “시각화” 사례이고,
별도의 transcript viewer들도 존재합니다.

### 3.1 claude-code-log
- 특징: Claude Code transcript를 타임라인/로그처럼 보여주는 CLI/툴 계열(오픈소스)
- 링크: https://github.com/daaain/claude-code-log

### 3.2 claude-code-viewer
- 특징: Claude Code JSONL transcript를 브라우저에서 보기 위한 뷰어(오픈소스)
- 링크: https://github.com/withLinda/claude-code-viewer

### 3.3 Viewing Claude Code’s JSONL files (블로그; Simon Willison)
- 특징: Claude Code가 남기는 JSONL을 사람이 읽기 좋은 형태로 보는 방법 소개(사례/팁 중심)
- 링크: https://simonwillison.net/2025/Feb/2/claude-code-jsonl/

### 3.4 (내부 사례) Pixel Agents의 정적 JSONL viewer
- 파일: `/Users/joy/workspace/pixel-agents/scripts/jsonl-viewer.html`

---

## 4) “스웜/팀 대시보드” 관점에서 얻을 수 있는 패턴

### 4.1 공통 모델: Session/Trace, Agent, Tool, Subagent
유사 사례를 보면 대부분 다음으로 수렴합니다.
- **상위 실행 단위**: session/run/trace
- **행위 단위**: tool call / LLM call / workflow step (span)
- **관계**: parent-child(서브에이전트, 그래프 노드, 태스크 분해)
- **집계**: 비용/토큰/latency/에러율

### 4.2 “픽셀 뷰”가 차별점이 되는 지점
관측 툴은 대부분 “타임라인/트레이스” UI에 집중합니다.
Pixel UI는 다음에 강점이 있습니다.
- 여러 에이전트를 한 화면에서 “상태”로 빠르게 파악(L1)
- 툴 카테고리별로 행동을 시각화해 “어떤 종류의 작업인지”를 직관적으로 전달

따라서 현실적인 결합은:
- **표준 관측(OTel/OpenInference/UAEP) + 대시보드**를 기본으로 깔고,
- 픽셀 뷰는 “상태/툴 카테고리 이벤트”만 받아 경량 레이어로 얹는 구조가 맞습니다.

---

## 5) 추가 조사 키워드(후속)

- “agent observability”, “agent tracing”, “LLM tracing dashboard”
- “multi-agent studio”, “agent workflow studio”
- “OpenTelemetry LLM semantic conventions”, “OpenInference traces”
- “Claude Code transcript viewer”, “jsonl transcript analysis”
