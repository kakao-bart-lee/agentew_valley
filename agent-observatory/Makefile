.PHONY: dev dev-server dev-web build build-shared build-web test test-e2e lint clean kill mc-db help

ROOT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
SERVER_PORT ?= 3561
WEB_PORT ?= 8162
OBSERVATORY_TASKS_V2_ENABLED ?= true
export OBSERVATORY_TASKS_V2_ENABLED
DEV_PACKAGES := @agent-observatory/shared @agent-observatory/collectors @agent-observatory/server @agent-observatory/web
PNPM_DEV_FILTERS := $(foreach pkg,$(DEV_PACKAGES),--filter $(pkg))

MC_DB_CANDIDATES := \
	$(MISSION_CONTROL_DB_PATH) \
	$(HOME)/workspace/mission-control-setup/.data/mission-control.db \
	$(HOME)/workspace/mission-control/.data/mission-control.db \
	$(abspath $(ROOT_DIR)/../mission-control-setup/.data/mission-control.db)

MC_DB_PATH := $(strip $(firstword $(foreach path,$(MC_DB_CANDIDATES),$(if $(wildcard $(path)),$(path),))))

ifneq ($(MC_DB_PATH),)
export MISSION_CONTROL_DB_PATH := $(MC_DB_PATH)
endif

# 기본 타겟
.DEFAULT_GOAL := help

## 개발 서버
dev: ## 서버 + 웹 동시 실행 (Mission Control DB 자동 탐색)
	@echo "기존 프로세스 확인 및 종료 중..."
	@kill -9 $$(lsof -t -i:$(SERVER_PORT)) 2>/dev/null || true
	@kill -9 $$(lsof -t -i:$(WEB_PORT)) 2>/dev/null || true
	@sleep 1
	@if [ -n "$(MISSION_CONTROL_DB_PATH)" ]; then \
		echo "Mission Control DB: $(MISSION_CONTROL_DB_PATH)"; \
	else \
		echo "Mission Control DB: not found (make mc-db 로 후보 경로 확인)"; \
	fi
	@echo "서버($(SERVER_PORT)) + 웹($(WEB_PORT)) 시작..."
	pnpm -r --parallel $(PNPM_DEV_FILTERS) dev

dev-server: ## 서버만 실행 (Mission Control DB 자동 탐색)
	@if [ -n "$(MISSION_CONTROL_DB_PATH)" ]; then \
		echo "Mission Control DB: $(MISSION_CONTROL_DB_PATH)"; \
	else \
		echo "Mission Control DB: not found (make mc-db 로 후보 경로 확인)"; \
	fi
	pnpm dev:server

dev-web: ## 웹(Vite)만 실행
	pnpm dev:web

## 빌드
build: ## 전체 빌드
	pnpm build

build-shared: ## shared 패키지만 빌드
	pnpm build:shared

build-web: ## 웹 패키지만 빌드
	pnpm --filter @agent-observatory/web build

## 테스트
test: ## 전체 단위 테스트
	pnpm test

test-e2e: ## E2E 테스트 (Playwright)
	pnpm test:e2e

## 기타
lint: ## 린트
	pnpm lint

clean: ## 빌드 산출물 정리
	pnpm clean

kill: ## 개발 서버 프로세스 종료 (포트 3561, 8162)
	@lsof -ti :$(SERVER_PORT),:$(WEB_PORT) 2>/dev/null | xargs kill -9 2>/dev/null && echo "프로세스 종료 완료" || echo "실행 중인 프로세스 없음"

mc-db: ## 감지된 Mission Control DB 경로 출력
	@if [ -n "$(MISSION_CONTROL_DB_PATH)" ]; then \
		echo "$(MISSION_CONTROL_DB_PATH)"; \
	else \
		echo "Mission Control DB 후보를 찾지 못했습니다."; \
		echo "확인한 경로:"; \
		printf "  %s\n" $(filter-out ,$(MC_DB_CANDIDATES)); \
		exit 1; \
	fi

help: ## 명령어 목록
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
