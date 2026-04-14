/**
 * PostToolUse Hook (matcher: Write|Edit)
 * Tracks file writes/edits into a delegation buffer for later compile.
 * Fire-and-forget — no stdout response needed.
 */
import { join } from 'node:path'
import { safeReadJsonFile, writeJsonFile } from '../utils/fs.js'
import { nowISO } from '../utils/date.js'
import type { PostToolUseInput, DelegationBufferEntry } from '../core/schema.js'

async function main(): Promise<void> {
  const pluginData = process.env['CLAUDE_PLUGIN_DATA']
  if (!pluginData) process.exit(0)

  let input: PostToolUseInput

  try {
    const raw = await readStdin()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.tool_name !== 'string') {
      process.exit(0)
    }
    input = parsed as PostToolUseInput
  } catch (err) {
    console.error(`[DKC:PostToolUse] Failed to parse stdin: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(0)
  }

  if (!['Write', 'Edit'].includes(input.tool_name)) {
    process.exit(0)
  }

  const toolInput = input.tool_input as Record<string, unknown>
  const rawFilePath = String(toolInput['file_path'] ?? toolInput['path'] ?? '')
  if (!rawFilePath) process.exit(0)

  // Relativize against project root (cwd) before storing — never store absolute paths
  // Use toRelativePath (NFC-normalized) instead of path.relative() to handle macOS Unicode paths
  const cwd = input.cwd ?? process.cwd()
  const { toRelativePath, isInsideProject } = await import('../utils/path.js')
  if (rawFilePath.startsWith('/') && !isInsideProject(cwd, rawFilePath)) process.exit(0)
  const filePath = toRelativePath(cwd, rawFilePath)

  const bufferPath = join(pluginData, 'delegation-buffer.json')
  const buffer = await safeReadJsonFile<DelegationBufferEntry[]>(bufferPath, [])

  buffer.push({
    toolName: input.tool_name,
    filePath,
    timestamp: nowISO(),
    sessionId: input.session_id,
  })

  await writeJsonFile(bufferPath, buffer)
  process.exit(0)
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
