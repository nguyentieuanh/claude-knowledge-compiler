import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock SDK modules BEFORE importing llm-client ─────────────────────────────
// Capture every params object sent to the SDK so we can assert on it.

const anthropicCreate = vi.fn()
const openaiCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: anthropicCreate },
  })),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: openaiCreate } },
  })),
}))

// ─── Import AFTER mocks are set up ────────────────────────────────────────────

import { getLLMClient, TOKEN_BUDGETS, ensureEnvLoaded } from '../../../src/compilers/llm-client.js'

// Trigger dotenv load ONCE so the module-level `_envLoaded` guard flips to true.
// After this, subsequent calls to getLLMClient() will skip dotenv reloading,
// letting our per-test env manipulation stick.
ensureEnvLoaded()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

function resetLLMEnv() {
  delete process.env['ANTHROPIC_API_KEY']
  delete process.env['ANTHROPIC_MODEL']
  delete process.env['OPENAI_API_KEY']
  delete process.env['OPENAI_BASE_URL']
  delete process.env['OPENAI_MODEL']
}

const savedEnv = { ...process.env }

beforeEach(() => {
  anthropicCreate.mockReset()
  openaiCreate.mockReset()
  resetLLMEnv()
})

afterEach(() => {
  // Restore any env vars we touched
  resetLLMEnv()
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']) {
    if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k]
  }
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LLM client — provider selection', () => {
  it('returns null when no provider configured', () => {
    expect(getLLMClient()).toBeNull()
  })

  it('selects Anthropic when ANTHROPIC_API_KEY is set', () => {
    setEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' })
    const client = getLLMClient()
    expect(client?.provider).toBe('anthropic')
    expect(client?.model).toBe('claude-haiku-4-5-20251001')
  })

  it('selects OpenAI when only OPENAI_API_KEY is set', () => {
    setEnv({ OPENAI_API_KEY: 'sk-test' })
    const client = getLLMClient()
    expect(client?.provider).toBe('openai')
    expect(client?.model).toBe('gpt-4o-mini')
  })

  it('prefers Anthropic over OpenAI when both keys present', () => {
    setEnv({ ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-test' })
    expect(getLLMClient()?.provider).toBe('anthropic')
  })

  it('uses custom baseURL host as provider label', () => {
    setEnv({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENAI_MODEL: 'meta-llama/llama-3.1-8b-instruct',
    })
    expect(getLLMClient()?.provider).toBe('openrouter.ai')
  })
})

describe('LLM client — Anthropic params', () => {
  it('sends max_tokens and correct message format', async () => {
    setEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' })
    anthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'hello world' }],
    })

    const client = getLLMClient()!
    const result = await client.complete('test prompt', TOKEN_BUDGETS.conceptEnhance)

    expect(result).toBe('hello world')
    expect(anthropicCreate).toHaveBeenCalledOnce()
    const params = anthropicCreate.mock.calls[0]![0]
    expect(params.max_tokens).toBe(TOKEN_BUDGETS.conceptEnhance.maxTokens)
    expect(params.messages).toEqual([{ role: 'user', content: 'test prompt' }])
    expect(params.model).toBe('claude-haiku-4-5-20251001')
  })

  it('uses sessionDebrief budget', async () => {
    setEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' })
    anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })

    const client = getLLMClient()!
    await client.complete('prompt', TOKEN_BUDGETS.sessionDebrief)

    expect(anthropicCreate.mock.calls[0]![0].max_tokens).toBe(TOKEN_BUDGETS.sessionDebrief.maxTokens)
  })
})

