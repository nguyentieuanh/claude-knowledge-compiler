/**
 * DKC Core Type Definitions
 * All TypeScript interfaces for the Developer Knowledge Compiler.
 * This is the single source of truth for all data structures.
 */

// ─── Config ──────────────────────────────────────────────────────────────────

export type DKCLanguage = 'en' | 'vi'

export interface DKCConfig {
  knowledgeBasePath: string      // Default: ".knowledge"
  autoCompile: boolean           // Default: true
  autoCompileMinMessages: number // Default: 5
  maxConceptsPerSession: number  // Default: 5
  staleKnowledgeDays: number     // Default: 30
  language: DKCLanguage          // Default: "en"
  version: string
}

// ─── Knowledge Base ───────────────────────────────────────────────────────────

export interface KnowledgeBaseStats {
  sessionCount: number
  conceptCount: number
  gapCount: number
  lastCompiled: string | null    // ISO date
  delegationSummary: DelegationSummary
}

// ─── Session Debrief ─────────────────────────────────────────────────────────

export interface SessionDebriefMetadata {
  sessionId: string
  date: string                   // ISO date
  durationMinutes: number
  filesChanged: number
  concepts: string[]             // Concept slugs referenced
  costUsd?: number
  linesAdded?: number
  linesRemoved?: number
  status: 'auto-generated' | 'human-reviewed'
}

export interface SessionDebrief {
  filePath: string               // sessions/YYYY-MM-DD-HH.md
  content: string                // Generated markdown
  metadata: SessionDebriefMetadata
}

// ─── Concept Page ─────────────────────────────────────────────────────────────

export interface ConceptPageMetadata {
  name: string
  slug: string
  firstSeen: string              // ISO date
  lastUpdated: string            // ISO date
  sessionCount: number
  relatedConcepts: string[]      // Slugs
  relatedFiles: string[]
  status: 'auto-generated' | 'human-reviewed'
}

export interface ConceptPage {
  slug: string
  name: string
  filePath: string               // concepts/<slug>.md
  content: string                // Full markdown
  metadata: ConceptPageMetadata
}

// ─── Delegation Map ───────────────────────────────────────────────────────────

export type DelegationState =
  | 'ai-generated'
  | 'ai-generated-human-modified'
  | 'ai-generated-human-reviewed'
  | 'human-written'
  | 'unknown'

export interface DelegationEntry {
  filePath: string
  state: DelegationState
  confidence: number             // 0-1
  lastModified: string           // ISO date
  sessions: string[]             // Session IDs that touched this file
  notes: string
}

export interface DelegationSummary {
  totalFiles: number
  aiGenerated: number
  aiModified: number
  humanWritten: number
  unreviewed: number
  percentageAi: number
}

export interface DelegationMap {
  lastUpdated: string
  summary: DelegationSummary
  entries: DelegationEntry[]
  trend: Array<{
    date: string
    percentageAi: number
    percentageReviewed: number
  }>
}

// ─── Gaps ─────────────────────────────────────────────────────────────────────

export type GapType =
  | 'unreviewed-code'
  | 'untouched-ai-code'
  | 'concept-no-page'
  | 'orphan-concept'
  | 'repeated-pattern'
  | 'persistent-unknown'
  | 'stale-knowledge'
  | 'missing-cross-reference'

export type GapSeverity = 'high' | 'medium' | 'low'

export interface Gap {
  id: string
  type: GapType
  severity: GapSeverity
  title: string
  description: string
  suggestedAction: string        // P3: Actionable
  relatedFiles?: string[]
  relatedConcepts?: string[]
  detectedAt: string             // ISO date
}

// ─── Conversation (Collector output) ─────────────────────────────────────────

export interface UserMessageParsed {
  index: number
  text: string
  type: 'question' | 'instruction' | 'clarification' | 'approval'
  origin: string | undefined     // undefined = human-typed
  timestamp: string
}

export interface AICodeBlock {
  index: number
  language: string
  code: string
  filePath?: string              // From Write/Edit tool input
  context: string                // Surrounding explanation
}

export interface ToolCallParsed {
  index: number
  toolName: string
  input: Record<string, unknown>
  result?: string
  timestamp: string
}

export interface ConfusionSignal {
  index: number
  text: string
  type: 'explicit-question' | 'repeated-question' | 'misunderstanding' | 'long-explanation-needed'
  concept?: string
}

export interface ConversationParsed {
  sessionId: string
  transcriptPath: string
  startTime: string
  endTime: string
  durationMinutes: number
  messageCount: number
  userMessages: UserMessageParsed[]
  aiCodeBlocks: AICodeBlock[]
  toolCalls: ToolCallParsed[]
  confusionSignals: ConfusionSignal[]
  filesModified: string[]
  commandsRun: string[]
}

// ─── Git Diff (Collector output) ─────────────────────────────────────────────

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  content: string
}

export interface FileDiff {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  oldPath?: string
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

export interface GitDiffParsed {
  commitHash?: string
  commitMessage?: string
  author?: string
  timestamp?: string
  files: FileDiff[]
  stats: {
    totalFiles: number
    totalAdditions: number
    totalDeletions: number
    newFiles: string[]
    significantChanges: string[]  // Files with >50 lines changed
  }
}

// ─── Hook I/O (Plugin integration) ───────────────────────────────────────────

export interface HookBaseInput {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
}

export interface PostToolUseInput extends HookBaseInput {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_response: unknown
  tool_use_id: string
}

export interface HookSyncOutput {
  continue?: boolean
  suppressOutput?: boolean
  hookSpecificOutput?: {
    hookEventName: string
    additionalContext?: string
    [key: string]: unknown
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export interface InitOptions {
  projectRoot: string
  gitHook?: boolean
  gitignore?: boolean
  skipClaudeMd?: boolean
  knowledgeBasePath?: string
  language?: DKCLanguage
}

export interface InitResult {
  created: string[]
  modified: string[]
  skipped: string[]
  warnings: string[]
}

// ─── Compile Pipeline ─────────────────────────────────────────────────────────

export interface CompileOptions {
  projectRoot: string
  knowledgeBasePath: string
  transcriptPath: string
  sessionId: string
  config: DKCConfig
}

export interface CompileResult {
  sessionDebrief: SessionDebrief
  conceptsCreated: ConceptPage[]
  conceptsUpdated: ConceptPage[]
  delegationMap: DelegationMap
  logEntry: string
}

// ─── Pending Compile State (stored in CLAUDE_PLUGIN_DATA) ────────────────────

export interface PendingCompileData {
  sessionId: string
  transcriptPath: string
  projectRoot: string
  knowledgeBasePath: string
  delegationBuffer: DelegationBufferEntry[]
  collectedAt: string            // ISO date
  messageCount: number
}

export interface DelegationBufferEntry {
  toolName: string
  filePath: string
  timestamp: string
  sessionId: string
}
