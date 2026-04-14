import { config } from 'dotenv'
config()

const { default: OpenAI } = await import('openai')
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
})

const showErr = (label, e) => {
  console.error(`${label}:`, e.message)
  console.error(`  status: ${e.status}`)
  console.error(`  code: ${e.code}`)
  console.error(`  type: ${e.type}`)
  try { console.error(`  body: ${JSON.stringify(e.error).slice(0, 300)}`) } catch {}
}

console.log('=== Test 0: Baseline — no extra params (should work) ===')
try {
  const r = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 20,
  })
  console.log('OK content:', JSON.stringify(r.choices[0].message.content))
} catch (e) { showErr('ERR 0', e) }

console.log('\n=== Test A: chat_template_kwargs top-level ===')
try {
  const r = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL,
    messages: [{ role: 'user', content: 'Reply JSON only: {"n": 42}' }],
    max_tokens: 200,
    chat_template_kwargs: { enable_thinking: false },
  })
  const m = r.choices[0].message
  console.log('content:', JSON.stringify(m.content))
  console.log('reasoning_content:', (m.reasoning_content || '').slice(0, 50))
  console.log('tokens:', r.usage.completion_tokens)
} catch (e) { showErr('ERR A', e) }

console.log('\n=== Test B: extra_body with chat_template_kwargs ===')
try {
  const r = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL,
    messages: [{ role: 'user', content: 'Reply JSON only: {"n": 42}' }],
    max_tokens: 200,
    extra_body: { chat_template_kwargs: { enable_thinking: false } },
  })
  const m = r.choices[0].message
  console.log('content:', JSON.stringify(m.content))
  console.log('reasoning_content:', (m.reasoning_content || '').slice(0, 50))
  console.log('tokens:', r.usage.completion_tokens)
} catch (e) { showErr('ERR B', e) }
