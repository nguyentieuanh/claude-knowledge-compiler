import { join } from 'node:path'
import { readdirSync, statSync } from 'node:fs'
import { fileExists } from '../../utils/fs.js'
import { loadConfig, resolveKnowledgeBasePath } from '../../core/config.js'
import { KnowledgeBase } from '../../core/knowledge-base.js'
import { collectConversation } from '../../collectors/conversation.js'
import { collectGitDiff } from '../../collectors/git-diff.js'
import { compileSessionDebrief } from '../../compilers/session-debrief.js'
import { compileConceptWiki } from '../../compilers/concept-wiki.js'
import { compileDelegationMap } from '../../compilers/delegation-map.js'
import { analyzeGaps } from '../../compilers/gaps-analyzer.js'
import { buildIndexContent } from '../../compilers/index-updater.js'
import { getLLMProviderLabel, ensureEnvLoaded } from '../../compilers/llm-client.js'
import { safeReadJsonFile, writeTextFile } from '../../utils/fs.js'
import { dateToSessionId } from '../../utils/date.js'
import { out } from '../output.js'
import type { PendingCompileData } from '../../core/schema.js'

// ─── reflect command ──────────────────────────────────────────────────────────

export interface ReflectOptions {
  projectRoot: string
  sessionId?: string           // If not given, uses latest
  transcriptPath?: string      // Override: explicit path to .jsonl
  fromPending?: boolean        // Read from CLAUDE_PLUGIN_DATA/pending-compile.json
  quiet?: boolean
  force?: boolean              // Recompile even if session already compiled
}

export type StageStatus = 'ok' | 'failed' | 'skipped'

export interface ReflectResult {
  sessionId: string
  sessionFilePath: string
  conceptsCreated: number
  conceptsUpdated: number
  success: boolean
  error?: string
  stageResults?: {
    debrief: StageStatus
    concepts: StageStatus
    delegation: StageStatus
    gaps: StageStatus
    index: StageStatus
  }
  stageErrors?: string[]
}

