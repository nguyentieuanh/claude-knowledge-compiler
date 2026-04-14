import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirExists } from '../utils/fs.js'
import { join } from 'node:path'
import type { GitDiffParsed, FileDiff, DiffHunk } from '../core/schema.js'

const execFileAsync = promisify(execFile)

export type DiffMode = 'last-commit' | 'staged' | 'working'

export interface GitDiffOptions {
  projectRoot: string
  mode?: DiffMode
}

// ─── Main Collector ───────────────────────────────────────────────────────────

export async function collectGitDiff(options: GitDiffOptions): Promise<GitDiffParsed> {
  const { projectRoot, mode = 'last-commit' } = options

  // Verify git repo exists
  if (!(await dirExists(join(projectRoot, '.git')))) {
    return emptyDiff()
  }

  try {
    const [commitMeta, diffStat, diffContent] = await Promise.all([
      getCommitMeta(projectRoot, mode),
      getDiffStat(projectRoot, mode),
      getDiffContent(projectRoot, mode),
    ])

    const files = parseDiffContent(diffContent)

    // Merge stat data into files
    mergeDiffStats(files, diffStat)

    const totalAdditions = files.reduce((s, f) => s + f.additions, 0)
    const totalDeletions = files.reduce((s, f) => s + f.deletions, 0)
    const newFiles = files.filter(f => f.status === 'added').map(f => f.path)
    const significantChanges = files
      .filter(f => f.additions + f.deletions > 50)
      .map(f => f.path)

    return {
      ...commitMeta,
      files,
      stats: {
        totalFiles: files.length,
        totalAdditions,
        totalDeletions,
        newFiles,
        significantChanges,
      },
    }
  } catch {
    return emptyDiff()
  }
}

// ─── Git Commands ─────────────────────────────────────────────────────────────

async function getCommitMeta(
  projectRoot: string,
  mode: DiffMode,
): Promise<Pick<GitDiffParsed, 'commitHash' | 'commitMessage' | 'author' | 'timestamp'>> {
  if (mode !== 'last-commit') return {}

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '-1', '--format=%H|%s|%an|%aI'],
      { cwd: projectRoot },
    )
    const [hash, subject, author, timestamp] = stdout.trim().split('|')
    return {
      ...(hash !== undefined && { commitHash: hash }),
      ...(subject !== undefined && { commitMessage: subject }),
      ...(author !== undefined && { author }),
      ...(timestamp !== undefined && { timestamp }),
    }
  } catch {
    return {}
  }
}

async function getDiffStat(projectRoot: string, mode: DiffMode): Promise<string> {
  const args = buildDiffArgs(mode, ['--numstat'])
  try {
    const { stdout } = await execFileAsync('git', ['diff', ...args], { cwd: projectRoot })
    return stdout
  } catch {
    return ''
  }
}

async function getDiffContent(projectRoot: string, mode: DiffMode): Promise<string> {
  const args = buildDiffArgs(mode, ['-U3'])
  try {
    const { stdout } = await execFileAsync('git', ['diff', ...args], { cwd: projectRoot })
    return stdout
  } catch {
    return ''
  }
}

function buildDiffArgs(mode: DiffMode, extraArgs: string[]): string[] {
  switch (mode) {
    case 'last-commit':
      return ['HEAD~1', 'HEAD', ...extraArgs]
    case 'staged':
      return ['--cached', ...extraArgs]
    case 'working':
      return [...extraArgs]
  }
}

// ─── Diff Parsers ─────────────────────────────────────────────────────────────

function parseDiffContent(diffContent: string): FileDiff[] {
  if (!diffContent.trim()) return []

  const files: FileDiff[] = []
  // Split by "diff --git" header
  const fileSections = diffContent.split(/^diff --git /m).filter(Boolean)

  for (const section of fileSections) {
    const file = parseFileDiff(section)
    if (file) files.push(file)
  }

  return files
}

