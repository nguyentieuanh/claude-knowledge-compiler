// ─── LLM Client Abstraction ───────────────────────────────────────────────────
// Supports Anthropic and any OpenAI-compatible provider.
//
// Priority: ANTHROPIC_API_KEY > OPENAI_API_KEY > deterministic fallback
//
// OpenAI-compatible env vars:
//   OPENAI_API_KEY    — required to activate OpenAI path
//   OPENAI_BASE_URL   — custom base URL (OpenRouter, Groq, Ollama, etc.)
//   OPENAI_MODEL      — model name override (default: gpt-4o-mini)
//
// Anthropic env vars:
//   ANTHROPIC_API_KEY — required to activate Anthropic path
//   ANTHROPIC_MODEL   — model name override (default: claude-haiku-4-5-20251001)
//
// Examples:
//   # OpenRouter
//   OPENAI_API_KEY=sk-or-... OPENAI_BASE_URL=https://openrouter.ai/api/v1 OPENAI_MODEL=meta-llama/llama-3.1-8b-instruct
//
//   # Groq
//   OPENAI_API_KEY=gsk_... OPENAI_BASE_URL=https://api.groq.com/openai/v1 OPENAI_MODEL=llama-3.1-8b-instant
//
//   # Ollama (local)
//   OPENAI_API_KEY=ollama OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=qwen2.5-coder:7b

import { config as loadDotenv } from 'dotenv'
import { join } from 'node:path'

// Load .env once at module init (for hook commands that run without env vars)
// Search order: plugin dir (.env next to dist/), then project root
let _envLoaded = false
export function ensureEnvLoaded(): void {
  if (_envLoaded) return
  _envLoaded = true

  // 1. Try plugin install dir (e.g. ~/.dkc/.env)
  const pluginRoot = process.env['CLAUDE_PLUGIN_ROOT']
  if (pluginRoot) {
    loadDotenv({ path: join(pluginRoot, '.env') })
  }

  // 2. Try ~/.dkc/.env (common install location)
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? ''
  if (home) {
    loadDotenv({ path: join(home, '.dkc', '.env') })
  }

  // 3. Try project root .env (lowest priority, won't override existing)
  const projectRoot = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
  loadDotenv({ path: join(projectRoot, '.env') })
}

// ─── Token Budgets ────────────────────────────────────────────────────────────
// Per-use-case limits to prevent runaway reasoning and control costs.

export const TOKEN_BUDGETS = {
  sessionDebrief: { maxTokens: 30000, timeoutMs: 45_000 },
  conceptEnhance: { maxTokens: 30000, timeoutMs: 15_000 },
  /** Cap for thinking/reasoning tokens on models that support it (Qwen3, DeepSeek-R1) */
  thinkingBudget: 1024,
} as const

// ─── LLM Client Interface ────────────────────────────────────────────────────

export interface LLMCallOptions {
  maxTokens?: number
  timeoutMs?: number
}

export interface LLMClient {
  provider: string   // 'anthropic' | 'openai' | custom baseURL host
  model: string
  complete(prompt: string, options?: LLMCallOptions): Promise<string>
}

export function getLLMClient(): LLMClient | null {
  ensureEnvLoaded()

  const anthropicKey = process.env['ANTHROPIC_API_KEY']
  const openaiKey = process.env['OPENAI_API_KEY']

  if (anthropicKey) {
    const model = process.env['ANTHROPIC_MODEL'] ?? 'claude-haiku-4-5-20251001'
    return createAnthropicClient(anthropicKey, model)
  }
  if (openaiKey) {
    const baseURL = process.env['OPENAI_BASE_URL']
    const model = process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini'
    return createOpenAIClient(openaiKey, model, baseURL)
  }
  return null
}

/** Human-readable provider label for CLI output */
export function getLLMProviderLabel(): string | null {
  ensureEnvLoaded()
  if (process.env['ANTHROPIC_API_KEY']) {
    const model = process.env['ANTHROPIC_MODEL'] ?? 'claude-haiku-4-5-20251001'
    return `anthropic/${model}`
  }
  if (process.env['OPENAI_API_KEY']) {
    const model = process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini'
    const baseURL = process.env['OPENAI_BASE_URL']
    if (baseURL) {
      try {
        const host = new URL(baseURL).hostname
        return `${host}/${model}`
      } catch {
        return `openai-compat/${model}`
      }
    }
    return `openai/${model}`
  }
  return null
}

// ─── Model detection helpers ──────────────────────────────────────────────────

function isOpenAIReasoningModel(model: string): boolean {
  return /\b(o1|o3|o4)\b/.test(model.toLowerCase())
}

function isDeepSeekModel(model: string): boolean {
  const m = model.toLowerCase()
  return m.includes('deepseek-r1') || m.includes('deepseek-reasoner')
}

function isReasoningModel(model: string): boolean {
  return isOpenAIReasoningModel(model) || isDeepSeekModel(model)
}

function isQwenModel(model: string): boolean {
  return model.toLowerCase().includes('qwen')
}

function isThinkingModel(model: string): boolean {
  return isReasoningModel(model) || isQwenModel(model)
}

