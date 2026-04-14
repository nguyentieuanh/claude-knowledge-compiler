import { join } from 'node:path'
import { fillTemplate } from '../utils/markdown.js'
import { nowISO, dateToSessionId, isoToDate } from '../utils/date.js'
import { readTextFile, fileExists } from '../utils/fs.js'
import type {
  ConversationParsed,
  GitDiffParsed,
  SessionDebrief,
  SessionDebriefMetadata,
  ConceptPage,
  CompileOptions,
  DKCLanguage,
} from '../core/schema.js'

// ─── Language strings for deterministic fallback ──────────────────────────────

const L = {
  en: {
    noDecisions: '_No significant decisions recorded._',
    noPatterns: '_No patterns identified._',
    noTradeoffs: '_No trade-offs recorded._',
    noUnknowns: '_No learning gaps identified._',
    noAutoExtracted: '_None._',
    fileWritten: 'File written during session',
    autoExtractComment: '<!-- Populated when Claude explanation > 300 words about a concept -->',
  },
  vi: {
    noDecisions: '_Không có quyết định đáng kể nào được ghi nhận._',
    noPatterns: '_Không xác định được pattern nào._',
    noTradeoffs: '_Không có trade-off nào được ghi nhận._',
    noUnknowns: '_Không phát hiện gap kiến thức nào._',
    noAutoExtracted: '_Không có._',
    fileWritten: 'File được viết trong session',
    autoExtractComment: '<!-- Tự động điền khi Claude giải thích >300 từ về một khái niệm -->',
  },
} as const
import { buildDebriefPrompt } from './prompt-builder.js'
import type { DebriefLLMResponse } from './prompt-builder.js'
import { getLLMClient } from './llm-client.js'

// ─── Main Compiler ────────────────────────────────────────────────────────────

export interface DebriefCompileInput {
  conversation: ConversationParsed
  gitDiff: GitDiffParsed
  existingConcepts: ConceptPage[]
  options: CompileOptions
  projectName?: string
}

export interface DebriefCompileResult {
  debrief: SessionDebrief
  bugsAndLessons: Array<{ concept: string; bug: string; fix: string; lesson: string }>
}

export async function compileSessionDebrief(input: DebriefCompileInput): Promise<DebriefCompileResult> {
  const { conversation, gitDiff, existingConcepts, options } = input
  const projectName = input.projectName ?? options.projectRoot.split('/').at(-1) ?? 'project'
  const sessionId = conversation.sessionId || dateToSessionId(new Date(conversation.startTime))
  const language: DKCLanguage = options.config.language ?? 'en'

  // Try LLM compilation first; fall back to deterministic if no API key
  const llm = getLLMClient()
  let response: DebriefLLMResponse

  if (llm) {
    response = await compileLLM({ conversation, gitDiff, existingConcepts, options, projectName, sessionId, llm, language })
  } else {
    response = compileDeterministic({ conversation, gitDiff, existingConcepts, sessionId })
  }

  const content = renderDebriefMarkdown(response, conversation, gitDiff, sessionId, options, language)
  const filePath = join(options.knowledgeBasePath, 'sessions', `${sessionId}.md`)

  const metadata: SessionDebriefMetadata = {
    sessionId,
    date: isoToDate(conversation.startTime),
    durationMinutes: conversation.durationMinutes,
    filesChanged: conversation.filesModified.length,
    concepts: response.conceptsMentioned,
    status: 'auto-generated',
    ...(gitDiff.stats.totalAdditions > 0 && { linesAdded: gitDiff.stats.totalAdditions }),
    ...(gitDiff.stats.totalDeletions > 0 && { linesRemoved: gitDiff.stats.totalDeletions }),
  }

  return {
    debrief: { filePath, content, metadata },
    bugsAndLessons: response.bugsAndLessons ?? [],
  }
}

// ─── LLM Compilation ─────────────────────────────────────────────────────────

