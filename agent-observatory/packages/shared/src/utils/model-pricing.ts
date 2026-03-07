/**
 * 모델별 토큰 단가 테이블 및 비용 추정 유틸리티.
 *
 * Claude Code JSONL의 costUSD 필드가 없거나 0인 경우
 * 모델 ID와 토큰 수를 기반으로 비용을 추정한다.
 *
 * 단가: USD per 1,000,000 tokens (MTok)
 * 출처: 각 공식 가격 페이지 (2026-03 기준)
 *   - Anthropic: https://www.anthropic.com/pricing
 *   - OpenAI:    https://developers.openai.com/api/docs/pricing
 *   - Google:    https://cloud.google.com/vertex-ai/generative-ai/pricing
 */

export interface ModelPricing {
  /** input tokens 단가 (USD/MTok) */
  input: number;
  /** output tokens 단가 (USD/MTok) */
  output: number;
}

/**
 * 모델 ID → 단가 매핑 테이블.
 *
 * 키는 정확한 모델 ID 또는 접두사 패턴으로 사용.
 * 접두사 기반 매칭은 `getPricing()` 함수에서 처리.
 * provider/ 접두사 포함 형식과 미포함 형식 모두 등록.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {

  // ─────────────────────────────────────────────────────────────
  // Anthropic Claude
  // 출처: https://www.anthropic.com/pricing
  // ─────────────────────────────────────────────────────────────

  // Claude Opus 4.6  (현행 최고 지능 모델)
  'claude-opus-4-6':                    { input:  5.00, output:  25.00 },
  'anthropic/claude-opus-4-6':          { input:  5.00, output:  25.00 },

  // Claude Opus 4.5
  'claude-opus-4-5':                    { input:  5.00, output:  25.00 },
  'anthropic/claude-opus-4-5':          { input:  5.00, output:  25.00 },

  // Claude Opus 4.1  (레거시 고가 Opus)
  'claude-opus-4-1':                    { input: 15.00, output:  75.00 },
  'anthropic/claude-opus-4-1':          { input: 15.00, output:  75.00 },

  // Claude Opus 4
  'claude-opus-4':                      { input: 15.00, output:  75.00 },
  'anthropic/claude-opus-4':            { input: 15.00, output:  75.00 },

  // Claude Sonnet 4.6
  'claude-sonnet-4-6':                  { input:  3.00, output:  15.00 },
  'anthropic/claude-sonnet-4-6':        { input:  3.00, output:  15.00 },

  // Claude Sonnet 4.5
  'claude-sonnet-4-5':                  { input:  3.00, output:  15.00 },
  'anthropic/claude-sonnet-4-5':        { input:  3.00, output:  15.00 },

  // Claude Sonnet 4
  'claude-sonnet-4':                    { input:  3.00, output:  15.00 },
  'anthropic/claude-sonnet-4':          { input:  3.00, output:  15.00 },

  // Claude Haiku 4.5
  'claude-haiku-4-5':                   { input:  1.00, output:   5.00 },
  'claude-haiku-4-5-20251001':          { input:  1.00, output:   5.00 },
  'anthropic/claude-haiku-4-5':         { input:  1.00, output:   5.00 },

  // Claude Haiku 4
  'claude-haiku-4':                     { input:  1.00, output:   5.00 },
  'anthropic/claude-haiku-4':           { input:  1.00, output:   5.00 },

  // Claude 3.7 Sonnet
  'claude-sonnet-3-7':                  { input:  3.00, output:  15.00 },
  'claude-3-7-sonnet':                  { input:  3.00, output:  15.00 },
  'claude-3-7-sonnet-20250219':         { input:  3.00, output:  15.00 },

  // Claude 3.5
  'claude-3-5-sonnet-20241022':         { input:  3.00, output:  15.00 },
  'claude-3-5-sonnet-20240620':         { input:  3.00, output:  15.00 },
  'claude-3-5-haiku-20241022':          { input:  0.80, output:   4.00 },

  // Claude 3
  'claude-3-opus-20240229':             { input: 15.00, output:  75.00 },
  'claude-3-sonnet-20240229':           { input:  3.00, output:  15.00 },
  'claude-3-haiku-20240307':            { input:  0.25, output:   1.25 },

  // ─────────────────────────────────────────────────────────────
  // OpenAI GPT
  // 출처: https://developers.openai.com/api/docs/pricing
  // ─────────────────────────────────────────────────────────────

  // GPT-5.4  (최고 성능, 기본 컨텍스트 기준)
  'gpt-5.4':                            { input:  2.50, output:  15.00 },
  'openai/gpt-5.4':                     { input:  2.50, output:  15.00 },

  // GPT-5.4 Pro
  'gpt-5.4-pro':                        { input: 30.00, output: 180.00 },
  'openai/gpt-5.4-pro':                 { input: 30.00, output: 180.00 },

  // GPT-5.3
  'gpt-5.3':                            { input:  1.75, output:  14.00 },
  'gpt-5.3-chat-latest':                { input:  1.75, output:  14.00 },
  'openai/gpt-5.3':                     { input:  1.75, output:  14.00 },

  // GPT-5.2
  'gpt-5.2':                            { input:  1.75, output:  14.00 },
  'gpt-5.2-chat-latest':                { input:  1.75, output:  14.00 },
  'gpt-5.2-codex':                      { input:  1.75, output:  14.00 },
  'openai/gpt-5.2':                     { input:  1.75, output:  14.00 },

  // GPT-5.2 Pro
  'gpt-5.2-pro':                        { input: 21.00, output: 168.00 },
  'openai/gpt-5.2-pro':                 { input: 21.00, output: 168.00 },

  // GPT-5.1
  'gpt-5.1':                            { input:  1.25, output:  10.00 },
  'gpt-5.1-chat-latest':                { input:  1.25, output:  10.00 },
  'gpt-5.1-codex':                      { input:  1.25, output:  10.00 },
  'gpt-5.1-codex-max':                  { input:  1.25, output:  10.00 },
  'openai/gpt-5.1':                     { input:  1.25, output:  10.00 },

  // GPT-5.1 Codex Mini
  'gpt-5.1-codex-mini':                 { input:  0.25, output:   2.00 },
  'openai/gpt-5.1-codex-mini':          { input:  0.25, output:   2.00 },

  // GPT-5
  'gpt-5':                              { input:  1.25, output:  10.00 },
  'gpt-5-chat-latest':                  { input:  1.25, output:  10.00 },
  'gpt-5-codex':                        { input:  1.25, output:  10.00 },
  'openai/gpt-5':                       { input:  1.25, output:  10.00 },

  // GPT-5 Pro
  'gpt-5-pro':                          { input: 15.00, output: 120.00 },
  'openai/gpt-5-pro':                   { input: 15.00, output: 120.00 },

  // GPT-5 Mini
  'gpt-5-mini':                         { input:  0.25, output:   2.00 },
  'openai/gpt-5-mini':                  { input:  0.25, output:   2.00 },

  // GPT-5 Nano
  'gpt-5-nano':                         { input:  0.05, output:   0.40 },
  'openai/gpt-5-nano':                  { input:  0.05, output:   0.40 },

  // GPT-4.1
  'gpt-4.1':                            { input:  2.00, output:   8.00 },
  'openai/gpt-4.1':                     { input:  2.00, output:   8.00 },

  // GPT-4.1 Mini
  'gpt-4.1-mini':                       { input:  0.40, output:   1.60 },
  'openai/gpt-4.1-mini':               { input:  0.40, output:   1.60 },

  // GPT-4.1 Nano
  'gpt-4.1-nano':                       { input:  0.10, output:   0.40 },
  'openai/gpt-4.1-nano':               { input:  0.10, output:   0.40 },

  // GPT-4o
  'gpt-4o':                             { input:  2.50, output:  10.00 },
  'gpt-4o-2024-11-20':                  { input:  2.50, output:  10.00 },
  'gpt-4o-2024-08-06':                  { input:  2.50, output:  10.00 },
  'gpt-4o-2024-05-13':                  { input:  5.00, output:  15.00 },
  'chatgpt-4o-latest':                  { input:  5.00, output:  15.00 },
  'openai/gpt-4o':                      { input:  2.50, output:  10.00 },

  // GPT-4o Mini
  'gpt-4o-mini':                        { input:  0.15, output:   0.60 },
  'gpt-4o-mini-2024-07-18':             { input:  0.15, output:   0.60 },
  'openai/gpt-4o-mini':                 { input:  0.15, output:   0.60 },

  // o1
  'o1':                                 { input: 15.00, output:  60.00 },
  'o1-2024-12-17':                      { input: 15.00, output:  60.00 },
  'openai/o1':                          { input: 15.00, output:  60.00 },

  // o1 Pro
  'o1-pro':                             { input: 150.00, output: 600.00 },
  'openai/o1-pro':                      { input: 150.00, output: 600.00 },

  // o3
  'o3':                                 { input:  2.00, output:   8.00 },
  'openai/o3':                          { input:  2.00, output:   8.00 },

  // o3 Pro
  'o3-pro':                             { input: 20.00, output:  80.00 },
  'openai/o3-pro':                      { input: 20.00, output:  80.00 },

  // o4-mini
  'o4-mini':                            { input:  1.10, output:   4.40 },
  'openai/o4-mini':                     { input:  1.10, output:   4.40 },

  // o3-mini
  'o3-mini':                            { input:  1.10, output:   4.40 },
  'openai/o3-mini':                     { input:  1.10, output:   4.40 },

  // o1-mini
  'o1-mini':                            { input:  1.10, output:   4.40 },
  'openai/o1-mini':                     { input:  1.10, output:   4.40 },

  // ─────────────────────────────────────────────────────────────
  // Google Gemini
  // 출처: https://cloud.google.com/vertex-ai/generative-ai/pricing
  // ─────────────────────────────────────────────────────────────

  // Gemini 3.1 Pro Preview
  'gemini-3.1-pro-preview':             { input:  2.00, output:  12.00 },
  'google/gemini-3.1-pro-preview':      { input:  2.00, output:  12.00 },

  // Gemini 3.1 Flash-Lite Preview
  'gemini-3.1-flash-lite-preview':      { input:  0.25, output:   1.50 },
  'google/gemini-3.1-flash-lite-preview': { input: 0.25, output:  1.50 },

  // Gemini 3 Pro Preview
  'gemini-3-pro-preview':               { input:  2.00, output:  12.00 },
  'google/gemini-3-pro-preview':        { input:  2.00, output:  12.00 },

  // Gemini 3 Flash Preview
  'gemini-3-flash-preview':             { input:  0.50, output:   3.00 },
  'google/gemini-3-flash-preview':      { input:  0.50, output:   3.00 },

  // Gemini 2.5 Pro
  'gemini-2.5-pro':                     { input:  1.25, output:  10.00 },
  'gemini-2.5-pro-preview':             { input:  1.25, output:  10.00 },
  'google/gemini-2.5-pro':              { input:  1.25, output:  10.00 },
  'google/gemini-2.5-pro-preview':      { input:  1.25, output:  10.00 },

  // Gemini 2.5 Flash
  'gemini-2.5-flash':                   { input:  0.30, output:   2.50 },
  'gemini-2.5-flash-preview':           { input:  0.30, output:   2.50 },
  'google/gemini-2.5-flash':            { input:  0.30, output:   2.50 },
  'google/gemini-2.5-flash-preview':    { input:  0.30, output:   2.50 },

  // Gemini 2.5 Flash Lite
  'gemini-2.5-flash-lite':              { input:  0.10, output:   0.40 },
  'google/gemini-2.5-flash-lite':       { input:  0.10, output:   0.40 },

  // Gemini 2.0 Flash
  'gemini-2.0-flash':                   { input:  0.15, output:   0.60 },
  'gemini-2.0-flash-001':               { input:  0.15, output:   0.60 },
  'google/gemini-2.0-flash':            { input:  0.15, output:   0.60 },

  // Gemini 2.0 Flash Lite
  'gemini-2.0-flash-lite':              { input:  0.075, output:  0.30 },
  'google/gemini-2.0-flash-lite':       { input:  0.075, output:  0.30 },

  // Gemini 1.5 Pro (캐릭터→토큰 환산: 4char ≈ 1tok)
  'gemini-1.5-pro':                     { input:  1.25, output:   5.00 },
  'google/gemini-1.5-pro':              { input:  1.25, output:   5.00 },

  // Gemini 1.5 Flash
  'gemini-1.5-flash':                   { input:  0.075, output:  0.30 },
  'google/gemini-1.5-flash':            { input:  0.075, output:  0.30 },
};

/**
 * 모델 ID로 가격을 조회한다.
 *
 * 1. 정확한 ID 매칭
 * 2. 대소문자 무시 정확한 매칭
 * 3. 접두사 기반 매칭 (더 긴 접두사가 우선)
 * 4. 없으면 undefined 반환
 */
