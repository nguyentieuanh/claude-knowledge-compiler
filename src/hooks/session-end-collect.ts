/**
 * SessionEnd Hook — Part 1: Data Collection (type: command)
 * Collects session data and writes to pending-compile.json.
 * No LLM access here — pure data prep.
 * The agent hook (Part 2) reads this file and does the LLM compile.
 */
import { join } from 'node:path'
import { safeReadJsonFile, writeJsonFile, fileExists } from '../utils/fs.js'
import { loadConfig, resolveKnowledgeBasePath } from '../core/config.js'
import { nowISO } from '../utils/date.js'
import type { HookBaseInput, PendingCompileData, DelegationBufferEntry } from '../core/schema.js'

async function main(): Promise<void> {
  const pluginData = process.env['CLAUDE_PLUGIN_DATA']
  if (!pluginData) process.exit(0)

  let input: HookBaseInput

  try {
    const raw = await readStdin()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.cwd !== 'string' || typeof parsed.session_id !== 'string') {
      console.error('[DKC:SessionEnd] Invalid hook input: missing cwd or session_id')
      process.exit(0)
    }
    input = parsed as HookBaseInput
  } catch (err) {
    console.error(`[DKC:SessionEnd] Failed to parse stdin: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(0)
  }

  const projectRoot = input.cwd ?? process.cwd()

  try {
    const config = await loadConfig(projectRoot)
    const kbPath = resolveKnowledgeBasePath(projectRoot, config)

    // Check autoCompile setting
    const autoCompileEnv = process.env['CLAUDE_PLUGIN_OPTION_AUTOCOMPILE']
    const autoCompile = autoCompileEnv !== undefined
      ? autoCompileEnv === 'true'
      : config.autoCompile

    if (!autoCompile) process.exit(0)

    // Count messages in transcript (quick check)
    const minMessages = config.autoCompileMinMessages
    const transcriptPath = input.transcript_path
    if (transcriptPath) {
      const lineCount = await countTranscriptLines(transcriptPath)
      if (lineCount < minMessages) {
        process.exit(0) // Session too short — skip
      }
    }

    // Read and clear delegation buffer
    const bufferPath = join(pluginData, 'delegation-buffer.json')
    const delegationBuffer = await safeReadJsonFile<DelegationBufferEntry[]>(bufferPath, [])

    // Write pending-compile.json
    const pendingPath = join(pluginData, 'pending-compile.json')
    const pending: PendingCompileData = {
      sessionId: input.session_id,
      transcriptPath: input.transcript_path,
      projectRoot,
      knowledgeBasePath: kbPath,
      delegationBuffer,
      collectedAt: nowISO(),
      messageCount: await countTranscriptLines(transcriptPath ?? ''),
    }

    await writeJsonFile(pendingPath, pending)

    // Clear delegation buffer (consumed)
    await writeJsonFile(bufferPath, [])

    // Signal success — agent hook will handle LLM compile
    process.exit(0)
  } catch (err) {
    console.error(`[DKC:SessionEnd] Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(0)
  }
}

async function countTranscriptLines(transcriptPath: string): Promise<number> {
  if (!transcriptPath || !(await fileExists(transcriptPath))) return 0

  const { createReadStream } = await import('node:fs')
  const { createInterface } = await import('node:readline')

  return new Promise((resolve) => {
    let count = 0
    const rl = createInterface({ input: createReadStream(transcriptPath) })
    rl.on('line', (line) => { if (line.trim()) count++ })
    rl.on('close', () => resolve(count))
    rl.on('error', () => resolve(0))
  })
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', chunk => { data += chunk })
    process.stdin.on('end', () => resolve(data.trim()))
    process.stdin.on('error', reject)
  })
}

main()
