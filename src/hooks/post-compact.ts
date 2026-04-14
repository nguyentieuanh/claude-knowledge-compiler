/**
 * PostCompact Hook
 * Re-injects knowledge context after Claude compacts the conversation.
 * Reads the snapshot saved by PreCompact hook.
 */
import { join } from 'node:path'
import { safeReadJsonFile } from '../utils/fs.js'
import type { HookBaseInput, HookSyncOutput } from '../core/schema.js'

interface ContextSnapshot {
  savedAt: string
  indexContent: string
  sessionId: string
}

async function main(): Promise<void> {
  const pluginData = process.env['CLAUDE_PLUGIN_DATA']
  if (!pluginData) process.exit(0)

  try {
    await readStdin() // consume stdin
  } catch {
    // stdin errors are non-blocking for PostCompact
  }

  try {
    const snapshot = await safeReadJsonFile<ContextSnapshot>(
      join(pluginData, 'context-snapshot.json'),
      { savedAt: '', indexContent: '', sessionId: '' },
    )

    if (!snapshot.indexContent) {
      process.exit(0)
    }

    const output: HookSyncOutput = {
      hookSpecificOutput: {
        hookEventName: 'PostCompact',
        additionalContext: `## Knowledge Base Context (restored after compact)\n\n${snapshot.indexContent}`,
      },
    }

    process.stdout.write(JSON.stringify(output) + '\n')
  } catch (err) {
    console.error(`[DKC:PostCompact] Error: ${err instanceof Error ? err.message : String(err)}`)
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
