/**
 * SessionStart Hook
 * Reads .knowledge/index.md and injects it as additionalContext into Claude.
 * Called by Claude Code when a new session starts.
 */
import { readTextFile, fileExists } from '../utils/fs.js'
import { resolveKnowledgeBasePath } from '../core/config.js'
import { loadConfig } from '../core/config.js'
import { join } from 'node:path'
import type { HookBaseInput, HookSyncOutput } from '../core/schema.js'

async function main(): Promise<void> {
  let input: HookBaseInput

  try {
    const raw = await readStdin()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.cwd !== 'string') {
      console.error('[DKC:SessionStart] Invalid hook input: missing cwd')
      process.exit(0)
    }
    input = parsed as HookBaseInput
  } catch (err) {
    console.error(`[DKC:SessionStart] Failed to parse stdin: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(0)
  }

  const projectRoot = input.cwd ?? process.cwd()

  try {
    const config = await loadConfig(projectRoot)
    const kbPath = resolveKnowledgeBasePath(projectRoot, config)
    const indexPath = join(kbPath, 'index.md')

    if (!(await fileExists(indexPath))) {
      // No knowledge base yet — exit silently
      process.exit(0)
    }

    const indexContent = await readTextFile(indexPath)

    const output: HookSyncOutput = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `## Your Knowledge Base\n\nHere is your current knowledge index for this project:\n\n${indexContent}`,
      },
    }

    process.stdout.write(JSON.stringify(output) + '\n')
  } catch (err) {
    console.error(`[DKC:SessionStart] Error: ${err instanceof Error ? err.message : String(err)}`)
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
