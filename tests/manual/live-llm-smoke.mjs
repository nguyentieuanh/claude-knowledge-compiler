// Manual smoke test — actually hit the configured LLM provider.
// Run with: node tests/manual/live-llm-smoke.mjs
// Requires .env with valid credentials (ANTHROPIC_API_KEY or OPENAI_API_KEY).

import { getLLMClient, getLLMProviderLabel, TOKEN_BUDGETS } from '../../src/compilers/llm-client.ts'

async function main() {
  const label = getLLMProviderLabel()
  console.log(`[smoke] Provider: ${label ?? '(none)'}`)

  const client = getLLMClient()
  if (!client) {
    console.error('[smoke] No LLM client configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env')
    process.exit(1)
  }

  const tests = [
    {
      name: 'conceptEnhance budget (small, fast)',
      prompt: 'Reply with exactly this JSON and nothing else: {"ok": true, "num": 42}',
      budget: TOKEN_BUDGETS.conceptEnhance,
    },
    {
      name: 'sessionDebrief budget (larger, slower)',
      prompt: 'Reply with this JSON: {"summary": "test", "items": ["a", "b", "c"]}',
      budget: TOKEN_BUDGETS.sessionDebrief,
    },
  ]

  let passed = 0
  let failed = 0

  for (const t of tests) {
    console.log(`\n[smoke] Test: ${t.name}`)
    console.log(`[smoke]   budget: max=${t.budget.maxTokens}, timeout=${t.budget.timeoutMs}ms`)
    const start = Date.now()
    try {
      const result = await client.complete(t.prompt, t.budget)
      const elapsed = Date.now() - start
      console.log(`[smoke]   elapsed: ${elapsed}ms`)
      console.log(`[smoke]   response (first 200 chars): ${result.slice(0, 200)}`)
      if (result.length === 0) {
        console.log('[smoke]   ⚠ Empty response')
        failed++
      } else {
        console.log('[smoke]   ✓ Got non-empty response')
        passed++
      }
    } catch (err) {
      const elapsed = Date.now() - start
      console.log(`[smoke]   ✗ Failed after ${elapsed}ms: ${err.message}`)
      failed++
    }
  }

  console.log(`\n[smoke] Summary: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('[smoke] Unexpected error:', err)
  process.exit(1)
})
