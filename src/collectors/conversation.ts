import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileExists } from '../utils/fs.js'
import { minutesBetween, nowISO } from '../utils/date.js'
import { wordCount } from '../utils/markdown.js'
import type {
  ConversationParsed,
  UserMessageParsed,
  AICodeBlock,
  ToolCallParsed,
  ConfusionSignal,
} from '../core/schema.js'

// ─── Raw JSONL Types (from Claude Code transcript format) ─────────────────────

interface TranscriptMessageBase {
  type: string
  uuid: string
  timestamp: string
  cwd: string
  sessionId: string
  version: string
  parentUuid: string | null
  isSidechain: boolean
  agentId?: string
}

interface RawUserMessage extends TranscriptMessageBase {
  type: 'user'
  message: {
    role: 'user'
    content: string | RawContentBlock[]
  }
  origin?: 'agent' | 'teammate' | 'command' | 'system' | 'hook'
  // origin === undefined → human-typed
}

interface RawAssistantMessage extends TranscriptMessageBase {
  type: 'assistant'
  message: {
    id: string
    type: 'message'
    role: 'assistant'
    content: RawContentBlock[]
    model: string
    stop_reason: string
    usage?: { input_tokens: number; output_tokens: number }
  }
}

type RawContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | RawContentBlock[] }
  | { type: 'thinking'; thinking: string }

type TranscriptMessage = RawUserMessage | RawAssistantMessage | TranscriptMessageBase

// ─── Confusion Signal Patterns ────────────────────────────────────────────────

const EXPLICIT_QUESTION_PATTERNS = [
  /\bwhat is\b/i,
  /\bwhat are\b/i,
  /\bwhy (does|is|are|do)\b/i,
  /\bhow does\b/i,
  /\bhow (do|can|should)\b/i,
  /\bexplain\b/i,
  /\bi don'?t understand\b/i,
  /\bconfused\b/i,
  /\bwhat do you mean\b/i,
  /\bcan you clarify\b/i,
  // Vietnamese question patterns
  /\blà gì\b/i,
  /\btại sao\b/i,
  /\bvì sao\b/i,
  /\blàm sao\b/i,
  /\bbằng cách nào\b/i,
  /\bgiải thích\b/i,
  /\bkhông hiểu\b/i,
  /\bcách nào\b/i,
  /\bnhư thế nào\b/i,
  /\bsao lại\b/i,
]

const LONG_EXPLANATION_THRESHOLD = 300 // words

// ─── Main Collector ───────────────────────────────────────────────────────────

export interface CollectOptions {
  transcriptPath: string
  sessionId: string
  projectRoot?: string  // If provided, file paths are relativized
}