async function compileLLM(params: {
  conversation: ConversationParsed
  gitDiff: GitDiffParsed
  existingConcepts: ConceptPage[]
  options: CompileOptions
  projectName: string
  sessionId: string
  llm: import('./llm-client.js').LLMClient
  language: DKCLanguage
}): Promise<DebriefLLMResponse> {
  const { conversation, gitDiff, existingConcepts, projectName, sessionId, llm, language } = params

  const prompt = buildDebriefPrompt({
    conversation,
    gitDiff,
    existingConcepts,
    projectName,
    sessionId,
    language,
  })

  try {
    const { TOKEN_BUDGETS } = await import('./llm-client.js')
    let text = await llm.complete(prompt, TOKEN_BUDGETS.sessionDebrief)
    // Strip markdown fences if LLM wraps response in ```json ... ```
    text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()
    // Try to extract JSON object if there's extra text around it
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      text = jsonMatch[0]
    }
    return parseDebriefJSON(text)
  } catch (err) {
    // Log the error for debugging, then fall back to deterministic
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[DKC] LLM debrief parse failed: ${msg}`)
    if (err instanceof SyntaxError) {
      console.error(`[DKC] Raw LLM response (first 500 chars): ...check debug logs`)
    }
    return compileDeterministic({ conversation, gitDiff, existingConcepts, sessionId })
  }
}

// ─── JSON Parsing with repair ────────────────────────────────────────────────

function parseDebriefJSON(text: string): DebriefLLMResponse {
  // First try direct parse
  try {
    const parsed = JSON.parse(text)
    // Ensure bugsAndLessons exists (backward compat)
    if (!parsed.bugsAndLessons) parsed.bugsAndLessons = []
    return parsed as DebriefLLMResponse
  } catch {
    // Try repairing common LLM JSON issues
  }

  let repaired = text
  // Remove trailing commas before } or ]
  repaired = repaired.replace(/,\s*([}\]])/g, '$1')
  // Fix unescaped newlines inside strings (replace literal newlines between quotes)
  repaired = repaired.replace(/(?<=:\s*"[^"]*)\n([^"]*")/g, '\\n$1')
  // Remove control characters
  repaired = repaired.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, '')

  try {
    const parsed = JSON.parse(repaired)
    if (!parsed.bugsAndLessons) parsed.bugsAndLessons = []
    return parsed as DebriefLLMResponse
  } catch {
    // Last resort: try to truncate at last valid closing brace
  }

  // Find the last } and try parsing from start to there
  const lastBrace = repaired.lastIndexOf('}')
  if (lastBrace > 0) {
    const truncated = repaired.slice(0, lastBrace + 1)
    try {
      const parsed = JSON.parse(truncated)
      if (!parsed.bugsAndLessons) parsed.bugsAndLessons = []
      return parsed as DebriefLLMResponse
    } catch {
      // give up
    }
  }

  throw new SyntaxError('Failed to parse LLM response as JSON after repair attempts')
}

// ─── Deterministic Fallback ───────────────────────────────────────────────────
// Used when ANTHROPIC_API_KEY is not set. Extracts structure from parsed data.

function compileDeterministic(params: {
  conversation: ConversationParsed
  gitDiff: GitDiffParsed
  existingConcepts: ConceptPage[]
  sessionId: string
}): DebriefLLMResponse {
  const { conversation, gitDiff, existingConcepts, sessionId } = params

  // Build summary from raw facts
  const fileCount = conversation.filesModified.length
  const toolCount = conversation.toolCalls.length
  const duration = conversation.durationMinutes

  // Group files by directory to give a meaningful summary
  const dirGroups = new Map<string, number>()
  for (const fp of conversation.filesModified) {
    const parts = fp.split('/')
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.'
    dirGroups.set(dir, (dirGroups.get(dir) ?? 0) + 1)
  }
  const topDirs = [...dirGroups.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([dir, count]) => `${dir}/ (${count})`)

  const summaryParts: string[] = []
  summaryParts.push(`Session lasted ${duration} minutes — ${conversation.messageCount} messages, ${toolCount} tool calls.`)
  if (fileCount > 0) {
    const dirSummary = topDirs.length > 0 ? ` Main areas: ${topDirs.join(', ')}.` : ''
    summaryParts.push(`Modified ${fileCount} file${fileCount > 1 ? 's' : ''}.${dirSummary}`)
  }

  // Extract decisions from user messages that contain decision keywords
  const decisionKeywords = /\b(decided|going with|chose|switch|changed to|instead of|rather than|better to|reason|because|tradeoff|fix|bug|error|issue)\b/i
  const decisionMessages = conversation.userMessages
    .filter(m => decisionKeywords.test(m.text) && m.text.length > 20)
    .slice(0, 3)
  if (decisionMessages.length > 0) {
    summaryParts.push(`Key decisions: ${decisionMessages.map(m => m.text.slice(0, 60)).join('; ')}.`)
  }

  // Extract unknowns from confusion signals
  const unknowns = conversation.confusionSignals
    .filter(s => s.type === 'explicit-question')
    .slice(0, 5)
    .map(s => {
      const relatedSlug = existingConcepts.find(c =>
        s.concept && (c.slug === s.concept || c.name.toLowerCase().includes(s.concept))
      )?.slug
      return {
        concept: s.concept ?? extractTopicFromQuestion(s.text),
        evidence: s.text.slice(0, 150),
        ...(relatedSlug !== undefined && { relatedSlug }),
      }
    })

  // Extract auto-explanations from long signals
  const autoExtracted = conversation.confusionSignals
    .filter(s => s.type === 'long-explanation-needed')
    .slice(0, 3)
    .map(s => ({
      concept: s.concept ?? 'explanation',
      messageIndex: s.index,
      condensed: `${s.text.slice(0, 300)}...`,
    }))

  // Find mentioned concepts by scanning user messages
  const mentionedSlugs = existingConcepts
    .filter(c => conversation.userMessages.some(m =>
      m.text.toLowerCase().includes(c.slug) ||
      m.text.toLowerCase().includes(c.name.toLowerCase())
    ))
    .slice(0, 5)
    .map(c => c.slug)

  // Extract patterns from filesModified (already relativized)
  const patterns = conversation.filesModified.slice(0, 3).map(file => ({
    name: inferPatternFromFile(file),
    file,
    context: 'File written during session',
  }))

  return {
    summary: summaryParts.join(' '),
    decisions: [],
    patterns,
    tradeoffs: [],
    unknowns,
    autoExtracted,
    bugsAndLessons: [],
    conceptsMentioned: mentionedSlugs,
  }
}

// ─── Markdown Renderer ────────────────────────────────────────────────────────

async function loadSessionTemplate(options: CompileOptions): Promise<string> {
  const templatePath = join(options.knowledgeBasePath, '..', 'src', 'templates', 'session.md.tpl')
  if (await fileExists(templatePath)) {
    return readTextFile(templatePath)
  }
  // Built-in template fallback
  return DEFAULT_SESSION_TEMPLATE
}

function renderDebriefMarkdown(
  response: DebriefLLMResponse,
  conversation: ConversationParsed,
  gitDiff: GitDiffParsed,
  sessionId: string,
  options: CompileOptions,
  language: DKCLanguage = 'en',
): string {
  const t = L[language]
  const date = isoToDate(conversation.startTime)
  const conceptsStr = response.conceptsMentioned.join(', ')

  const decisions = response.decisions.length > 0
    ? response.decisions.map(d =>
        `- **Decision:** ${d.what} | **Why:** ${d.why}${d.alternatives ? ` | **Alternatives:** ${d.alternatives}` : ''}`
      ).join('\n')
    : t.noDecisions

  const patterns = response.patterns.length > 0
    ? response.patterns.map(p => `- **${p.name}** — applied in \`${p.file}\`: ${p.context}`).join('\n')
    : t.noPatterns

  const tradeoffs = response.tradeoffs.length > 0
    ? response.tradeoffs.map(t => `- **Chose:** ${t.chose} **Over:** ${t.over} **Because:** ${t.because}`).join('\n')
    : (L[language]).noTradeoffs

  const unknowns = response.unknowns.length > 0
    ? response.unknowns.map(u =>
        `- **${u.concept}** — ${u.evidence}${u.relatedSlug ? `\n  -> Related concept: [[${u.relatedSlug}]]` : ''}`
      ).join('\n')
    : t.noUnknowns

  const autoExtracted = response.autoExtracted.length > 0
    ? response.autoExtracted.map(a =>
        `- **${a.concept}** (from message #${a.messageIndex}):\n  ${a.condensed}`
      ).join('\n')
    : t.noAutoExtracted

  const bugsAndLessons = (response.bugsAndLessons ?? []).length > 0
    ? response.bugsAndLessons.map(b =>
        `- **${b.concept}**: ${b.bug} → Fix: ${b.fix} → Lesson: ${b.lesson}`
      ).join('\n')
    : '_No bugs or lessons recorded._'

  // Delegation table — all files come from filesModified (already relativized)
  // Cap at 20 files to keep debrief readable
  const displayFiles = conversation.filesModified.slice(0, 20)
  const hiddenCount = conversation.filesModified.length - displayFiles.length
  const delegationTable = displayFiles.length > 0
    ? displayFiles.map(f => `| \`${f}\` | ai-generated | |`).join('\n')
      + (hiddenCount > 0 ? `\n| _(+${hiddenCount} more files)_ | ai-generated | |` : '')
    : '| — | — | — |'

  const linesAdded = gitDiff.stats.totalAdditions
  const linesRemoved = gitDiff.stats.totalDeletions

  const frontmatter = [
    '---',
    `session_id: ${sessionId}`,
    `date: "${date}"`,
    `duration_minutes: ${conversation.durationMinutes}`,
    `files_changed: ${conversation.filesModified.length}`,
    `concepts: [${conceptsStr}]`,
    'status: auto-generated',
    ...(linesAdded > 0 ? [`lines_added: ${linesAdded}`] : []),
    ...(linesRemoved > 0 ? [`lines_removed: ${linesRemoved}`] : []),
    '---',
  ].join('\n')

  return `${frontmatter}

# Session Debrief — ${date}

## Summary
${response.summary}

## Decisions Made
${decisions}

## Patterns Applied
${patterns}

## Trade-offs Accepted
${tradeoffs}

## Unknowns & Learning Gaps
${unknowns}

## Bugs & Lessons
${bugsAndLessons}

## Auto-extracted Explanations
${t.autoExtractComment}
${autoExtracted}

## Delegation Summary
| File | Status | Notes |
|------|--------|-------|
${delegationTable}
`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractTopicFromQuestion(text: string): string {
  const match = /(?:what is|what are|how does|explain)\s+(?:the\s+)?(\w[\w\s-]{2,30})/i.exec(text)
  return match?.[1]?.trim().toLowerCase() ?? 'unknown'
}

function inferPatternFromFile(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.includes('middleware')) return 'Middleware Pattern'
  if (lower.includes('service')) return 'Service Layer'
  if (lower.includes('hook')) return 'Hook/Handler'
  if (lower.includes('util') || lower.includes('helper')) return 'Utility Function'
  if (lower.includes('test')) return 'Test Implementation'
  if (lower.includes('config')) return 'Configuration'
  if (lower.includes('schema') || lower.includes('type')) return 'Type Definition'
  return 'Module Implementation'
}

const DEFAULT_SESSION_TEMPLATE = `---
session_id: {{sessionId}}
date: {{date}}
duration_minutes: {{durationMinutes}}
files_changed: {{filesChanged}}
concepts: [{{concepts}}]
status: auto-generated
---

# Session Debrief — {{date}}

## Summary
{{summary}}

## Decisions Made
{{decisions}}

## Patterns Applied
{{patterns}}

## Trade-offs Accepted
{{tradeoffs}}

## Unknowns & Learning Gaps
{{unknowns}}

## Auto-extracted Explanations
{{autoExtracted}}

## Delegation Summary
| File | Status | Notes |
|------|--------|-------|
{{delegationTable}}
`