describe('LLM client — OpenAI standard model (gpt-4o-mini)', () => {
  beforeEach(() => {
    setEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-4o-mini' })
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'standard response' } }],
    })
  })

  it('uses max_tokens (not max_completion_tokens)', async () => {
    const client = getLLMClient()!
    await client.complete('prompt', TOKEN_BUDGETS.conceptEnhance)

    const params = openaiCreate.mock.calls[0]![0]
    expect(params.max_tokens).toBe(TOKEN_BUDGETS.conceptEnhance.maxTokens)
    expect(params.max_completion_tokens).toBeUndefined()
    expect(params.reasoning_effort).toBeUndefined()
  })

  it('sends system + user messages', async () => {
    const client = getLLMClient()!
    await client.complete('prompt', TOKEN_BUDGETS.conceptEnhance)

    const params = openaiCreate.mock.calls[0]![0]
    expect(params.messages).toHaveLength(2)
    expect(params.messages[0].role).toBe('system')
    expect(params.messages[1].role).toBe('user')
    expect(params.messages[1].content).toBe('prompt')
  })

  it('does NOT send extra_body (not a Qwen model)', async () => {
    const client = getLLMClient()!
    await client.complete('prompt', TOKEN_BUDGETS.conceptEnhance)

    const params = openaiCreate.mock.calls[0]![0]
    expect(params.extra_body).toBeUndefined()
  })
})

describe('LLM client — OpenAI reasoning models (o1/o3/o4)', () => {
  beforeEach(() => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'reasoning response' } }],
    })
  })

  it('o1: uses max_completion_tokens and reasoning_effort', async () => {
    setEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'o1' })
    const client = getLLMClient()!
    await client.complete('prompt', TOKEN_BUDGETS.sessionDebrief)

    const params = openaiCreate.mock.calls[0]![0]
    expect(params.max_completion_tokens).toBe(TOKEN_BUDGETS.sessionDebrief.maxTokens)
    expect(params.max_tokens).toBeUndefined()
    expect(params.reasoning_effort).toBe('low')
  })

  it('o3-mini: moves system prompt into user message', async () => {
    setEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'o3-mini' })
    const client = getLLMClient()!
    await client.complete('test content', TOKEN_BUDGETS.conceptEnhance)

    const params = openaiCreate.mock.calls[0]![0]
    expect(params.messages).toHaveLength(1)
    expect(params.messages[0].role).toBe('user')
    expect(params.messages[0].content).toContain('test content')
  })

  it('o4-mini: recognized as reasoning model', async () => {
    setEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'o4-mini' })
    const client = getLLMClient()!
    await client.complete('prompt', TOKEN_BUDGETS.conceptEnhance)

    const params = openaiCreate.mock.calls[0]![0]
    expect(params.max_completion_tokens).toBe(TOKEN_BUDGETS.conceptEnhance.maxTokens)
    expect(params.reasoning_effort).toBe('low')
  })
})

describe('LLM client — Qwen non-thinking mode', () => {
  beforeEach(() => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'qwen response' } }],
    })
  })

  it('Qwen3.5: disables thinking via chat_template_kwargs.enable_thinking = false', async () => {
    setEnv({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'http://localhost:8000/v1',
      OPENAI_MODEL: 'Qwen/Qwen3.5-122B-A10B-FP8',
    })
    const client = getLLMClient()!
    await client.complete('prompt', TOKEN_BUDGETS.sessionDebrief)

    const params = openaiCreate.mock.calls[0]![0]
    expect(params.extra_body).toBeDefined()
    expect(params.extra_body.chat_template_kwargs.enable_thinking).toBe(false)
  })

  it('Qwen: system prompt does NOT contain /no_think soft switch', async () => {
    setEnv({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'qwen3-8b',
    })
    const client = getLLMClient()!
    await client.complete('prompt', TOKEN_BUDGETS.conceptEnhance)

    const params = openaiCreate.mock.calls[0]![0]
    const systemMsg = params.messages.find((m: { role: string }) => m.role === 'system')
    expect(systemMsg?.content).not.toContain('/no_think')
  })

  it('Qwen: still uses max_tokens (not max_completion_tokens)', async () => {
    setEnv({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'qwen2.5-coder:7b',
    })
    const client = getLLMClient()!
    await client.complete('prompt', TOKEN_BUDGETS.sessionDebrief)

    const params = openaiCreate.mock.calls[0]![0]
    expect(params.max_tokens).toBe(TOKEN_BUDGETS.sessionDebrief.maxTokens)
    expect(params.max_completion_tokens).toBeUndefined()
  })
})