export async function collectConversation(options: CollectOptions): Promise<ConversationParsed> {
  const { transcriptPath, sessionId, projectRoot } = options
  // Normalize both to NFC before comparing — macOS HFS+ returns NFD from process.cwd()
  // but paths stored in transcript may be NFC, causing startsWith() to fail.
  const normalizedRoot = projectRoot ? projectRoot.normalize('NFC') : ''
  const relativize = (fp: string): string => {
    if (!normalizedRoot) return fp
    const normalizedFp = fp.normalize('NFC')
    if (!normalizedFp.startsWith(normalizedRoot)) return fp
    return normalizedFp.slice(normalizedRoot.length).replace(/^\//, '')
  }

  if (!(await fileExists(transcriptPath))) {
    return emptyConversation(sessionId, transcriptPath)
  }

  const messages = await parseJSONL(transcriptPath)

  if (messages.length === 0) {
    return emptyConversation(sessionId, transcriptPath)
  }

  const userMessages: UserMessageParsed[] = []
  const aiCodeBlocks: AICodeBlock[] = []
  const toolCalls: ToolCallParsed[] = []
  const filesModified: string[] = []
  const commandsRun: string[] = []
  let messageIndex = 0

  for (const msg of messages) {
    if (msg.type === 'user') {
      const userMsg = msg as RawUserMessage
      // Only human-typed messages (origin === undefined)
      if (userMsg.origin !== undefined) continue

      const text = extractUserText(userMsg)
      if (!text.trim()) continue

      userMessages.push({
        index: messageIndex,
        text,
        type: classifyUserMessage(text),
        origin: userMsg.origin,
        timestamp: userMsg.timestamp,
      })
    } else if (msg.type === 'assistant') {
      const assistantMsg = msg as RawAssistantMessage
      const content = assistantMsg.message?.content ?? []

      for (const block of content) {
        if (block.type === 'tool_use') {
          toolCalls.push({
            index: messageIndex,
            toolName: block.name,
            input: block.input,
            timestamp: assistantMsg.timestamp,
          })

          // Track file modifications — skip files outside project root
          if (block.name === 'Write' || block.name === 'Edit') {
            const rawFp = String(block.input['file_path'] ?? block.input['path'] ?? '')
            const fp = relativize(rawFp)
            // If relativize returned absolute path, file is outside project — skip
            if (fp && !fp.startsWith('/') && !filesModified.includes(fp)) {
              filesModified.push(fp)
            }
          }

          // Track bash commands
          if (block.name === 'Bash') {
            const cmd = String(block.input['command'] ?? '')
            if (cmd) commandsRun.push(cmd)
          }

          // Extract code blocks from Write content
          if (block.name === 'Write') {
            const content = String(block.input['content'] ?? '')
            const rawFp = String(block.input['file_path'] ?? '')
            const fp = relativize(rawFp)
            if (content) {
              aiCodeBlocks.push({
                index: messageIndex,
                language: detectLanguage(fp),
                code: content,
                ...(fp ? { filePath: fp } : {}),
                context: '',
              })
            }
          }
        } else if (block.type === 'text') {
          // Extract inline code blocks from text responses
          extractInlineCodeBlocks(block.text, messageIndex, aiCodeBlocks)
        }
      }
    }

    messageIndex++
  }

  // Add tool results to toolCalls
  for (const msg of messages) {
    if (msg.type !== 'user') continue
    const userMsg = msg as RawUserMessage
    const content = userMsg.message?.content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      if (typeof block === 'object' && block.type === 'tool_result') {
        const toolResult = block as { type: 'tool_result'; tool_use_id: string; content: string | RawContentBlock[] }
        const matchingCall = toolCalls.find(tc =>
          // Find by sequential matching since we don't store tool_use_id
          tc.toolName !== undefined
        )
        if (matchingCall && matchingCall.result === undefined) {
          const resultContent = toolResult.content
          matchingCall.result = typeof resultContent === 'string'
            ? resultContent
            : JSON.stringify(resultContent)
        }
      }
    }
  }

  // Detect confusion signals from user messages + assistant responses
  const confusionSignals = detectConfusionSignals(userMessages, messages as RawAssistantMessage[])

  // Calculate timeline
  const timestamps = messages
    .map(m => m.timestamp)
    .filter(Boolean)
    .sort()

  const startTime = timestamps[0] ?? nowISO()
  const endTime = timestamps[timestamps.length - 1] ?? startTime
  const durationMinutes = minutesBetween(startTime, endTime)

  return {
    sessionId,
    transcriptPath,
    startTime,
    endTime,
    durationMinutes,
    messageCount: messages.length,
    userMessages,
    aiCodeBlocks,
    toolCalls,
    confusionSignals,
    filesModified: [...new Set(filesModified)],
    commandsRun,
  }
}

// ─── JSONL Parser ─────────────────────────────────────────────────────────────

async function parseJSONL(filePath: string): Promise<TranscriptMessage[]> {
  const messages: TranscriptMessage[] = []
  const warnings: string[] = []

  await new Promise<void>((resolve, reject) => {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    })

    let lineNum = 0
    rl.on('line', (line) => {
      lineNum++
      const trimmed = line.trim()
      if (!trimmed) return

      try {
        const parsed = JSON.parse(trimmed) as TranscriptMessage
        messages.push(parsed)
      } catch {
        // Skip corrupted lines — P1: don't crash, just warn
        warnings.push(`Line ${lineNum}: invalid JSON, skipping`)
      }
    })

    rl.on('close', resolve)
    rl.on('error', reject)
  })

  // Filter out sidechains and non-conversation messages
  return messages.filter(m =>
    !('isSidechain' in m && m.isSidechain) &&
    (m.type === 'user' || m.type === 'assistant')
  )
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function extractUserText(msg: RawUserMessage): string {
  const content = msg.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .filter((b): b is { type: 'text'; text: string } => typeof b === 'object' && b.type === 'text')
    .map(b => b.text)
    .join(' ')
    .trim()
}

function classifyUserMessage(text: string): UserMessageParsed['type'] {
  const lower = text.toLowerCase()
  if (EXPLICIT_QUESTION_PATTERNS.some(p => p.test(lower))) return 'question'
  if (/\b(please|can you|could you|would you)\b/i.test(lower)) return 'instruction'
  if (/\b(yes|no|ok|okay|sure|looks good|correct|right|approved)\b/i.test(lower)) return 'approval'
  return 'instruction'
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', go: 'go', rs: 'rust', java: 'java', cs: 'csharp',
    rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
    css: 'css', scss: 'scss', html: 'html', json: 'json', yaml: 'yaml',
    yml: 'yaml', md: 'markdown', sh: 'bash', bash: 'bash',
  }
  return map[ext] ?? ext
}