export function getPricing(modelId: string): ModelPricing | undefined {
  if (!modelId) return undefined;

  // 1. 정확한 매칭
  if (modelId in MODEL_PRICING) return MODEL_PRICING[modelId];

  // 2. 대소문자 무시 정확한 매칭
  const lower = modelId.toLowerCase();
  for (const key of Object.keys(MODEL_PRICING)) {
    if (key.toLowerCase() === lower) return MODEL_PRICING[key];
  }

  // 3. 접두사 매칭 (더 긴 것 우선)
  let bestMatch: ModelPricing | undefined;
  let bestLen = 0;
  for (const key of Object.keys(MODEL_PRICING)) {
    if (lower.startsWith(key.toLowerCase()) && key.length > bestLen) {
      bestMatch = MODEL_PRICING[key];
      bestLen = key.length;
    }
  }

  return bestMatch;
}

/**
 * 토큰 수와 모델 ID로 비용(USD)을 추정한다.
 *
 * 모델 가격을 알 수 없으면 0을 반환한다.
 *
 * @param modelId - 모델 ID (예: "claude-sonnet-4-6", "gpt-5.2", "gemini-2.5-pro")
 * @param inputTokens - 입력 토큰 수
 * @param outputTokens - 출력 토큰 수
 * @returns 추정 비용 (USD)
 */
export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getPricing(modelId);
  if (!pricing) return 0;

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}