// ─── Retry & Timeout ──────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      lastErr = err
      const status = (err as { status?: number })?.status
      // Retry on 429 (rate-limit) or 529 (overloaded)
      if ((status === 429 || status === 529) && attempt < maxAttempts) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 8000)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)

  try {
    const result = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new Error(`LLM call timed out after ${ms}ms (${label})`))
        )
      }),
    ])
    return result
  } finally {
    clearTimeout(timer)
  }
}

// ─── Anthropic Client ─────────────────────────────────────────────────────────

function createAnthropicClient(apiKey: string, model: string): LLMClient {
  return {
    provider: 'anthropic',
    model,
    async complete(prompt: string, options?: LLMCallOptions): Promise<string> {
      const maxTokens = options?.maxTokens ?? TOKEN_BUDGETS.sessionDebrief.maxTokens
      const timeoutMs = options?.timeoutMs ?? TOKEN_BUDGETS.sessionDebrief.timeoutMs

      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey })

      const apiCall = withRetry(() => client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }))

      const response = await withTimeout(apiCall, timeoutMs, `anthropic/${model}`)

      return response.content
        .filter((b) => b.type === 'text')
        .map((b) => 'text' in b ? (b as { text: string }).text : '')
        .join('')
        .trim()
    },
  }
}

// ─── OpenAI-compatible Client ─────────────────────────────────────────────────

function createOpenAIClient(apiKey: string, model: string, baseURL?: string): LLMClient {
  const providerLabel = baseURL
    ? (() => { try { return new URL(baseURL).hostname } catch { return 'openai-compat' } })()
    : 'openai'

  return {
    provider: providerLabel,
    model,
    async complete(prompt: string, options?: LLMCallOptions): Promise<string> {
      const maxTokens = options?.maxTokens ?? TOKEN_BUDGETS.sessionDebrief.maxTokens
      const timeoutMs = options?.timeoutMs ?? TOKEN_BUDGETS.sessionDebrief.timeoutMs

      const { default: OpenAI } = await import('openai')
      const client = new OpenAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      })

      const params: Record<string, unknown> = {
        model,
        messages: [
          // Qwen3.5 does NOT support /think or /no_think soft switches.
          // Thinking is controlled via chat_template_kwargs (see Qwen branch below).
          { role: 'system', content: 'You are a helpful assistant that outputs JSON.' },
          { role: 'user', content: prompt },
        ],
      }

      // ── Model-specific params ──────────────────────────────────────────
      if (isOpenAIReasoningModel(model)) {
        // OpenAI reasoning models (o1, o3, o4): use max_completion_tokens, not max_tokens
        params['max_completion_tokens'] = maxTokens
        params['reasoning_effort'] = 'low'
        // Reasoning models don't support system messages — move to user
        params['messages'] = [
          { role: 'user', content: `You are a helpful assistant that outputs JSON.\n\n${prompt}` },
        ]
      } else {
        params['max_tokens'] = maxTokens
      }

      // Qwen3.5: disable thinking via chat_template_kwargs (Instruct/Non-Thinking mode).
      // Qwen3.5 does not support /think or /no_think soft switches — must use this param.
      // Without this, Qwen3.5 reasons by default, which can exhaust max_tokens budget
      // and leave message.content = null.
      // Ref: official Qwen3.5 docs — extra_body.chat_template_kwargs.enable_thinking
      if (isQwenModel(model)) {
        params['extra_body'] = {
          chat_template_kwargs: { enable_thinking: false },
        }
      }

      // DeepSeek-R1: max_tokens covers reasoning + output combined
      // Use max_completion_tokens to cap total (reasoning is included)
      if (isDeepSeekModel(model)) {
        params['max_completion_tokens'] = maxTokens
        delete params['max_tokens']
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apiCall = withRetry(() => client.chat.completions.create(params as any))
      const response = await withTimeout(apiCall, timeoutMs, `${providerLabel}/${model}`) as any

      const message = response.choices?.[0]?.message
      const finishReason = response.choices?.[0]?.finish_reason

      // Some reasoning deployments (e.g. Qwen3.5 on vLLM) return message.content = null
      // when thinking exhausts the max_tokens budget. In that case, salvage from
      // reasoning_content if present so the caller has SOMETHING to work with instead
      // of silently falling back to deterministic mode.
      let raw: string = message?.content?.trim() ?? ''
      if (!raw && message?.reasoning_content) {
        const reasoning = String(message.reasoning_content).trim()
        if (reasoning) {
          console.warn(
            `[DKC] ${providerLabel}/${model}: content was empty (finish=${finishReason}), ` +
            `salvaging ${reasoning.length} chars from reasoning_content. ` +
            `Consider increasing max_tokens or disabling thinking mode.`
          )
          raw = reasoning
        }
      }

      // Strip thinking tags from models that wrap response in <think>...</think>
      return stripThinkingTags(raw)
    },
  }
}

// ─── Response cleaning ────────────────────────────────────────────────────────

function stripThinkingTags(text: string): string {
  if (!text.includes('<think>')) return text

  if (text.includes('</think>')) {
    // Complete thinking block — strip it
    return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim()
  }

  // Thinking tag not closed (truncated by max_tokens) — content got cut off
  // Try to salvage content after incomplete thinking
  const afterThink = text.indexOf('<think>')
  const beforeThink = text.slice(0, afterThink).trim()
  return beforeThink || ''
}