function parseFileDiff(section: string): FileDiff | null {
  const lines = section.split('\n')
  const header = lines[0] ?? ''

  // Parse file paths: "a/src/foo.ts b/src/foo.ts"
  const headerMatch = /^a\/(.+) b\/(.+)$/.exec(header)
  if (!headerMatch) return null

  const aPath = headerMatch[1] ?? ''
  const bPath = headerMatch[2] ?? ''

  // Determine status
  let status: FileDiff['status'] = 'modified'
  let path = bPath
  let oldPath: string | undefined

  for (const line of lines) {
    if (line.startsWith('new file mode')) { status = 'added'; break }
    if (line.startsWith('deleted file mode')) { status = 'deleted'; path = aPath; break }
    if (line.startsWith('rename from ')) {
      status = 'renamed'
      oldPath = line.replace('rename from ', '').trim()
    }
  }

  const hunks = parseHunks(lines)

  return {
    path,
    status,
    ...(oldPath !== undefined && { oldPath }),
    additions: 0, // Will be filled from numstat
    deletions: 0,
    hunks,
  }
}

function parseHunks(lines: string[]): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null
  const hunkLines: string[] = []

  for (const line of lines) {
    const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunkHeader) {
      if (currentHunk && hunkLines.length > 0) {
        currentHunk.content = hunkLines.join('\n')
        hunks.push(currentHunk)
        hunkLines.length = 0
      }
      currentHunk = {
        oldStart: parseInt(hunkHeader[1] ?? '0', 10),
        oldLines: parseInt(hunkHeader[2] ?? '1', 10),
        newStart: parseInt(hunkHeader[3] ?? '0', 10),
        newLines: parseInt(hunkHeader[4] ?? '1', 10),
        content: '',
      }
      hunkLines.push(line)
    } else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      hunkLines.push(line)
    }
  }

  if (currentHunk && hunkLines.length > 0) {
    currentHunk.content = hunkLines.join('\n')
    hunks.push(currentHunk)
  }

  return hunks
}

function mergeDiffStats(files: FileDiff[], numstatOutput: string): void {
  if (!numstatOutput.trim()) return

  const statMap = new Map<string, { additions: number; deletions: number }>()

  for (const line of numstatOutput.split('\n')) {
    const parts = line.trim().split('\t')
    if (parts.length < 3) continue
    const [addStr, delStr, path] = parts
    if (!path) continue
    const additions = parseInt(addStr ?? '0', 10)
    const deletions = parseInt(delStr ?? '0', 10)
    statMap.set(path, {
      additions: isNaN(additions) ? 0 : additions,
      deletions: isNaN(deletions) ? 0 : deletions,
    })
  }

  for (const file of files) {
    const stats = statMap.get(file.path)
    if (stats) {
      file.additions = stats.additions
      file.deletions = stats.deletions
    }
  }
}

// ─── Parse from raw diff string (for testing with fixture files) ──────────────

export function parseGitDiffFromString(diffContent: string): GitDiffParsed {
  if (!diffContent.trim()) return emptyDiff()

  // Extract commit meta from header if present
  const commitHashMatch = /^commit ([0-9a-f]+)/m.exec(diffContent)
  const authorMatch = /^Author: (.+)$/m.exec(diffContent)
  const dateMatch = /^Date:\s+(.+)$/m.exec(diffContent)
  const subjectMatch = /^    (.+)$/m.exec(diffContent)

  // Extract just the diff part
  const diffStart = diffContent.indexOf('diff --git')
  const diffPart = diffStart >= 0 ? diffContent.slice(diffStart) : diffContent

  const files = parseDiffContent(diffPart)
  const totalAdditions = files.reduce((s, f) => s + f.additions, 0)
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0)

  const commitHash = commitHashMatch?.[1]
  const commitMessage = subjectMatch?.[1]?.trim()
  const author = authorMatch?.[1]?.trim()
  const timestamp = dateMatch?.[1]?.trim()

  return {
    ...(commitHash !== undefined && { commitHash }),
    ...(commitMessage !== undefined && { commitMessage }),
    ...(author !== undefined && { author }),
    ...(timestamp !== undefined && { timestamp }),
    files,
    stats: {
      totalFiles: files.length,
      totalAdditions,
      totalDeletions,
      newFiles: files.filter(f => f.status === 'added').map(f => f.path),
      significantChanges: files.filter(f => f.additions + f.deletions > 50).map(f => f.path),
    },
  }
}

function emptyDiff(): GitDiffParsed {
  return {
    files: [],
    stats: {
      totalFiles: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      newFiles: [],
      significantChanges: [],
    },
  }
}
