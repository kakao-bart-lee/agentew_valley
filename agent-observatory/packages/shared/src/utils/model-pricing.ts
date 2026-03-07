/**
 * 모델별 토큰 단가 테이블 및 비용 추정 유틸리티.
 *
 * Claude Code JSONL의 costUSD 필드가 없거나 0인 경우
 * 모델 ID와 토큰 수를 기반으로 비용을 추정한다.
 *
 * 단가: USD per 1,000,000 tokens (MTok)
 * 출처: 각 공식 가격 페이지 (2026-03 기준)
 *   - Anthropic:   https://www.anthropic.com/pricing
 *   - OpenAI:      https://developers.openai.com/api/docs/pricing
 *   - Google:      https://cloud.google.com/vertex-ai/generative-ai/pricing
 *   - OpenRouter:  https://openrouter.ai/api/v1/models (API)
 *   - z.ai (GLM):  https://z.ai  (via OpenRouter API)
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

  // ─────────────────────────────────────────────────────────────
  // z.ai / GLM (Zhipu AI)
  // 출처: OpenRouter API (https://openrouter.ai/api/v1/models)
  // ─────────────────────────────────────────────────────────────

  // GLM-5
  'glm-5':                              { input:  0.80, output:  2.56 },
  'z-ai/glm-5':                         { input:  0.80, output:  2.56 },

  // GLM-4.7
  'glm-4.7':                            { input:  0.38, output:  1.98 },
  'z-ai/glm-4.7':                       { input:  0.38, output:  1.98 },

  // GLM-4.7 Flash
  'glm-4.7-flash':                      { input:  0.06, output:  0.40 },
  'z-ai/glm-4.7-flash':                 { input:  0.06, output:  0.40 },

  // GLM-4.6
  'glm-4.6':                            { input:  0.39, output:  1.90 },
  'z-ai/glm-4.6':                       { input:  0.39, output:  1.90 },

  // GLM-4.6V (Vision)
  'glm-4.6v':                           { input:  0.30, output:  0.90 },
  'z-ai/glm-4.6v':                      { input:  0.30, output:  0.90 },

  // GLM-4.5
  'glm-4.5':                            { input:  0.60, output:  2.20 },
  'z-ai/glm-4.5':                       { input:  0.60, output:  2.20 },

  // GLM-4.5 Air
  'glm-4.5-air':                        { input:  0.13, output:  0.85 },
  'z-ai/glm-4.5-air':                   { input:  0.13, output:  0.85 },

  // GLM-4.5V (Vision)
  'glm-4.5v':                           { input:  0.60, output:  1.80 },
  'z-ai/glm-4.5v':                      { input:  0.60, output:  1.80 },

  // GLM-4-32B
  'glm-4-32b':                          { input:  0.10, output:  0.10 },
  'z-ai/glm-4-32b':                     { input:  0.10, output:  0.10 },

  // ─────────────────────────────────────────────────────────────
  // xAI / Grok
  // 출처: OpenRouter API
  // ─────────────────────────────────────────────────────────────

  // Grok 4
  'grok-4':                             { input:  3.00, output: 15.00 },
  'x-ai/grok-4':                        { input:  3.00, output: 15.00 },

  // Grok 4 Fast
  'grok-4-fast':                        { input:  0.20, output:  0.50 },
  'x-ai/grok-4-fast':                   { input:  0.20, output:  0.50 },

  // Grok 4.1 Fast
  'grok-4.1-fast':                      { input:  0.20, output:  0.50 },
  'x-ai/grok-4.1-fast':                 { input:  0.20, output:  0.50 },

  // Grok 3
  'grok-3':                             { input:  3.00, output: 15.00 },
  'grok-3-beta':                        { input:  3.00, output: 15.00 },
  'x-ai/grok-3':                        { input:  3.00, output: 15.00 },
  'x-ai/grok-3-beta':                   { input:  3.00, output: 15.00 },

  // Grok 3 Mini
  'grok-3-mini':                        { input:  0.30, output:  0.50 },
  'grok-3-mini-beta':                   { input:  0.30, output:  0.50 },
  'x-ai/grok-3-mini':                   { input:  0.30, output:  0.50 },
  'x-ai/grok-3-mini-beta':              { input:  0.30, output:  0.50 },

  // Grok Code Fast
  'grok-code-fast-1':                   { input:  0.20, output:  1.50 },
  'x-ai/grok-code-fast-1':              { input:  0.20, output:  1.50 },

  // ─────────────────────────────────────────────────────────────
  // DeepSeek
  // 출처: OpenRouter API
  // ─────────────────────────────────────────────────────────────

  // DeepSeek R1
  'deepseek-r1':                        { input:  0.70, output:  2.50 },
  'deepseek/deepseek-r1':               { input:  0.70, output:  2.50 },

  // DeepSeek R1 0528
  'deepseek-r1-0528':                   { input:  0.45, output:  2.15 },
  'deepseek/deepseek-r1-0528':          { input:  0.45, output:  2.15 },

  // DeepSeek V3.2
  'deepseek-v3.2':                      { input:  0.25, output:  0.40 },
  'deepseek/deepseek-v3.2':             { input:  0.25, output:  0.40 },

  // DeepSeek Chat (V3)
  'deepseek-chat':                      { input:  0.20, output:  0.77 },
  'deepseek/deepseek-chat':             { input:  0.20, output:  0.77 },
  'deepseek/deepseek-chat-v3-0324':     { input:  0.20, output:  0.77 },

  // ─────────────────────────────────────────────────────────────
  // Qwen (Alibaba)
  // 출처: OpenRouter API
  // ─────────────────────────────────────────────────────────────

  // Qwen3 235B
  'qwen3-235b-a22b':                    { input:  0.455, output:  1.82 },
  'qwen/qwen3-235b-a22b':               { input:  0.455, output:  1.82 },

  // Qwen3 Max
  'qwen3-max':                          { input:  1.20, output:  6.00 },
  'qwen/qwen3-max':                     { input:  1.20, output:  6.00 },

  // Qwen3 Coder
  'qwen3-coder':                        { input:  0.22, output:  1.00 },
  'qwen/qwen3-coder':                   { input:  0.22, output:  1.00 },

  // Qwen3 32B
  'qwen3-32b':                          { input:  0.08, output:  0.24 },
  'qwen/qwen3-32b':                     { input:  0.08, output:  0.24 },

  // QwQ 32B
  'qwq-32b':                            { input:  0.15, output:  0.40 },
  'qwen/qwq-32b':                       { input:  0.15, output:  0.40 },

  // Qwen Max
  'qwen-max':                           { input:  1.04, output:  4.16 },
  'qwen/qwen-max':                      { input:  1.04, output:  4.16 },

  // ─────────────────────────────────────────────────────────────
  // Mistral AI
  // 출처: OpenRouter API
  // ─────────────────────────────────────────────────────────────

  // Mistral Large 2512
  'mistral-large-2512':                 { input:  0.50, output:  1.50 },
  'mistralai/mistral-large-2512':       { input:  0.50, output:  1.50 },

  // Mistral Large (이전 버전)
  'mistral-large':                      { input:  2.00, output:  6.00 },
  'mistralai/mistral-large':            { input:  2.00, output:  6.00 },

  // Mistral Medium 3.1
  'mistral-medium-3.1':                 { input:  0.40, output:  2.00 },
  'mistralai/mistral-medium-3.1':       { input:  0.40, output:  2.00 },

  // Mistral Small 3.2
  'mistral-small-3.2-24b-instruct':     { input:  0.06, output:  0.18 },
  'mistralai/mistral-small-3.2-24b-instruct': { input: 0.06, output: 0.18 },

  // Codestral
  'codestral-2508':                     { input:  0.30, output:  0.90 },
  'mistralai/codestral-2508':           { input:  0.30, output:  0.90 },

  // Devstral
  'devstral-medium':                    { input:  0.40, output:  2.00 },
  'mistralai/devstral-medium':          { input:  0.40, output:  2.00 },

  // ─────────────────────────────────────────────────────────────
  // Meta Llama
  // 출처: OpenRouter API
  // ─────────────────────────────────────────────────────────────

  // Llama 4 Maverick
  'llama-4-maverick':                   { input:  0.15, output:  0.60 },
  'meta-llama/llama-4-maverick':        { input:  0.15, output:  0.60 },

  // Llama 4 Scout
  'llama-4-scout':                      { input:  0.08, output:  0.30 },
  'meta-llama/llama-4-scout':           { input:  0.08, output:  0.30 },

  // Llama 3.3 70B
  'llama-3.3-70b-instruct':             { input:  0.10, output:  0.32 },
  'meta-llama/llama-3.3-70b-instruct':  { input:  0.10, output:  0.32 },

  // ─────────────────────────────────────────────────────────────
  // Amazon Nova
  // 출처: OpenRouter API
  // ─────────────────────────────────────────────────────────────

  'nova-2-lite-v1':                     { input:  0.30, output:  2.50 },
  'amazon/nova-2-lite-v1':              { input:  0.30, output:  2.50 },
  'nova-premier-v1':                    { input:  2.50, output: 12.50 },
  'amazon/nova-premier-v1':             { input:  2.50, output: 12.50 },
  'nova-pro-v1':                        { input:  0.80, output:  3.20 },
  'amazon/nova-pro-v1':                 { input:  0.80, output:  3.20 },
  'nova-lite-v1':                       { input:  0.06, output:  0.24 },
  'amazon/nova-lite-v1':                { input:  0.06, output:  0.24 },
  'nova-micro-v1':                      { input:  0.035, output: 0.14 },
  'amazon/nova-micro-v1':               { input:  0.035, output: 0.14 },
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
