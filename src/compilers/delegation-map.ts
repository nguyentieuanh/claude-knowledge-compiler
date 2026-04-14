import { toRelativePath, isInsideProject } from '../utils/path.js'
import type {
  ConversationParsed,
  GitDiffParsed,
  DelegationMap,
  DelegationEntry,
  DelegationState,
  DelegationBufferEntry,
  CompileOptions,
} from '../core/schema.js'
import { nowISO, isoToDate } from '../utils/date.js'

// ─── Delegation Map Compiler (Step 5) ────────────────────────────────────────
// Determines which files are AI-generated vs human-written vs mixed.
// The delegation map is the "ownership ledger" of the codebase.

export interface DelegationCompileInput {
  conversation: ConversationParsed
  gitDiff: GitDiffParsed
  existingMap: DelegationMap | null
  delegationBuffer: DelegationBufferEntry[]  // From PostToolUse hook accumulation
  options: CompileOptions
  sessionId: string
  projectRoot: string
}

export interface DelegationCompileResult {
  map: DelegationMap
  newEntries: DelegationEntry[]
  updatedEntries: DelegationEntry[]
}

// ─── Main Compiler ────────────────────────────────────────────────────────────

export function compileDelegationMap(input: DelegationCompileInput): DelegationCompileResult {
  const { conversation, gitDiff, existingMap, delegationBuffer, sessionId, projectRoot } = input
  const now = nowISO()

  const existing = existingMap ?? emptyDelegationMap(now)
  const entryMap = new Map<string, DelegationEntry>(
    existing.entries.map(e => [e.filePath, e])
  )

  const newEntries: DelegationEntry[] = []
  const updatedEntries: DelegationEntry[] = []

  // Source 1: Write/Edit tool calls in conversation
  const aiWrittenFiles = getAIWrittenFiles(conversation, projectRoot)

  // Source 2: Delegation buffer (accumulated from PostToolUse hooks)
  // Relativize + filter out-of-project files (e.g. ~/.claude/memory files)
  const bufferFiles = new Set(
    delegationBuffer
      .filter(b => isInsideProject(projectRoot, b.filePath))
      .map(b => toRelativePath(projectRoot, b.filePath))
  )

  // Source 3: Git diff — all modified files
  const gitModifiedFiles = gitDiff.files.map(f => f.path)

  // Build the set of all files to process
  const allFiles = new Set([
    ...aiWrittenFiles,
    ...bufferFiles,
    ...gitModifiedFiles,
    ...conversation.filesModified,
  ])

  for (const filePath of allFiles) {
    const wasAIWritten = aiWrittenFiles.has(filePath) || bufferFiles.has(filePath)
    const wasInGit = gitModifiedFiles.includes(filePath)
    const existing_entry = entryMap.get(filePath)

    const newState = determineState(wasAIWritten, existing_entry)

    const entry: DelegationEntry = {
      filePath,
      state: newState,
      confidence: calculateConfidence(wasAIWritten, existing_entry),
      lastModified: now,
      sessions: [...(existing_entry?.sessions ?? []), sessionId],
      notes: buildNotes(wasAIWritten, wasInGit),
    }

    if (existing_entry) {
      entryMap.set(filePath, entry)
      updatedEntries.push(entry)
    } else {
      entryMap.set(filePath, entry)
      newEntries.push(entry)
    }
  }

  // Compute summary stats
  const allEntries = [...entryMap.values()]
  const summary = computeSummary(allEntries)

  // Build trend entry (compare to previous)
  const prevTrend = existing.trend.at(-1)
  const newTrendEntry = {
    date: isoToDate(now),
    percentageAi: summary.percentageAi,
    percentageReviewed: Math.round(
      (allEntries.filter(e => e.state === 'ai-generated-human-reviewed').length / Math.max(allEntries.length, 1)) * 100
    ),
  }
  const trend = [...existing.trend, newTrendEntry].slice(-30)  // Keep 30 data points

  return {
    map: {
      lastUpdated: now,
      summary,
      entries: allEntries,
      trend,
    },
    newEntries,
    updatedEntries,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAIWrittenFiles(conversation: ConversationParsed, projectRoot: string): Set<string> {
  const aiFiles = new Set<string>()
  for (const tc of conversation.toolCalls) {
    if (tc.toolName === 'Write' || tc.toolName === 'Edit') {
      const rawFp = String(tc.input['file_path'] ?? tc.input['path'] ?? '')
      if (!rawFp) continue
      // Skip files outside project root (e.g. ~/.claude memory files)
      if (!isInsideProject(projectRoot, rawFp)) continue
      const fp = toRelativePath(projectRoot, rawFp)
      if (fp) aiFiles.add(fp)
    }
  }
  return aiFiles
}

function determineState(
  wasAIWritten: boolean,
  existing: DelegationEntry | undefined,
): DelegationState {
  if (!existing) {
    return wasAIWritten ? 'ai-generated' : 'human-written'
  }

  // Transition logic based on previous state
  switch (existing.state) {
    case 'ai-generated':
      // If AI wrote it again → still ai-generated
      // If only in git (human modified) → ai-generated-human-modified
      return wasAIWritten ? 'ai-generated' : 'ai-generated-human-modified'

    case 'ai-generated-human-modified':
      // Once human-modified, stays that way unless AI writes again
      return wasAIWritten ? 'ai-generated' : 'ai-generated-human-modified'

    case 'ai-generated-human-reviewed':
      return wasAIWritten ? 'ai-generated' : 'ai-generated-human-reviewed'

    case 'human-written':
      return wasAIWritten ? 'ai-generated-human-modified' : 'human-written'

    case 'unknown':
      return wasAIWritten ? 'ai-generated' : 'unknown'
  }
}

function calculateConfidence(
  wasAIWritten: boolean,
  existing: DelegationEntry | undefined,
): number {
  if (!existing) return wasAIWritten ? 0.9 : 0.6
  // Confidence increases with more sessions confirming the state
  return Math.min(0.95, existing.confidence + 0.05)
}

function buildNotes(wasAIWritten: boolean, wasInGit: boolean): string {
  const parts: string[] = []
  if (wasAIWritten) parts.push('AI wrote via tool call')
  if (wasInGit) parts.push('in git diff')
  return parts.join(', ') || ''
}

function computeSummary(entries: DelegationEntry[]) {
  const total = entries.length
  const aiGenerated = entries.filter(e => e.state === 'ai-generated').length
  const aiModified = entries.filter(e =>
    e.state === 'ai-generated-human-modified' || e.state === 'ai-generated-human-reviewed'
  ).length
  const humanWritten = entries.filter(e => e.state === 'human-written').length
  const unreviewed = entries.filter(e => e.state === 'ai-generated').length

  return {
    totalFiles: total,
    aiGenerated,
    aiModified,
    humanWritten,
    unreviewed,
    percentageAi: total === 0 ? 0 : Math.round(((aiGenerated + aiModified) / total) * 100),
  }
}

function emptyDelegationMap(now: string): DelegationMap {
  return {
    lastUpdated: now,
    summary: {
      totalFiles: 0,
      aiGenerated: 0,
      aiModified: 0,
      humanWritten: 0,
      unreviewed: 0,
      percentageAi: 0,
    },
    entries: [],
    trend: [],
  }
}
