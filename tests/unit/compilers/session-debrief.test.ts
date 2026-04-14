import { describe, it, expect, vi, beforeEach } from 'vitest'
import { compileSessionDebrief } from '../../../src/compilers/session-debrief.js'
import { buildDebriefPrompt } from '../../../src/compilers/prompt-builder.js'
import { buildIndexContent } from '../../../src/compilers/index-updater.js'
import { ensureEnvLoaded } from '../../../src/compilers/llm-client.js'
import type { ConversationParsed, GitDiffParsed, ConceptPage, CompileOptions } from '../../../src/core/schema.js'

// Trigger dotenv load ONCE so the module-level `_envLoaded` guard flips.
// Without this, test's delete process.env[...] is neutralized by
// ensureEnvLoaded() reloading from .env on first getLLMClient() call.
ensureEnvLoaded()

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const mockConversation: ConversationParsed = {
  sessionId: 'session-typical',
  transcriptPath: '/tmp/test.jsonl',
  startTime: '2026-04-08T14:00:00.000Z',
  endTime: '2026-04-08T14:02:00.000Z',
  durationMinutes: 2,
  messageCount: 12,
  userMessages: [
    { index: 0, text: 'I need to refactor the auth middleware to use dependency injection', type: 'instruction', timestamp: '2026-04-08T14:00:00.000Z' },
    { index: 3, text: 'What is the difference between dependency injection and service locator pattern?', type: 'question', timestamp: '2026-04-08T14:01:00.000Z' },
    { index: 5, text: 'Run the tests to verify the changes', type: 'instruction', timestamp: '2026-04-08T14:02:00.000Z' },
  ],
  aiCodeBlocks: [
    {
      index: 1,
      language: 'typescript',
      code: 'export function createAuthMiddleware(tokenValidator: TokenValidator) { ... }',
      filePath: '/project/src/middleware/auth.ts',
      context: 'Refactored to use dependency injection',
    },
  ],
  toolCalls: [
    { index: 1, toolName: 'Read', input: { file_path: '/project/src/middleware/auth.ts' }, timestamp: '2026-04-08T14:00:10.000Z' },
    { index: 2, toolName: 'Write', input: { file_path: '/project/src/middleware/auth.ts', content: 'export function createAuthMiddleware...' }, timestamp: '2026-04-08T14:00:20.000Z' },
    { index: 4, toolName: 'Bash', input: { command: 'npm test -- --testPathPattern=auth' }, timestamp: '2026-04-08T14:02:05.000Z' },
  ],
  confusionSignals: [
    {
      index: 3,
      text: 'What is the difference between dependency injection and service locator pattern?',
      type: 'explicit-question',
      concept: 'dependency injection',
    },
    {
      index: 4,
      text: 'Great question! The key difference is about control and visibility...',
      type: 'long-explanation-needed',
      concept: 'dependency injection',
    },
  ],
  filesModified: ['/project/src/middleware/auth.ts'],
  commandsRun: ['npm test -- --testPathPattern=auth'],
}

const mockGitDiff: GitDiffParsed = {
  commitHash: 'abc123',
  commitMessage: 'refactor: use dependency injection in auth middleware',
  files: [
    {
      path: 'src/middleware/auth.ts',
      status: 'modified',
      additions: 12,
      deletions: 5,
      hunks: [],
    },
  ],
  stats: {
    totalFiles: 1,
    totalAdditions: 12,
    totalDeletions: 5,
    newFiles: [],
    significantChanges: [],
  },
}

const mockConcepts: ConceptPage[] = [
  {
    slug: 'dependency-injection',
    name: 'Dependency Injection',
    filePath: '/kb/concepts/dependency-injection.md',
    content: '',
    metadata: {
      name: 'Dependency Injection',
      slug: 'dependency-injection',
      firstSeen: '2026-04-01T00:00:00.000Z',
      lastUpdated: '2026-04-01T00:00:00.000Z',
      sessionCount: 1,
      relatedConcepts: [],
      relatedFiles: [],
      status: 'auto-generated',
    },
  },
]

const mockOptions: CompileOptions = {
  projectRoot: '/project',
  knowledgeBasePath: '/project/.knowledge',
  transcriptPath: '/tmp/test.jsonl',
  sessionId: 'session-typical',
  config: {
    knowledgeBasePath: '.knowledge',
    autoCompile: true,
    autoCompileMinMessages: 5,
    maxConceptsPerSession: 5,
    staleKnowledgeDays: 30,
    language: 'en' as const,
    version: '1',
  },
}

