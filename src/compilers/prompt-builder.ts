import type { ConversationParsed, GitDiffParsed, ConceptPage, DKCLanguage } from '../core/schema.js'

// ─── Prompt Builder ───────────────────────────────────────────────────────────
// Builds the LLM prompt for Session Debrief compilation.
// Takes collected data and existing knowledge, outputs a structured prompt.

export interface DebriefPromptContext {
  conversation: ConversationParsed
  gitDiff: GitDiffParsed
  existingConcepts: ConceptPage[]
  projectName: string
  sessionId: string
  language?: DKCLanguage
}

export interface DebriefLLMResponse {
  summary: string
  decisions: Array<{
    what: string
    why: string
    alternatives?: string
  }>
  patterns: Array<{
    name: string
    file: string
    context: string
  }>
  tradeoffs: Array<{
    chose: string
    over: string
    because: string
  }>
  unknowns: Array<{
    concept: string
    evidence: string
    relatedSlug?: string
  }>
  autoExtracted: Array<{
    concept: string
    messageIndex: number
    condensed: string
  }>
  bugsAndLessons: Array<{
    concept: string           // concept slug or name this bug relates to
    bug: string               // what went wrong
    fix: string               // how it was fixed
    lesson: string            // takeaway for next time
  }>
  conceptsMentioned: string[]   // existing concept slugs referenced
}

// ─── Prompt composition ───────────────────────────────────────────────────────

const LANGUAGE_INSTRUCTION: Record<string, string> = {
  en: 'Write all content in English.',
  vi: 'Viết toàn bộ nội dung bằng tiếng Việt. Dùng thuật ngữ kỹ thuật tiếng Anh khi cần (ví dụ: middleware, hook, compiler) nhưng giải thích bằng tiếng Việt.',
}

export function buildDebriefPrompt(ctx: DebriefPromptContext): string {
  const { conversation, gitDiff, existingConcepts, projectName, sessionId, language = 'en' } = ctx
  const langInstruction = LANGUAGE_INSTRUCTION[language] ?? LANGUAGE_INSTRUCTION['en']!

  const conceptList = existingConcepts
    .map(c => `- ${c.slug}: ${c.name}`)
    .join('\n')

  const userMessages = conversation.userMessages
    .map(m => `[${m.type}] ${m.text}`)
    .join('\n')

  const toolSummary = summarizeToolCalls(conversation)
  const diffSummary = summarizeGitDiff(gitDiff)
  const confusionSummary = summarizeConfusionSignals(conversation)
  const autoExtractCandidates = buildAutoExtractCandidates(conversation)

  return `You are the DKC Compiler. Analyze this coding session and produce a structured session debrief.
Language instruction: ${langInstruction}


## Project: ${projectName}
## Session: ${sessionId}
## Duration: ${conversation.durationMinutes} minutes
## Messages: ${conversation.messageCount}

## Developer Messages (human-typed only)
${userMessages || '(none)'}

## Tool Calls Summary
${toolSummary}

## Files Modified
${conversation.filesModified.join('\n') || '(none)'}

## Commands Run
${sanitizeCommands(conversation.commandsRun).join('\n') || '(none)'}

## Git Diff Summary
${diffSummary}

## Confusion Signals (questions & long explanations)
${confusionSummary}

## Long AI Explanations (candidates for auto-extraction)
${autoExtractCandidates}

## Existing Concepts in Knowledge Base
${conceptList || '(empty knowledge base)'}

---

Respond with a JSON object (no markdown fences) matching this exact schema:

{
  "summary": "3-5 sentences describing what was accomplished. Be specific to this project.",
  "decisions": [
    { "what": "string", "why": "string", "alternatives": "string or omit" }
  ],
  "patterns": [
    { "name": "pattern name", "file": "file path", "context": "how it was applied" }
  ],
  "tradeoffs": [
    { "chose": "string", "over": "string", "because": "string" }
  ],
  "unknowns": [
    { "concept": "string", "evidence": "quoted text from session", "relatedSlug": "slug if matches existing concept or omit" }
  ],
  "autoExtracted": [
    { "concept": "string", "messageIndex": 0, "condensed": "project-specific condensed explanation, 2-4 sentences" }
  ],
  "bugsAndLessons": [
    { "concept": "concept-slug-or-name", "bug": "what went wrong", "fix": "how it was resolved", "lesson": "key takeaway" }
  ],
  "conceptsMentioned": ["slug1", "slug2"]
}

Rules:
- summary: written in past tense, project-specific (not generic)
- decisions: only include decisions that were explicitly discussed or implied by refactoring choices
- patterns: identify design patterns, architectural patterns, or coding patterns applied
- tradeoffs: identify choices where alternatives were rejected
- unknowns: identify concepts the developer asked about or seemed confused about
- autoExtracted: for each long explanation (>300 words) from the AI, condense the key insight in project-specific terms
- bugsAndLessons: extract bugs, errors, or issues encountered during the session and how they were fixed. IMPORTANT: For the "concept" field, you MUST use a slug from the "Existing Concepts" list above if the bug relates to that concept (e.g. use "llm-client" not "llm-provider-selection", use "conversation" not "transcript-parser"). If no existing concept matches, use a short kebab-case name. Describe the bug, the fix, and the lesson learned. Include configuration mistakes, API issues, regex bugs, type errors, etc.
- conceptsMentioned: only list slugs from the existing concepts list above
- If a section has nothing, use an empty array []
- Maximum 5 items per section (except bugsAndLessons: up to 8)
- Be concise and project-specific, NOT generic`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function summarizeToolCalls(conv: ConversationParsed): string {
  const counts: Record<string, number> = {}
  for (const tc of conv.toolCalls) {
    counts[tc.toolName] = (counts[tc.toolName] ?? 0) + 1
  }
  const lines = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => `- ${name}: ${count}x`)
  return lines.join('\n') || '(no tool calls)'
}

