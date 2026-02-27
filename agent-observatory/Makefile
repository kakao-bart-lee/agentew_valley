.PHONY: dev dev-server dev-web build build-shared test lint clean kill help

# 기본 타겟
.DEFAULT_GOAL := help

## 개발 서버
dev: ## 서버 + 웹 동시 실행
	pnpm dev

dev-server: ## 서버만 실행
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

kill: ## 개발 서버 프로세스 종료 (포트 3000, 5173)
	@lsof -ti :3000,:5173 2>/dev/null | xargs kill -9 2>/dev/null && echo "프로세스 종료 완료" || echo "실행 중인 프로세스 없음"

help: ## 명령어 목록
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