export async function runReflect(options: ReflectOptions): Promise<ReflectResult> {
  const { projectRoot, quiet = false } = options

  if (!quiet) out.header('Compiling session knowledge...')

  // Load .env early so all env checks below see the correct values
  ensureEnvLoaded()

  if (!quiet && !process.env['ANTHROPIC_API_KEY'] && !process.env['OPENAI_API_KEY']) {
    out.warn('No LLM API key found — using deterministic fallback. Concept descriptions and session analysis will be minimal.')
    out.warn('Set ANTHROPIC_API_KEY or OPENAI_API_KEY (in .env) for full LLM-powered compilation.')
  }

  try {
    // 1. Load config
    const config = await loadConfig(projectRoot)
    const knowledgeBasePath = resolveKnowledgeBasePath(projectRoot, config)
    const kb = new KnowledgeBase(knowledgeBasePath)

    if (!(await kb.exists())) {
      return {
        sessionId: '',
        sessionFilePath: '',
        conceptsCreated: 0,
        conceptsUpdated: 0,
        success: false,
        error: 'Knowledge base not initialized. Run `dkc init` first.',
      }
    }

    // 2. Resolve source data (pending-compile.json or collect fresh)
    let transcriptPath: string
    let sessionId: string

    if (options.fromPending || process.env['CLAUDE_PLUGIN_DATA']) {
      const pending = await loadPendingCompile()
      if (!pending) {
        if (!quiet) out.warn('No pending compile data found. Skipping.')
        return {
          sessionId: '',
          sessionFilePath: '',
          conceptsCreated: 0,
          conceptsUpdated: 0,
          success: false,
          error: 'No pending compile data',
        }
      }
      transcriptPath = pending.transcriptPath
      sessionId = pending.sessionId
      if (!quiet) out.step(`Compiling session ${sessionId}`)
    } else {
      // Fresh collection: resolve transcript path
      transcriptPath = options.transcriptPath ?? resolveTranscriptPath(projectRoot, options.sessionId)
      // Derive session ID from transcript filename if available, else fall back to current date
      const transcriptFilename = transcriptPath.split('/').at(-1)?.replace('.jsonl', '') ?? ''
      sessionId = options.sessionId
        ?? (transcriptFilename && transcriptFilename !== 'latest' ? dateToSessionId(new Date()) : dateToSessionId(new Date()))
      // Use mtime of transcript file as session date if no explicit sessionId
      if (!options.sessionId && transcriptFilename && transcriptFilename !== 'latest') {
        try {
          const mtime = statSync(transcriptPath).mtime
          sessionId = dateToSessionId(mtime)
        } catch { /* use current date */ }
      }
      if (!quiet) out.step(`Collecting session ${sessionId}`)
    }

    // 2b. Dedup guard — skip if this session was already compiled
    const sessionFilePath = kb.sessionFilePath(sessionId)
    if (!options.force && await fileExists(sessionFilePath)) {
      if (!quiet) out.skip(`Session ${sessionId} already compiled. Use --force to recompile.`)
      return {
        sessionId,
        sessionFilePath,
        conceptsCreated: 0,
        conceptsUpdated: 0,
        success: true,
      }
    }

    // 3. Collect data in parallel
    if (!quiet) out.step('Collecting conversation and git diff...')
    const [conversation, gitDiff] = await Promise.all([
      collectConversation({ transcriptPath, sessionId, projectRoot }),
      collectGitDiff({ projectRoot, mode: 'last-commit' }),
    ])

    if (conversation.messageCount === 0) {
      if (!quiet) out.warn('No messages found in transcript. Skipping.')
      return {
        sessionId,
        sessionFilePath: '',
        conceptsCreated: 0,
        conceptsUpdated: 0,
        success: false,
        error: 'Empty transcript',
      }
    }

    if (!quiet) out.step(`Processing ${conversation.messageCount} messages, ${conversation.filesModified.length} files modified`)

    // 4. Load existing concepts for cross-referencing
    const existingConcepts = await kb.getConcepts()
    const projectName = projectRoot.split('/').at(-1) ?? 'project'

    const compileOptions = {
      projectRoot,
      knowledgeBasePath,
      transcriptPath,
      sessionId,
      config,
    }

    // ─── Resilient Pipeline ────────────────────────────────────────────────
    // Each stage is wrapped in try/catch. If a stage fails, subsequent stages
    // use fallback data. Index + log ALWAYS run at the end.
    // Inspired by Claude Code's Promise.allSettled pattern in AsyncHookRegistry.

    const stages: Record<string, StageStatus> = {
      debrief: 'skipped',
      concepts: 'skipped',
      delegation: 'skipped',
      gaps: 'skipped',
      index: 'skipped',
    }
    const stageErrors: string[] = []

    // Stage 1: Session Debrief
    let debrief: import('../../core/schema.js').SessionDebrief | null = null
    let bugsAndLessons: Array<{ concept: string; bug: string; fix: string; lesson: string }> = []

    try {
      if (!quiet) {
        const providerLabel = getLLMProviderLabel()
        const llmMode = providerLabel ? `(LLM-enhanced via ${providerLabel})` : '(deterministic fallback)'
        out.step(`Generating session debrief ${llmMode}...`)
      }

      const debriefResult = await compileSessionDebrief({
        conversation,
        gitDiff,
        existingConcepts,
        options: compileOptions,
        projectName,
      })
      debrief = debriefResult.debrief
      bugsAndLessons = debriefResult.bugsAndLessons

      await kb.writeSessionDebrief(debrief)
      if (!quiet) out.success(`Session debrief written: sessions/${debrief.metadata.sessionId}.md`)
      stages.debrief = 'ok'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      stages.debrief = 'failed'
      stageErrors.push(`debrief: ${msg}`)
      if (!quiet) out.warn(`Session debrief failed: ${msg} — continuing...`)
    }

    // Stage 2: Concept Wiki
    let conceptsCreated = 0
    let conceptsUpdated = 0

    try {
      if (!quiet) out.step('Compiling concept wiki...')
      const conceptResult = await compileConceptWiki({
        conversation,
        gitDiff,
        existingConcepts,
        options: compileOptions,
        projectName,
        sessionId,
        bugsAndLessons,
      })

      await kb.writeConcepts(conceptResult.created)
      await kb.writeConcepts(conceptResult.updated)

      conceptsCreated = conceptResult.created.length
      conceptsUpdated = conceptResult.updated.length
      if (!quiet && (conceptsCreated + conceptsUpdated) > 0) {
        out.success(`Concepts: ${conceptsCreated} new, ${conceptsUpdated} updated`)
      }
      stages.concepts = 'ok'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      stages.concepts = 'failed'
      stageErrors.push(`concepts: ${msg}`)
      if (!quiet) out.warn(`Concept wiki failed: ${msg} — continuing...`)
    }

    // Stage 3: Delegation Map
    let delegationMap: import('../../core/schema.js').DelegationMap | null = null

    try {
      if (!quiet) out.step('Updating delegation map...')
      const existingMap = await kb.getDelegationMap()
      const delegationResult = compileDelegationMap({
        conversation,
        gitDiff,
        existingMap,
        delegationBuffer: [],
        options: compileOptions,
        sessionId,
        projectRoot,
      })
      delegationMap = delegationResult.map
      await kb.writeDelegationMap(delegationMap)
      stages.delegation = 'ok'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      stages.delegation = 'failed'
      stageErrors.push(`delegation: ${msg}`)
      if (!quiet) out.warn(`Delegation map failed: ${msg} — continuing...`)
    }

    // Stage 4: Gaps Analysis
    let gapsResult: { gaps: import('../../core/schema.js').Gap[]; summary: { total: number; high: number; medium: number; low: number } } = {
      gaps: [], summary: { total: 0, high: 0, medium: 0, low: 0 },
    }

    try {
      if (!quiet) out.step('Analyzing knowledge gaps...')
      const allSessions = await kb.getRecentSessions(50)
      const updatedConcepts = await kb.getConcepts()
      gapsResult = analyzeGaps({
        delegationMap: delegationMap ?? { summary: { totalFiles: 0, aiGeneratedPercent: 0, humanModifiedPercent: 0, humanReviewedPercent: 0 }, entries: [], trend: [] },
        concepts: updatedConcepts,
        sessions: allSessions,
        staleKnowledgeDays: config.staleKnowledgeDays,
        projectRoot,
      })

      const gapsContent = buildGapsMarkdown(gapsResult.gaps, gapsResult.summary)
      const gapsPath = join(knowledgeBasePath, 'gaps.md')
      await writeTextFile(gapsPath, gapsContent)
      if (!quiet && gapsResult.summary.total > 0) {
        out.info(`  Gaps: ${gapsResult.summary.high} high, ${gapsResult.summary.medium} medium, ${gapsResult.summary.low} low`)
      }
      stages.gaps = 'ok'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      stages.gaps = 'failed'
      stageErrors.push(`gaps: ${msg}`)
      if (!quiet) out.warn(`Gaps analysis failed: ${msg} — continuing...`)
    }

    // Stage 5: Index + Log (ALWAYS runs)
    try {
      if (!quiet) out.step('Updating knowledge index...')
      const allSessions = await kb.getRecentSessions(50)
      const latestConcepts = await kb.getConcepts()
      const indexContent = buildIndexContent({
        projectName,
        concepts: latestConcepts,
        recentSessions: allSessions,
        gaps: gapsResult.gaps,
        staleDays: config.staleKnowledgeDays,
      })
      await kb.writeIndex(indexContent)

      const logSessionId = debrief?.metadata.sessionId ?? sessionId
      const logDetails = `${conversation.messageCount} messages, ${conversation.filesModified.length} files, ${conceptsCreated} new concepts, ${conceptsUpdated} updated, ${gapsResult.summary.total} gaps`
      await kb.appendLog('compile', logSessionId, logDetails)
      stages.index = 'ok'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      stages.index = 'failed'
      stageErrors.push(`index: ${msg}`)
      if (!quiet) out.warn(`Index update failed: ${msg}`)
    }

    // ─── Summary ───────────────────────────────────────────────────────────

    const okCount = Object.values(stages).filter(s => s === 'ok').length
    const failCount = Object.values(stages).filter(s => s === 'failed').length
    const totalStages = Object.keys(stages).length

    if (!quiet) {
      if (failCount === 0) {
        out.success(`Knowledge compiled successfully! (${okCount}/${totalStages} stages)`)
      } else {
        out.warn(`Knowledge compiled with issues: ${okCount}/${totalStages} stages OK, ${failCount} failed`)
        for (const err of stageErrors) {
          out.info(`  ✗ ${err}`)
        }
      }
      const displaySessionId = debrief?.metadata.sessionId ?? sessionId
      out.info(`  Session: ${displaySessionId}`)
      if (debrief) {
        out.info(`  Duration: ${debrief.metadata.durationMinutes} minutes`)
        out.info(`  Files modified: ${debrief.metadata.filesChanged}`)
      }
      if ((conceptsCreated + conceptsUpdated) > 0) {
        out.info(`  Concepts: ${conceptsCreated} created, ${conceptsUpdated} updated`)
      }
    }

    return {
      sessionId: debrief?.metadata.sessionId ?? sessionId,
      sessionFilePath: debrief?.filePath ?? '',
      conceptsCreated,
      conceptsUpdated,
      success: okCount > 0,
      stageResults: stages as ReflectResult['stageResults'],
      stageErrors: stageErrors.length > 0 ? stageErrors : undefined,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!quiet) out.error(`Compile failed: ${msg}`)
    return {
      sessionId: options.sessionId ?? '',
      sessionFilePath: '',
      conceptsCreated: 0,
      conceptsUpdated: 0,
      success: false,
      error: msg,
    }
  }
}