function summarizeGitDiff(diff: GitDiffParsed): string {
  if (diff.files.length === 0) return '(no git changes)'
  const lines: string[] = [
    `Commit: ${diff.commitMessage ?? 'unknown'} (${diff.commitHash?.slice(0, 8) ?? 'no hash'})`,
    `Files: ${diff.stats.totalFiles} changed (+${diff.stats.totalAdditions} -${diff.stats.totalDeletions})`,
  ]
  if (diff.stats.newFiles.length > 0) {
    lines.push(`New: ${diff.stats.newFiles.join(', ')}`)
  }
  if (diff.stats.significantChanges.length > 0) {
    lines.push(`Significant (>50 lines): ${diff.stats.significantChanges.join(', ')}`)
  }
  for (const file of diff.files.slice(0, 5)) {
    lines.push(`  ${file.status}: ${file.path} (+${file.additions}/-${file.deletions})`)
  }
  return lines.join('\n')
}

function summarizeConfusionSignals(conv: ConversationParsed): string {
  if (conv.confusionSignals.length === 0) return '(none)'
  return conv.confusionSignals
    .map(s => `[${s.type}] "${s.text.slice(0, 100)}${s.text.length > 100 ? '...' : ''}"${s.concept ? ` (concept: ${s.concept})` : ''}`)
    .join('\n')
}

/** Strip arguments that may contain secrets from bash commands before sending to LLM */
function sanitizeCommands(commands: string[]): string[] {
  const sensitivePatterns = /(?:--password|--token|--secret|--key|--auth|--credential|API_KEY|SECRET|PASSWORD|TOKEN|Bearer\s+\S+|sk-[a-zA-Z0-9_-]+|ghp_[a-zA-Z0-9]+|gho_[a-zA-Z0-9]+)/i
  return commands.map(cmd => {
    if (sensitivePatterns.test(cmd)) {
      // Keep only the command name (first word), redact the rest
      const firstWord = cmd.split(/\s+/)[0] ?? cmd
      return `${firstWord} [REDACTED — contained sensitive args]`
    }
    return cmd
  })
}

function buildAutoExtractCandidates(conv: ConversationParsed): string {
  const candidates = conv.confusionSignals.filter(s => s.type === 'long-explanation-needed')
  if (candidates.length === 0) return '(none)'
  return candidates
    .map(s => `[message #${s.index}] "${s.text.slice(0, 200)}..."${s.concept ? ` (about: ${s.concept})` : ''}`)
    .join('\n')
}