describe('LLM client — DeepSeek-R1', () => {
  beforeEach(() => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'deepseek response' } }],
    })
  })

  it('deepseek-r1: uses max_completion_tokens (not max_tokens)', async () => {
    setEnv({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'deepseek-r1',
    })
    const client = getLLMClient()!
    await client.complete('prompt', TOKEN_BUDGETS.sessionDebrief)

    const params = openaiCreate.mock.calls[0]![0]
    expect(params.max_completion_tokens).toBe(TOKEN_BUDGETS.sessionDebrief.maxTokens)
    expect(params.max_tokens).toBeUndefined()
  })

  it('deepseek-reasoner: same treatment', async () => {
    setEnv({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'deepseek-reasoner',
    })
    const client = getLLMClient()!
    await client.complete('prompt', TOKEN_BUDGETS.conceptEnhance)

    const params = openaiCreate.mock.calls[0]![0]
    expect(params.max_completion_tokens).toBe(TOKEN_BUDGETS.conceptEnhance.maxTokens)
    expect(params.max_tokens).toBeUndefined()
  })
})

describe('LLM client — response cleaning', () => {
  it('strips complete <think> blocks from response', async () => {
    setEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'qwen3-8b' })
    openaiCreate.mockResolvedValue({
      choices: [{
        message: {
          content: '<think>reasoning tokens here</think>\nFinal answer: 42',
        },
      }],
    })

    const client = getLLMClient()!
    const result = await client.complete('prompt', TOKEN_BUDGETS.conceptEnhance)
    expect(result).toBe('Final answer: 42')
    expect(result).not.toContain('<think>')
  })

  it('salvages content before truncated <think> tag', async () => {
    setEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'qwen3-8b' })
    openaiCreate.mockResolvedValue({
      choices: [{
        message: {
          content: 'Partial answer.\n<think>unclosed reasoning...',
        },
      }],
    })

    const client = getLLMClient()!
    const result = await client.complete('prompt', TOKEN_BUDGETS.conceptEnhance)
    expect(result).toBe('Partial answer.')
  })

  it('passes through text without thinking tags unchanged', async () => {
    setEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-4o-mini' })
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'clean response' } }],
    })

    const client = getLLMClient()!
    const result = await client.complete('prompt', TOKEN_BUDGETS.conceptEnhance)
    expect(result).toBe('clean response')
  })

  it('salvages reasoning_content when content is null (Qwen3.5 thinking exhaust case)', async () => {
    setEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'Qwen/Qwen3.5-122B' })
    openaiCreate.mockResolvedValue({
      choices: [{
        finish_reason: 'length',
        message: {
          content: null,
          reasoning_content: 'The answer is {"result": 42}',
        },
      }],
    })

    // Suppress expected warning noise in test output
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const client = getLLMClient()!
    const result = await client.complete('prompt', TOKEN_BUDGETS.conceptEnhance)
    expect(result).toBe('The answer is {"result": 42}')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('returns empty string when both content and reasoning_content are null', async () => {
    setEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-4o-mini' })
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
    })

    const client = getLLMClient()!
    const result = await client.complete('prompt', TOKEN_BUDGETS.conceptEnhance)
    expect(result).toBe('')
  })
})

describe('LLM client — TOKEN_BUDGETS structure', () => {
  it('has required budgets defined', () => {
    expect(TOKEN_BUDGETS.sessionDebrief.maxTokens).toBeGreaterThan(0)
    expect(TOKEN_BUDGETS.sessionDebrief.timeoutMs).toBeGreaterThan(0)
    expect(TOKEN_BUDGETS.conceptEnhance.maxTokens).toBeGreaterThan(0)
    expect(TOKEN_BUDGETS.conceptEnhance.timeoutMs).toBeGreaterThan(0)
    expect(TOKEN_BUDGETS.thinkingBudget).toBeGreaterThan(0)
  })

  it('sessionDebrief budget >= conceptEnhance budget', () => {
    expect(TOKEN_BUDGETS.sessionDebrief.maxTokens)
      .toBeGreaterThanOrEqual(TOKEN_BUDGETS.conceptEnhance.maxTokens)
  })

  it('sessionDebrief has longer timeout than conceptEnhance', () => {
    expect(TOKEN_BUDGETS.sessionDebrief.timeoutMs)
      .toBeGreaterThan(TOKEN_BUDGETS.conceptEnhance.timeoutMs)
  })
})
