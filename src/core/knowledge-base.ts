import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readTextFile, writeTextFile, fileExists, dirExists, ensureDir, listFiles, appendTextFile } from '../utils/fs.js'
import { parseMarkdown, stringifyMarkdown, fillTemplate } from '../utils/markdown.js'
import { nowISO, isoToDate, dateToSessionId } from '../utils/date.js'
import type {
  DKCConfig,
  ConceptPage,
  ConceptPageMetadata,
  SessionDebrief,
  DelegationMap,
  Gap,
  KnowledgeBaseStats,
} from './schema.js'

const DIRS = ['sessions', 'concepts', 'delegation'] as const

export class KnowledgeBase {
  readonly root: string

  constructor(knowledgeBasePath: string) {
    this.root = knowledgeBasePath
  }

  // ─── Initialization ─────────────────────────────────────────────────────────

  async exists(): Promise<boolean> {
    return dirExists(this.root)
  }

  async scaffold(config: DKCConfig, projectName: string): Promise<string[]> {
    const created: string[] = []

    await ensureDir(this.root)
    for (const dir of DIRS) {
      const dirPath = join(this.root, dir)
      await ensureDir(dirPath)
      created.push(dirPath)
    }

    // Write KNOWLEDGE.md
    const knowledgeMdPath = join(this.root, 'KNOWLEDGE.md')
    if (!(await fileExists(knowledgeMdPath))) {
      const tpl = await this.loadTemplate('KNOWLEDGE.md.tpl')
      const content = fillTemplate(tpl, {
        version: config.version,
        projectName,
        date: isoToDate(nowISO()),
      })
      await writeTextFile(knowledgeMdPath, content)
      created.push(knowledgeMdPath)
    }

    // Write index.md
    const indexPath = join(this.root, 'index.md')
    if (!(await fileExists(indexPath))) {
      const content = `# Knowledge Index — ${projectName}\n\n> Initialized ${isoToDate(nowISO())}. Run \`dkc reflect\` after your first session to populate this index.\n`
      await writeTextFile(indexPath, content)
      created.push(indexPath)
    }

    // Write log.md
    const logPath = join(this.root, 'log.md')
    if (!(await fileExists(logPath))) {
      const tpl = await this.loadTemplate('log.md.tpl')
      const content = fillTemplate(tpl, { projectName })
      await writeTextFile(logPath, content)
      created.push(logPath)
    }

    // Write gaps.md
    const gapsPath = join(this.root, 'gaps.md')
    if (!(await fileExists(gapsPath))) {
      const content = `# Knowledge Gaps\n\n> Not yet analyzed. Run \`dkc gaps\` to find knowledge gaps.\n`
      await writeTextFile(gapsPath, content)
      created.push(gapsPath)
    }

    return created
  }

  // ─── Sessions ────────────────────────────────────────────────────────────────

  async writeSessionDebrief(debrief: SessionDebrief): Promise<void> {
    await writeTextFile(debrief.filePath, debrief.content)
  }

  async getSessionPaths(): Promise<string[]> {
    return listFiles(join(this.root, 'sessions'), '.md')
  }

  async getRecentSessions(limit = 10): Promise<SessionDebrief[]> {
    const paths = await this.getSessionPaths()
    const sorted = paths.sort().reverse().slice(0, limit)
    const sessions: SessionDebrief[] = []

    for (const filePath of sorted) {
      try {
        const raw = await readTextFile(filePath)
        const { frontmatter, content } = parseMarkdown<Record<string, unknown>>(raw)
        const rawDate = frontmatter['date']
        const dateStr = rawDate instanceof Date ? isoToDate(rawDate.toISOString()) : String(rawDate ?? '')
        const metadata = {
          sessionId: String(frontmatter['session_id'] ?? ''),
          date: dateStr,
          durationMinutes: Number(frontmatter['duration_minutes'] ?? 0),
          filesChanged: Number(frontmatter['files_changed'] ?? 0),
          concepts: Array.isArray(frontmatter['concepts']) ? frontmatter['concepts'] as string[] : [],
          status: (frontmatter['status'] as 'auto-generated' | 'human-reviewed') ?? 'auto-generated',
          ...(frontmatter['cost_usd'] != null && { costUsd: Number(frontmatter['cost_usd']) }),
          ...(frontmatter['lines_added'] != null && { linesAdded: Number(frontmatter['lines_added']) }),
          ...(frontmatter['lines_removed'] != null && { linesRemoved: Number(frontmatter['lines_removed']) }),
        }
        sessions.push({ filePath, content: raw, metadata })
      } catch {
        // Skip corrupted session files
      }
    }

    return sessions
  }

