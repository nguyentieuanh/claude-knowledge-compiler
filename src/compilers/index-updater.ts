import type { ConceptPage, SessionDebrief, Gap } from '../core/schema.js'
import { isoToDate, isOlderThanDays } from '../utils/date.js'
import { nowISO } from '../utils/date.js'

// ─── Index Updater (P6: index-first navigation) ───────────────────────────────
// Regenerates index.md after each compile with a rich, structured index.
// The index is the entry point for every session — Claude reads it first
// to understand what the developer already knows.

// ─── Domain Inference ────────────────────────────────────────────────────────
// Infer domain from file paths so index can be grouped by domain instead of flat.

const DOMAIN_MAP: Array<{ patterns: RegExp[]; label: string }> = [
  // Auth: avoid bare "session" (too generic — a coding session is not an auth session)
  { patterns: [/\bauth\b|login|\btoken\b|oauth|jwt|credential|bearer|permission/i], label: 'Auth & Security' },
  { patterns: [/\bapi\b|route|endpoint|\brequest\b|\bresponse\b|\bhttp\b|rest|graphql/i], label: 'API & Networking' },
  { patterns: [/\bdb\b|database|model|schema|migration|query|\bsql\b|mongo|redis/i], label: 'Data & Storage' },
  { patterns: [/hooks?|event|listener|trigger|handler|callback|subscriber/i], label: 'Events & Hooks' },
  // UI: use \bui\b to avoid false-positive on "builder" (b-ui-lder substring)
  { patterns: [/\bui\b|component|\bview\b|\bpage\b|layout|style|\bcss\b|design/i], label: 'UI & Frontend' },
  { patterns: [/infra|deploy|docker|\bci\b|\bcd\b|pipeline|\bconfig\b|\benv\b/i], label: 'Infrastructure & DevOps' },
  { patterns: [/\btest\b|spec|mock|fixture|assert/i], label: 'Testing' },
  { patterns: [/\butil\b|helper|common|shared|\blib\b/i], label: 'Utilities' },
  { patterns: [/compiler|collector|analyzer|parser|generator/i], label: 'Core Pipeline' },
  { patterns: [/service|worker|queue|\bjob\b|\btask\b|cron/i], label: 'Services & Workers' },
]

function inferDomain(concept: ConceptPage): string {
  // Priority 1: file paths — most reliable signal (path structure reflects intent)
  const fileText = concept.metadata.relatedFiles.join(' ').toLowerCase()
  if (fileText) {
    for (const { patterns, label } of DOMAIN_MAP) {
      if (patterns.some(p => p.test(fileText))) return label
    }
  }

  // Priority 2: slug only (NOT full name — avoids "Session Debrief" → "session" → Auth false positive)
  const slugText = concept.slug.toLowerCase()
  for (const { patterns, label } of DOMAIN_MAP) {
    if (patterns.some(p => p.test(slugText))) return label
  }

  return 'General'
}

export interface IndexUpdateInput {
  projectName: string
  concepts: ConceptPage[]
  recentSessions: SessionDebrief[]
  gaps: Gap[]
  staleDays: number   // from config.staleKnowledgeDays
}

export function buildIndexContent(input: IndexUpdateInput): string {
  const { projectName, concepts, recentSessions, gaps, staleDays } = input

  const now = nowISO()

  // Split concepts into active (referenced recently) vs stale
  const activeConcepts = concepts
    .filter(c => !isOlderThanDays(c.metadata.lastUpdated, staleDays))
    .sort((a, b) => b.metadata.sessionCount - a.metadata.sessionCount)

  const staleConcepts = concepts
    .filter(c => isOlderThanDays(c.metadata.lastUpdated, staleDays))

  // Top gaps (high priority knowledge holes)
  const topGaps = gaps
    .filter(g => g.severity === 'high')
    .slice(0, 5)

  const sections: string[] = []

  sections.push(`# Knowledge Index — ${projectName}`)
  sections.push(`\n> Last updated: ${isoToDate(now)} | ${concepts.length} concepts | ${recentSessions.length} sessions compiled\n`)

  // Active concepts — grouped by domain
  if (activeConcepts.length > 0) {
    sections.push(`## Active Concepts (updated in last ${staleDays} days)`)

    // Group by domain
    const byDomain = new Map<string, ConceptPage[]>()
    for (const c of activeConcepts.slice(0, 30)) {
      const domain = inferDomain(c)
      const group = byDomain.get(domain) ?? []
      group.push(c)
      byDomain.set(domain, group)
    }

    // Sort domains: General last
    const domainOrder = [...byDomain.keys()].sort((a, b) => {
      if (a === 'General') return 1
      if (b === 'General') return -1
      return a.localeCompare(b)
    })

    for (const domain of domainOrder) {
      const domainConcepts = byDomain.get(domain) ?? []
      sections.push(`\n### ${domain}`)
      for (const c of domainConcepts) {
        const sessionStr = `${c.metadata.sessionCount} session${c.metadata.sessionCount !== 1 ? 's' : ''}`
        const lastDate = isoToDate(c.metadata.lastUpdated)
        const relatedHint = c.metadata.relatedConcepts.length > 0
          ? ` | related: ${c.metadata.relatedConcepts.slice(0, 2).join(', ')}`
          : ''
        sections.push(`- [${c.name}](concepts/${c.slug}.md) — ${sessionStr} | last: ${lastDate}${relatedHint}`)
      }
    }
    sections.push('')
  }

  // Stale concepts — flat list (less important)
  if (staleConcepts.length > 0) {
    sections.push(`## Stale Concepts (not updated in ${staleDays}+ days)`)
    for (const c of staleConcepts.slice(0, 10)) {
      sections.push(`- [${c.name}](concepts/${c.slug}.md) — last: ${isoToDate(c.metadata.lastUpdated)}`)
    }
    sections.push('')
  }

  // Top knowledge gaps
  if (topGaps.length > 0) {
    sections.push('## Knowledge Gaps (high priority)')
    for (const g of topGaps) {
      sections.push(`- **${g.type}**: ${g.description} → _${g.suggestedAction}_`)
    }
    sections.push('')
  }

  // Recent sessions
  if (recentSessions.length > 0) {
    sections.push('## Recent Sessions')
    for (const s of recentSessions.slice(0, 10)) {
      const sessionId = s.metadata.sessionId
      const date = s.metadata.date
      const conceptCount = s.metadata.concepts.length
      const fileCount = s.metadata.filesChanged
      const conceptHint = conceptCount > 0 ? `, ${conceptCount} concept${conceptCount !== 1 ? 's' : ''} touched` : ''
      sections.push(`- [${sessionId}](sessions/${sessionId}.md) — ${date} | ${fileCount} file${fileCount !== 1 ? 's' : ''}${conceptHint}`)
    }
    sections.push('')
  }

  // Summary stats for Claude context
  sections.push('## Quick Stats')
  sections.push(`- Total concepts: ${concepts.length}`)
  sections.push(`- Active concepts: ${activeConcepts.length}`)
  sections.push(`- Total sessions: ${recentSessions.length}`)
  if (topGaps.length > 0) {
    sections.push(`- High-priority gaps: ${topGaps.length}`)
  }

  return sections.join('\n') + '\n'
}