// ─── compileSessionDebrief ────────────────────────────────────────────────────

describe('compileSessionDebrief', () => {
  beforeEach(() => {
    // Ensure no API key so tests use deterministic path
    delete process.env['ANTHROPIC_API_KEY']
    delete process.env['OPENAI_API_KEY']
  })

  it('produces a SessionDebrief with correct metadata', async () => {
    const result = await compileSessionDebrief({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingConcepts: mockConcepts,
      options: mockOptions,
    })

    expect(result.debrief.metadata.sessionId).toBe('session-typical')
    expect(result.debrief.metadata.durationMinutes).toBe(2)
    expect(result.debrief.metadata.filesChanged).toBe(1)
    expect(result.debrief.metadata.status).toBe('auto-generated')
    expect(result.debrief.metadata.linesAdded).toBe(12)
    expect(result.debrief.metadata.linesRemoved).toBe(5)
  })

  it('places the session file in the sessions/ subdirectory', async () => {
    const result = await compileSessionDebrief({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingConcepts: mockConcepts,
      options: mockOptions,
    })

    expect(result.debrief.filePath).toContain('sessions/')
    expect(result.debrief.filePath.endsWith('.md')).toBe(true)
  })

  it('includes frontmatter with session metadata', async () => {
    const result = await compileSessionDebrief({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingConcepts: mockConcepts,
      options: mockOptions,
    })

    expect(result.debrief.content).toContain('session_id:')
    expect(result.debrief.content).toContain('duration_minutes:')
    expect(result.debrief.content).toContain('status: auto-generated')
  })

  it('includes all required sections in content', async () => {
    const result = await compileSessionDebrief({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingConcepts: mockConcepts,
      options: mockOptions,
    })

    expect(result.debrief.content).toContain('## Summary')
    expect(result.debrief.content).toContain('## Decisions Made')
    expect(result.debrief.content).toContain('## Patterns Applied')
    expect(result.debrief.content).toContain('## Trade-offs Accepted')
    expect(result.debrief.content).toContain('## Unknowns & Learning Gaps')
    expect(result.debrief.content).toContain('## Auto-extracted Explanations')
    expect(result.debrief.content).toContain('## Delegation Summary')
  })

  it('includes summary mentioning session facts', async () => {
    const result = await compileSessionDebrief({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingConcepts: mockConcepts,
      options: mockOptions,
    })

    // Deterministic mode: summary should mention files or messages
    expect(result.debrief.content).toMatch(/## Summary\n[\s\S]*?session|file|messages/i)
  })

  it('includes unknowns from confusion signals', async () => {
    const result = await compileSessionDebrief({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingConcepts: mockConcepts,
      options: mockOptions,
    })

    expect(result.debrief.content).toContain('## Unknowns & Learning Gaps')
    // The question about DI should appear as an unknown
    expect(result.debrief.content).toContain('dependency injection')
  })

  it('includes delegation table with modified files', async () => {
    const result = await compileSessionDebrief({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingConcepts: mockConcepts,
      options: mockOptions,
    })

    expect(result.debrief.content).toContain('## Delegation Summary')
    expect(result.debrief.content).toContain('auth.ts')
  })

  it('handles empty conversation gracefully', async () => {
    const emptyConv: ConversationParsed = {
      ...mockConversation,
      messageCount: 0,
      userMessages: [],
      toolCalls: [],
      filesModified: [],
      commandsRun: [],
      confusionSignals: [],
      aiCodeBlocks: [],
    }

    const result = await compileSessionDebrief({
      conversation: emptyConv,
      gitDiff: { files: [], stats: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0, newFiles: [], significantChanges: [] } },
      existingConcepts: [],
      options: mockOptions,
    })

    expect(result.debrief.content).toContain('## Summary')
    expect(result.debrief.content).toContain('## Delegation Summary')
  })
})

// ─── buildDebriefPrompt ───────────────────────────────────────────────────────