// ─── Gaps Markdown Builder ────────────────────────────────────────────────────

function buildGapsMarkdown(
  gaps: import('../../core/schema.js').Gap[],
  summary: { total: number; high: number; medium: number; low: number },
): string {
  if (gaps.length === 0) {
    return `# Knowledge Gaps\n\n> No gaps detected. Knowledge base is up to date.\n`
  }

  const lines = [
    '# Knowledge Gaps',
    '',
    `> ${summary.total} gaps detected: ${summary.high} high, ${summary.medium} medium, ${summary.low} low`,
    '',
  ]

  const highGaps = gaps.filter(g => g.severity === 'high')
  const medGaps = gaps.filter(g => g.severity === 'medium')
  const lowGaps = gaps.filter(g => g.severity === 'low')

  if (highGaps.length > 0) {
    lines.push('## High Priority')
    for (const g of highGaps) {
      lines.push(`### ${g.title}`)
      lines.push(`> ${g.description}`)
      lines.push('')
      lines.push(`**Action:** ${g.suggestedAction}`)
      if (g.relatedConcepts?.length) lines.push(`**Concepts:** ${g.relatedConcepts.join(', ')}`)
      if (g.relatedFiles?.length) lines.push(`**Files:** ${g.relatedFiles.slice(0, 5).join(', ')}`)
      lines.push('')
    }
  }

  if (medGaps.length > 0) {
    lines.push('## Medium Priority')
    for (const g of medGaps) {
      lines.push(`### ${g.title}`)
      lines.push(`> ${g.description}`)
      lines.push('')
      lines.push(`**Action:** ${g.suggestedAction}`)
      lines.push('')
    }
  }

  if (lowGaps.length > 0) {
    lines.push('## Low Priority')
    for (const g of lowGaps) {
      lines.push(`- **${g.title}**: ${g.description} → _${g.suggestedAction}_`)
    }
  }

  return lines.join('\n') + '\n'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadPendingCompile(): Promise<PendingCompileData | null> {
  const pluginData = process.env['CLAUDE_PLUGIN_DATA']
  if (!pluginData) return null

  const pendingPath = join(pluginData, 'pending-compile.json')
  const data = await safeReadJsonFile<PendingCompileData | null>(pendingPath, null)
  return data
}

function resolveTranscriptPath(projectRoot: string, sessionId?: string): string {
  // 1. Try CLAUDE_TRANSCRIPT_PATH env (set by hooks at runtime)
  const envTranscript = process.env['CLAUDE_TRANSCRIPT_PATH']
  if (envTranscript) return envTranscript

  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? ''

  // 2. Find the matching project dir by scanning projects/ directories.
  //    Support both ~/.claude/ (official) and ~/.codev/ (community builds).
  const candidateRoots = [
    join(home, '.claude', 'projects'),
    join(home, '.codev', 'projects'),
  ]

  const projectName = projectRoot.split('/').filter(Boolean).at(-1) ?? ''
  let claudeProjects: string | null = null
  let activeProjectsRoot = candidateRoots[0]!

  for (const candidateRoot of candidateRoots) {
    try {
      const dirs = readdirSync(candidateRoot)
      const normalizedProjectName = projectName.toLowerCase().replace(/[^a-z0-9]/g, '')
      for (const dir of dirs) {
        const normalizedDir = dir.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (normalizedDir.endsWith(normalizedProjectName)) {
          claudeProjects = join(candidateRoot, dir)
          activeProjectsRoot = candidateRoot
          break
        }
      }
      if (claudeProjects) break
    } catch { /* this projects root doesn't exist, try next */ }
  }

  if (!claudeProjects) {
    return join(activeProjectsRoot, 'latest.jsonl')
  }

  if (sessionId) {
    return join(claudeProjects, `${sessionId}.jsonl`)
  }

  // 3. Find the most recently modified .jsonl in the project dir
  try {
    const files = readdirSync(claudeProjects)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, mtime: statSync(join(claudeProjects!, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    if (files.length > 0 && files[0]) {
      return join(claudeProjects, files[0].name)
    }
  } catch { /* unreadable */ }

  return join(claudeProjects, 'latest.jsonl')
}
