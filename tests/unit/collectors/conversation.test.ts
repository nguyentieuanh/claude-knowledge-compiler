import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectConversation } from '../../../src/collectors/conversation.js'

const FIXTURES = join(fileURLToPath(import.meta.url), '../../../../tests/fixtures/conversations')

describe('collectConversation', () => {
  it('parses minimal transcript correctly', async () => {
    const result = await collectConversation({
      transcriptPath: join(FIXTURES, 'minimal.jsonl'),
      sessionId: 'session-abc',
    })

    expect(result.sessionId).toBe('session-abc')
    expect(result.messageCount).toBe(2)
    expect(result.userMessages).toHaveLength(1)
    expect(result.userMessages[0]?.type).toBe('question')
    expect(result.userMessages[0]?.text).toContain('dependency injection')
    expect(result.userMessages[0]?.origin).toBeUndefined() // human-typed
  })

  it('returns empty conversation for empty file', async () => {
    const result = await collectConversation({
      transcriptPath: join(FIXTURES, 'empty.jsonl'),
      sessionId: 'session-empty',
    })

    expect(result.messageCount).toBe(0)
    expect(result.userMessages).toHaveLength(0)
    expect(result.toolCalls).toHaveLength(0)
    expect(result.filesModified).toHaveLength(0)
  })

  it('returns empty conversation for nonexistent file', async () => {
    const result = await collectConversation({
      transcriptPath: '/nonexistent/path.jsonl',
      sessionId: 'session-none',
    })

    expect(result.messageCount).toBe(0)
    expect(result.userMessages).toHaveLength(0)
  })

  it('skips corrupted lines without crashing', async () => {
    const result = await collectConversation({
      transcriptPath: join(FIXTURES, 'corrupted.jsonl'),
      sessionId: 'session-corrupt',
    })

    // Should have parsed the 2 valid lines, skipped the corrupted one
    expect(result.messageCount).toBeGreaterThan(0)
    expect(result.userMessages[0]?.text).toContain('First valid message')
  })

  it('parses typical session with tools and code', async () => {
    const result = await collectConversation({
      transcriptPath: join(FIXTURES, 'typical.jsonl'),
      sessionId: 'session-typical',
      projectRoot: '/project',
    })

    // User messages (human-typed only)
    expect(result.userMessages.length).toBeGreaterThanOrEqual(3)
    expect(result.userMessages[0]?.text).toContain('dependency injection')

    // Tool calls
    expect(result.toolCalls.length).toBeGreaterThan(0)
    const writeCall = result.toolCalls.find(t => t.toolName === 'Write')
    expect(writeCall).toBeDefined()
    expect(writeCall?.input['file_path']).toContain('auth.ts')

    // Files modified — relative paths when projectRoot is provided
    expect(result.filesModified).toContain('src/middleware/auth.ts')

    // Commands run
    expect(result.commandsRun.some(c => c.includes('npm test'))).toBe(true)

    // Duration calculated
    expect(result.durationMinutes).toBeGreaterThanOrEqual(0)
  })

  it('detects explicit questions as confusion signals', async () => {
    const result = await collectConversation({
      transcriptPath: join(FIXTURES, 'typical.jsonl'),
      sessionId: 'session-typical',
    })

    const questions = result.confusionSignals.filter(s => s.type === 'explicit-question')
    expect(questions.length).toBeGreaterThan(0)
    // "What is the difference between dependency injection..." → should be detected
    expect(questions.some(q => q.text.toLowerCase().includes('difference'))).toBe(true)
  })

  it('detects long explanations as confusion signals', async () => {
    const result = await collectConversation({
      transcriptPath: join(FIXTURES, 'typical.jsonl'),
      sessionId: 'session-typical',
    })

    // The DI vs service locator explanation is >300 words
    const longExplanations = result.confusionSignals.filter(s => s.type === 'long-explanation-needed')
    expect(longExplanations.length).toBeGreaterThan(0)
  })

  it('extracts AI code blocks from Write tool calls', async () => {
    const result = await collectConversation({
      transcriptPath: join(FIXTURES, 'typical.jsonl'),
      sessionId: 'session-typical',
    })

    const writeBlocks = result.aiCodeBlocks.filter(b => b.filePath?.includes('auth.ts'))
    expect(writeBlocks.length).toBeGreaterThan(0)
    expect(writeBlocks[0]?.language).toBe('typescript')
    expect(writeBlocks[0]?.code).toContain('createAuthMiddleware')
  })

  it('classifies question messages correctly', async () => {
    const result = await collectConversation({
      transcriptPath: join(FIXTURES, 'typical.jsonl'),
      sessionId: 'session-typical',
    })

    const questionMsg = result.userMessages.find(m => m.text.includes('What is the difference'))
    expect(questionMsg?.type).toBe('question')

    const instructionMsg = result.userMessages.find(m => m.text.includes('refactor'))
    expect(instructionMsg?.type).toBe('instruction')
  })
})