  sessionFilePath(sessionId: string): string {
    return join(this.root, 'sessions', `${sessionId}.md`)
  }

  // ─── Concepts ────────────────────────────────────────────────────────────────

  async getConcepts(): Promise<ConceptPage[]> {
    const paths = await listFiles(join(this.root, 'concepts'), '.md')
    const concepts: ConceptPage[] = []

    for (const filePath of paths) {
      if (filePath.endsWith('_template.md')) continue
      try {
        const page = await this.readConcept(filePath)
        if (page) concepts.push(page)
      } catch {
        // Skip corrupted concept files
      }
    }

    return concepts
  }

  async getConceptBySlug(slug: string): Promise<ConceptPage | null> {
    const filePath = this.conceptFilePath(slug)
    return this.readConcept(filePath)
  }

  async getConceptSlugs(): Promise<string[]> {
    const paths = await listFiles(join(this.root, 'concepts'), '.md')
    return paths
      .filter(p => !p.endsWith('_template.md'))
      .map(p => p.replace(/^.*\//, '').replace(/\.md$/, ''))
  }

  async writeConcept(page: ConceptPage): Promise<void> {
    await writeTextFile(page.filePath, page.content)
  }

  async writeConcepts(pages: ConceptPage[]): Promise<void> {
    for (const page of pages) {
      await this.writeConcept(page)
    }
  }

  conceptFilePath(slug: string): string {
    return join(this.root, 'concepts', `${slug}.md`)
  }

  private async readConcept(filePath: string): Promise<ConceptPage | null> {
    if (!(await fileExists(filePath))) return null

    const raw = await readTextFile(filePath)
    const { frontmatter } = parseMarkdown<Record<string, unknown>>(raw)

    const slug = filePath.replace(/^.*\//, '').replace(/\.md$/, '')
    return {
      slug,
      name: String(frontmatter['name'] ?? slug),
      filePath,
      content: raw,
      metadata: {
        name: String(frontmatter['name'] ?? slug),
        slug,
        firstSeen: normalizeDate(frontmatter['first_seen']) ?? nowISO(),
        lastUpdated: normalizeDate(frontmatter['last_updated']) ?? nowISO(),
        sessionCount: Number(frontmatter['session_count'] ?? 0),
        relatedConcepts: Array.isArray(frontmatter['related_concepts']) ? frontmatter['related_concepts'] as string[] : [],
        relatedFiles: Array.isArray(frontmatter['related_files']) ? frontmatter['related_files'] as string[] : [],
        status: (frontmatter['status'] as 'auto-generated' | 'human-reviewed') ?? 'auto-generated',
      },
    }
  }

  // ─── Delegation Map ──────────────────────────────────────────────────────────

  async getDelegationMap(): Promise<DelegationMap | null> {
    const mapPath = join(this.root, 'delegation', 'map.md')
    if (!(await fileExists(mapPath))) return null

    try {
      const raw = await readTextFile(mapPath)
      const { frontmatter } = parseMarkdown<Record<string, unknown>>(raw)
      return {
        lastUpdated: String(frontmatter['last_updated'] ?? nowISO()),
        summary: {
          totalFiles: Number(frontmatter['total_files'] ?? 0),
          aiGenerated: Number(frontmatter['ai_generated'] ?? 0),
          aiModified: Number(frontmatter['ai_modified'] ?? 0),
          humanWritten: Number(frontmatter['human_written'] ?? 0),
          unreviewed: Number(frontmatter['unreviewed'] ?? 0),
          percentageAi: Number(frontmatter['percentage_ai'] ?? 0),
        },
        entries: [],
        trend: [],
      }
    } catch {
      return null
    }
  }

  async writeDelegationMap(map: DelegationMap): Promise<void> {
    const mapPath = join(this.root, 'delegation', 'map.md')
    const tpl = await this.loadTemplate('delegation-map.md.tpl')

    const fileEntries = map.entries.map(e =>
      `| \`${e.filePath}\` | ${e.state} | ${Math.round(e.confidence * 100)}% | ${isoToDate(e.lastModified)} | ${e.sessions.length} |`
    ).join('\n')

    const trend = map.trend.map(t =>
      `| ${t.date} | ${t.percentageAi}% | ${t.percentageReviewed}% |`
    ).join('\n')

    const content = fillTemplate(tpl, {
      lastUpdated: map.lastUpdated,
      projectName: '',
      totalFiles: map.summary.totalFiles,
      aiGenerated: map.summary.aiGenerated,
      aiModified: map.summary.aiModified,
      humanWritten: map.summary.humanWritten,
      unreviewed: map.summary.unreviewed,
      percentageAi: map.summary.percentageAi,
      fileEntries: fileEntries || '| — | — | — | — | — |',
      trend: trend || '| — | — | — |',
    })

    await writeTextFile(mapPath, content)
  }

  // ─── Index ───────────────────────────────────────────────────────────────────

  async writeIndex(content: string): Promise<void> {
    await writeTextFile(join(this.root, 'index.md'), content)
  }

  async readIndex(): Promise<string> {
    const indexPath = join(this.root, 'index.md')
    if (!(await fileExists(indexPath))) return ''
    return readTextFile(indexPath)
  }

  // ─── Log ─────────────────────────────────────────────────────────────────────

  async appendLog(event: string, target: string, details: string): Promise<void> {
    const logPath = join(this.root, 'log.md')
    const line = `- ${isoToDate(nowISO())} ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} | ${event} | ${target} | ${details}\n`
    await appendTextFile(logPath, line)
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────

  async getStats(): Promise<KnowledgeBaseStats> {
    const [sessions, concepts, delegationMap] = await Promise.all([
      this.getSessionPaths(),
      this.getConcepts(),
      this.getDelegationMap(),
    ])

    const gapContent = await (async () => {
      const p = join(this.root, 'gaps.md')
      if (!(await fileExists(p))) return ''
      return readTextFile(p)
    })()

    const gapCount = (gapContent.match(/^##/gm) ?? []).length

    const lastSession = sessions.sort().at(-1)
    const lastCompiled = lastSession
      ? parseMarkdown<Record<string, unknown>>(await readTextFile(lastSession)).frontmatter['date'] as string ?? null
      : null

    return {
      sessionCount: sessions.length,
      conceptCount: concepts.length,
      gapCount,
      lastCompiled,
      delegationSummary: delegationMap?.summary ?? {
        totalFiles: 0, aiGenerated: 0, aiModified: 0,
        humanWritten: 0, unreviewed: 0, percentageAi: 0,
      },
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async loadTemplate(name: string): Promise<string> {
    // Templates are relative to this file at runtime.
    // In dev: src/core/knowledge-base.ts → ../templates/
    // In dist (bundled): dist/index.js → ./templates/ (same dir)
    const thisDir = dirname(fileURLToPath(import.meta.url))

    // Try multiple candidate paths (bundled vs source layout)
    const candidates = [
      join(thisDir, 'templates', name),              // dist/index.js → dist/templates/
      join(thisDir, '..', 'templates', name),        // dist/cli/index.js → dist/templates/
      join(thisDir, '..', '..', 'templates', name),  // dist/cli/index.js → ../../templates/ (dev)
    ]

    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        return readTextFile(candidate)
      }
    }
    // Fallback: return empty string (template may not exist)
    return ''
  }
}

// ─── Module-level helpers ─────────────────────────────────────────────────────

/**
 * Normalize a date value from gray-matter (which may parse YYYY-MM-DD as Date).
 */
function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) return isoToDate(value.toISOString())
  if (typeof value === 'string') return value.length >= 10 ? value.slice(0, 10) : value
  return null
}
