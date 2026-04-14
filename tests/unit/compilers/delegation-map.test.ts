import { describe, it, expect } from 'vitest'
import { compileDelegationMap } from '../../../src/compilers/delegation-map.js'
import type { ConversationParsed, GitDiffParsed, DelegationMap, CompileOptions } from '../../../src/core/schema.js'

const mockOptions: CompileOptions = {
  projectRoot: '/project',
  knowledgeBasePath: '/project/.knowledge',
  transcriptPath: '/tmp/test.jsonl',
  sessionId: '2026-04-08-14',
  config: {
    knowledgeBasePath: '.knowledge',
    autoCompile: true,
    autoCompileMinMessages: 5,
    maxConceptsPerSession: 5,
    staleKnowledgeDays: 30,
    version: '1',
  },
}

const mockConversation: ConversationParsed = {
  sessionId: '2026-04-08-14',
  transcriptPath: '/tmp/test.jsonl',
  startTime: '2026-04-08T14:00:00.000Z',
  endTime: '2026-04-08T14:02:00.000Z',
  durationMinutes: 2,
  messageCount: 12,
  userMessages: [],
  aiCodeBlocks: [],
  toolCalls: [
    { index: 1, toolName: 'Write', input: { file_path: '/project/src/middleware/auth.ts' }, timestamp: '' },
    { index: 2, toolName: 'Edit', input: { file_path: '/project/src/services/token.ts' }, timestamp: '' },
  ],
  confusionSignals: [],
  filesModified: ['/project/src/middleware/auth.ts', '/project/src/services/token.ts'],
  commandsRun: [],
}

const mockGitDiff: GitDiffParsed = {
  files: [
    { path: 'src/middleware/auth.ts', status: 'modified', additions: 12, deletions: 5, hunks: [] },
    { path: 'src/config/index.ts', status: 'modified', additions: 3, deletions: 1, hunks: [] },
  ],
  stats: { totalFiles: 2, totalAdditions: 15, totalDeletions: 6, newFiles: [], significantChanges: [] },
}

describe('compileDelegationMap', () => {
  it('marks AI-written files as ai-generated', () => {
    const result = compileDelegationMap({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingMap: null,
      delegationBuffer: [],
      options: mockOptions,
      sessionId: '2026-04-08-14',
      projectRoot: '/project',
    })

    const authEntry = result.map.entries.find(e => e.filePath.includes('auth.ts'))
    expect(authEntry).toBeDefined()
    expect(authEntry?.state).toBe('ai-generated')
  })

  it('marks git-only files as human-written when no AI tool calls', () => {
    const convNoWrite: ConversationParsed = {
      ...mockConversation,
      toolCalls: [],
      filesModified: [],
    }

    const result = compileDelegationMap({
      conversation: convNoWrite,
      gitDiff: mockGitDiff,
      existingMap: null,
      delegationBuffer: [],
      options: mockOptions,
      sessionId: '2026-04-08-14',
      projectRoot: '/project',
    })

    const configEntry = result.map.entries.find(e => e.filePath.includes('config'))
    if (configEntry) {
      expect(configEntry.state).toBe('human-written')
    }
  })

  it('transitions ai-generated to ai-generated-human-modified on human edit', () => {
    const existingMap: DelegationMap = {
      lastUpdated: '2026-04-01T00:00:00.000Z',
      summary: { totalFiles: 1, aiGenerated: 1, aiModified: 0, humanWritten: 0, unreviewed: 1, percentageAi: 100 },
      entries: [
        {
          filePath: '/project/src/middleware/auth.ts',
          state: 'ai-generated',
          confidence: 0.9,
          lastModified: '2026-04-01T00:00:00.000Z',
          sessions: ['2026-04-01-10'],
          notes: 'AI wrote via tool call',
        },
      ],
      trend: [],
    }

    // New session: human edits the file (no Write/Edit tool call, just in git diff)
    const humanEditConv: ConversationParsed = {
      ...mockConversation,
      toolCalls: [],  // Human made changes, no AI tool calls
      filesModified: ['/project/src/middleware/auth.ts'],
    }

    const result = compileDelegationMap({
      conversation: humanEditConv,
      gitDiff: mockGitDiff,
      existingMap,
      delegationBuffer: [],
      options: mockOptions,
      sessionId: '2026-04-08-14',
      projectRoot: '/project',
    })

    const authEntry = result.map.entries.find(e => e.filePath.includes('auth.ts'))
    expect(authEntry?.state).toBe('ai-generated-human-modified')
  })

  it('computes summary stats correctly', () => {
    const result = compileDelegationMap({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingMap: null,
      delegationBuffer: [],
      options: mockOptions,
      sessionId: '2026-04-08-14',
      projectRoot: '/project',
    })

    expect(result.map.summary.totalFiles).toBeGreaterThan(0)
    expect(result.map.summary.aiGenerated).toBeGreaterThan(0)
    expect(result.map.summary.percentageAi).toBeGreaterThan(0)
    expect(result.map.summary.percentageAi).toBeLessThanOrEqual(100)
  })

  it('increments sessions array for updated entries', () => {
    const existingMap: DelegationMap = {
      lastUpdated: '2026-04-01T00:00:00.000Z',
      summary: { totalFiles: 1, aiGenerated: 1, aiModified: 0, humanWritten: 0, unreviewed: 1, percentageAi: 100 },
      entries: [
        {
          filePath: '/project/src/middleware/auth.ts',
          state: 'ai-generated',
          confidence: 0.9,
          lastModified: '2026-04-01T00:00:00.000Z',
          sessions: ['2026-04-01-10'],
          notes: '',
        },
      ],
      trend: [],
    }

    const result = compileDelegationMap({
      conversation: mockConversation,
      gitDiff: emptyGitDiff,
      existingMap,
      delegationBuffer: [],
      options: mockOptions,
      sessionId: '2026-04-08-14',
      projectRoot: '/project',
    })

    const authEntry = result.map.entries.find(e => e.filePath.includes('auth.ts'))
    expect(authEntry?.sessions).toContain('2026-04-01-10')
    expect(authEntry?.sessions).toContain('2026-04-08-14')
  })

  it('adds trend entry on each compile', () => {
    const result = compileDelegationMap({
      conversation: mockConversation,
      gitDiff: mockGitDiff,
      existingMap: null,
      delegationBuffer: [],
      options: mockOptions,
      sessionId: '2026-04-08-14',
      projectRoot: '/project',
    })

    expect(result.map.trend).toHaveLength(1)
    expect(result.map.trend[0]?.percentageAi).toBeGreaterThanOrEqual(0)
  })
})

const emptyGitDiff: GitDiffParsed = {
  files: [],
  stats: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0, newFiles: [], significantChanges: [] },
}