function extractInlineCodeBlocks(
  text: string,
  messageIndex: number,
  target: AICodeBlock[],
): void {
  const pattern = /```(\w*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const language = match[1] ?? ''
    const code = match[2] ?? ''
    if (code.trim().length < 20) continue // Skip trivial snippets

    target.push({
      index: messageIndex,
      language,
      code,
      context: text.slice(Math.max(0, match.index - 100), match.index).trim(),
    })
  }
}

function detectConfusionSignals(
  userMessages: UserMessageParsed[],
  allMessages: RawAssistantMessage[],
): ConfusionSignal[] {
  const signals: ConfusionSignal[] = []

  // 1. Explicit questions
  for (const msg of userMessages) {
    if (msg.type === 'question') {
      const concept = extractConceptMention(msg.text)
      signals.push({
        index: msg.index,
        text: msg.text,
        type: 'explicit-question',
        ...(concept !== undefined && { concept }),
      })
    }
  }

  // 2. Long explanations from assistant (>300 words)
  for (const msg of allMessages) {
    if (msg.type !== 'assistant') continue
    const textBlocks = (msg.message?.content ?? [])
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join(' ')

    if (wordCount(textBlocks) >= LONG_EXPLANATION_THRESHOLD) {
      const concept = extractConceptFromExplanation(textBlocks)
      signals.push({
        index: 0,
        text: textBlocks.slice(0, 200) + '...',
        type: 'long-explanation-needed',
        ...(concept !== undefined && { concept }),
      })
    }
  }

  // 3. Repeated questions (same topic > 1 time)
  const questionTopics = userMessages
    .filter(m => m.type === 'question')
    .map(m => ({ index: m.index, normalized: normalizeQuestion(m.text) }))

  const seen = new Map<string, number>()
  for (const { index, normalized } of questionTopics) {
    const prev = seen.get(normalized)
    if (prev !== undefined) {
      signals.push({
        index,
        text: userMessages.find(m => m.index === index)?.text ?? '',
        type: 'repeated-question',
      })
    } else {
      seen.set(normalized, index)
    }
  }

  return signals
}

function normalizeQuestion(text: string): string {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function extractConceptMention(text: string): string | undefined {
  // Look for quoted terms or "X pattern", "X injection", etc.
  const patterns = [
    /["']([^"']{3,50})["']/,
    /\b(\w+\s+(?:injection|pattern|loop|hook|context|provider|resolver|middleware))\b/i,
    /\bwhat (?:is|are) (?:the |a |an )?(\w[\w\s]{2,30})\b/i,
    /\bhow (?:does|do) (?:the |a |an )?(\w[\w\s]{2,30}) work\b/i,
  ]

  for (const pattern of patterns) {
    const m = pattern.exec(text)
    if (m?.[1]) {
      const extracted = m[1].trim().toLowerCase()
      // Guard: concept names must be short technical terms, not full sentences
      const wordCount = extracted.split(/\s+/).length
      if (wordCount <= 5 && extracted.length <= 60) return extracted
    }
  }
  return undefined
}

function extractConceptFromExplanation(text: string): string | undefined {
  // 1. Backtick-wrapped identifier in first 200 chars (most precise signal)
  const backtickMatch = /`([A-Za-z][A-Za-z0-9_]{3,40})`/.exec(text.slice(0, 200))
  if (backtickMatch?.[1]) return backtickMatch[1]

  // 2. Bold term in first 200 chars
  const boldMatch = /\*\*([A-Za-z][^*]{3,40})\*\*/.exec(text.slice(0, 200))
  if (boldMatch?.[1]) return boldMatch[1].trim().toLowerCase()

  // 3. "The X" / "In X" pattern with a known technical noun
  const techNounMatch = /\b(?:The|In|With|Using)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\b/.exec(text.slice(0, 150))
  if (techNounMatch?.[1] && techNounMatch[1].length > 4) return techNounMatch[1].toLowerCase()

  // 4. Fall back to first sentence concept extraction
  const firstSentence = text.split(/[.!?]/)[0] ?? ''
  return extractConceptMention(firstSentence)
}

function emptyConversation(sessionId: string, transcriptPath: string): ConversationParsed {
  const now = nowISO()
  return {
    sessionId,
    transcriptPath,
    startTime: now,
    endTime: now,
    durationMinutes: 0,
    messageCount: 0,
    userMessages: [],
    aiCodeBlocks: [],
    toolCalls: [],
    confusionSignals: [],
    filesModified: [],
    commandsRun: [],
  }
}
