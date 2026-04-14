/**
 * PreCompact Hook
 * Saves knowledge context snapshot before Claude compacts the conversation.
 * Ensures knowledge context is not lost during context window compression.
 */
import { join } from 'node:path'
import { fileExists, readTextFile, writeJsonFile } from '../utils/fs.js'
import { loadConfig, resolveKnowledgeBasePath } from '../core/config.js'
import { nowISO } from '../utils/date.js'
import type { HookBaseInput } from '../core/schema.js'

interface ContextSnapshot {
  savedAt: string
  indexContent: string
  sessionId: string
}

async function main(): Promise<void> {
  const pluginData = process.env['CLAUDE_PLUGIN_DATA']
  if (!pluginData) process.exit(0)

  let input: HookBaseInput

  try {
    const raw = await readStdin()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.cwd !== 'string') {
      console.error('[DKC:PreCompact] Invalid hook input')
      process.exit(0)
    }
    input = parsed as HookBaseInput
  } catch (err) {
    console.error(`[DKC:PreCompact] Failed to parse stdin: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(0)
  }

  const projectRoot = input.cwd ?? process.cwd()

  try {
    const config = await loadConfig(projectRoot)
    const kbPath = resolveKnowledgeBasePath(projectRoot, config)
    const indexPath = join(kbPath, 'index.md')

    if (!(await fileExists(indexPath))) {
      process.exit(0)
    }

    const indexContent = await readTextFile(indexPath)
    const snapshot: ContextSnapshot = {
      savedAt: nowISO(),
      indexContent,
      sessionId: input.session_id,
    }

    await writeJsonFile(join(pluginData, 'context-snapshot.json'), snapshot)
    process.exit(0)
  } catch (err) {
    console.error(`[DKC:PreCompact] Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(0)
  }
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