describe('buildDebriefPrompt', () => {
  it('includes session metadata in prompt', () => {
    const prompt = buildDebriefPrompt({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingConcepts: mockConcepts,
      projectName: 'test-project',
      sessionId: 'session-typical',
    })

    expect(prompt).toContain('test-project')
    expect(prompt).toContain('session-typical')
    expect(prompt).toContain('12')  // message count
  })

  it('includes user messages in prompt', () => {
    const prompt = buildDebriefPrompt({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingConcepts: mockConcepts,
      projectName: 'test-project',
      sessionId: 'session-typical',
    })

    expect(prompt).toContain('refactor the auth middleware')
    expect(prompt).toContain('difference between dependency injection')
  })

  it('includes existing concepts for cross-reference', () => {
    const prompt = buildDebriefPrompt({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingConcepts: mockConcepts,
      projectName: 'test-project',
      sessionId: 'session-typical',
    })

    expect(prompt).toContain('dependency-injection')
    expect(prompt).toContain('Dependency Injection')
  })

  it('includes confusion signals in prompt', () => {
    const prompt = buildDebriefPrompt({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingConcepts: mockConcepts,
      projectName: 'test-project',
      sessionId: 'session-typical',
    })

    expect(prompt).toContain('explicit-question')
    expect(prompt).toContain('long-explanation-needed')
  })

  it('includes git diff summary', () => {
    const prompt = buildDebriefPrompt({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingConcepts: mockConcepts,
      projectName: 'test-project',
      sessionId: 'session-typical',
    })

    expect(prompt).toContain('dependency injection in auth middleware')
    expect(prompt).toContain('auth.ts')
  })

  it('requests JSON output format', () => {
    const prompt = buildDebriefPrompt({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingConcepts: mockConcepts,
      projectName: 'test-project',
      sessionId: 'session-typical',
    })

    expect(prompt).toContain('"summary"')
    expect(prompt).toContain('"decisions"')
    expect(prompt).toContain('"unknowns"')
    expect(prompt).toContain('"autoExtracted"')
  })
})

// ─── buildIndexContent ────────────────────────────────────────────────────────

describe('buildIndexContent', () => {
  const mockSession: import('../../../src/core/schema.js').SessionDebrief = {
    filePath: '/kb/sessions/2026-04-08-14.md',
    content: '',
    metadata: {
      sessionId: '2026-04-08-14',
      date: '2026-04-08',
      durationMinutes: 2,
      filesChanged: 1,
      concepts: ['dependency-injection'],
      status: 'auto-generated',
    },
  }

  it('generates index with project name header', () => {
    const content = buildIndexContent({
      projectName: 'my-app',
      concepts: mockConcepts,
      recentSessions: [mockSession],
      gaps: [],
      staleDays: 30,
    })

    expect(content).toContain('# Knowledge Index — my-app')
  })

  it('includes active concepts section', () => {
    const content = buildIndexContent({
      projectName: 'my-app',
      concepts: mockConcepts,
      recentSessions: [],
      gaps: [],
      staleDays: 30,
    })

    expect(content).toContain('## Active Concepts')
    expect(content).toContain('dependency-injection')
    expect(content).toContain('Dependency Injection')
  })

  it('includes recent sessions section', () => {
    const content = buildIndexContent({
      projectName: 'my-app',
      concepts: [],
      recentSessions: [mockSession],
      gaps: [],
      staleDays: 30,
    })

    expect(content).toContain('## Recent Sessions')
    expect(content).toContain('2026-04-08-14')
  })

  it('includes quick stats', () => {
    const content = buildIndexContent({
      projectName: 'my-app',
      concepts: mockConcepts,
      recentSessions: [mockSession],
      gaps: [],
      staleDays: 30,
    })

    expect(content).toContain('## Quick Stats')
    expect(content).toContain('Total concepts: 1')
    expect(content).toContain('Total sessions: 1')
  })

  it('handles empty knowledge base', () => {
    const content = buildIndexContent({
      projectName: 'my-app',
      concepts: [],
      recentSessions: [],
      gaps: [],
      staleDays: 30,
    })

    expect(content).toContain('# Knowledge Index — my-app')
    expect(content).toContain('Total concepts: 0')
  })

  it('separates stale concepts from active ones', () => {
    const staleConcept: ConceptPage = {
      ...mockConcepts[0]!,
      slug: 'old-pattern',
      name: 'Old Pattern',
      metadata: {
        ...mockConcepts[0]!.metadata,
        slug: 'old-pattern',
        name: 'Old Pattern',
        lastUpdated: '2025-01-01T00:00:00.000Z',  // Definitely stale
      },
    }

    const content = buildIndexContent({
      projectName: 'my-app',
      concepts: [mockConcepts[0]!, staleConcept],
      recentSessions: [],
      gaps: [],
      staleDays: 30,
    })

    expect(content).toContain('## Stale Concepts')
    expect(content).toContain('Old Pattern')
  })
})
