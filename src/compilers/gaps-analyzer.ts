import { toRelativePath } from '../utils/path.js'
import type {
  DelegationMap,
  ConceptPage,
  SessionDebrief,
  Gap,
  GapType,
  GapSeverity,
} from '../core/schema.js'
import { nowISO } from '../utils/date.js'
import { isOlderThanDays } from '../utils/date.js'
import { extractCrossReferences } from '../utils/markdown.js'
import { slugify } from '../utils/slug.js'

// ─── Gaps Analyzer (Step 6) ───────────────────────────────────────────────────
// Detects all 8 gap types and produces actionable gap entries.
// P3: Every gap MUST have a suggestedAction.

export interface GapsAnalyzeInput {
  delegationMap: DelegationMap | null
  concepts: ConceptPage[]
  sessions: SessionDebrief[]
  staleKnowledgeDays: number
  projectRoot: string
}

export interface GapsAnalyzeResult {
  gaps: Gap[]
  summary: {
    total: number
    high: number
    medium: number
    low: number
    byType: Record<GapType, number>
  }
}

// ─── Main Analyzer ────────────────────────────────────────────────────────────

export function analyzeGaps(input: GapsAnalyzeInput): GapsAnalyzeResult {
  const { delegationMap, concepts, sessions, staleKnowledgeDays, projectRoot } = input
  const allGaps: Gap[] = []

  // Run all detectors
  allGaps.push(...detectUnreviewedCode(delegationMap, projectRoot))
  allGaps.push(...detectConceptNoPage(sessions, concepts))
  allGaps.push(...detectOrphanConcepts(concepts, sessions, staleKnowledgeDays))
  allGaps.push(...detectRepeatedPatterns(sessions, concepts))
  allGaps.push(...detectPersistentUnknowns(sessions))
  allGaps.push(...detectStaleKnowledge(concepts, staleKnowledgeDays))
  allGaps.push(...detectMissingCrossReferences(concepts))

  // Sort by severity
  const severityOrder: Record<GapSeverity, number> = { high: 0, medium: 1, low: 2 }
  allGaps.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  const summary = buildSummary(allGaps)

  return { gaps: allGaps, summary }
}

// ─── Gap Detectors ────────────────────────────────────────────────────────────

function detectUnreviewedCode(map: DelegationMap | null, projectRoot: string): Gap[] {
  if (!map) return []
  const gaps: Gap[] = []
  const unreviewedFiles = map.entries.filter(e => e.state === 'ai-generated')

  if (unreviewedFiles.length === 0) return []

  const toRelative = (fp: string) => toRelativePath(projectRoot, fp)

  gaps.push({
    id: `unreviewed-code-${Date.now()}`,
    type: 'unreviewed-code',
    severity: unreviewedFiles.length > 5 ? 'high' : 'medium',
    title: `${unreviewedFiles.length} AI-generated files not reviewed`,
    description: `${unreviewedFiles.length} files were written by AI but never modified by a human: ${unreviewedFiles.slice(0, 3).map(f => toRelative(f.filePath)).join(', ')}${unreviewedFiles.length > 3 ? ` (+${unreviewedFiles.length - 3} more)` : ''}`,
    suggestedAction: 'Review AI-generated code, make at least a small edit to each file to confirm understanding',
    relatedFiles: unreviewedFiles.map(f => toRelative(f.filePath)).slice(0, 10),
    detectedAt: nowISO(),
  })

  return gaps
}

function detectConceptNoPage(sessions: SessionDebrief[], concepts: ConceptPage[]): Gap[] {
  // Find concepts mentioned in sessions that have no concept page
  const conceptSlugs = new Set(concepts.map(c => c.slug))
  const mentionedWithoutPage: string[] = []

  const allMentioned = sessions.flatMap(s => s.metadata.concepts ?? [])
  const mentionCounts = new Map<string, number>()
  for (const slug of allMentioned) {
    if (!conceptSlugs.has(slug)) {
      mentionCounts.set(slug, (mentionCounts.get(slug) ?? 0) + 1)
    }
  }

  for (const [slug, count] of mentionCounts) {
    mentionedWithoutPage.push(`${slug} (${count}x)`)
  }

  if (mentionedWithoutPage.length === 0) return []

  return [{
    id: `concept-no-page-${Date.now()}`,
    type: 'concept-no-page',
    severity: 'medium',
    title: `${mentionedWithoutPage.length} concepts mentioned but no page exists`,
    description: `Concepts referenced in sessions but lacking pages: ${mentionedWithoutPage.slice(0, 5).join(', ')}`,
    suggestedAction: 'Run `dkc reflect` after a session that discusses these concepts to auto-generate pages',
    relatedConcepts: [...mentionCounts.keys()].slice(0, 10),
    detectedAt: nowISO(),
  }]
}

function detectOrphanConcepts(
  concepts: ConceptPage[],
  sessions: SessionDebrief[],
  staleKnowledgeDays: number,
): Gap[] {
  const referencedSlugs = new Set(sessions.flatMap(s => s.metadata.concepts ?? []))
  const orphans = concepts.filter(c =>
    !referencedSlugs.has(c.slug) &&
    isOlderThanDays(c.metadata.lastUpdated, staleKnowledgeDays)
  )

  if (orphans.length === 0) return []

  return [{
    id: `orphan-concept-${Date.now()}`,
    type: 'orphan-concept',
    severity: 'low',
    title: `${orphans.length} concept pages not referenced recently`,
    description: `Pages that haven't been touched in ${staleKnowledgeDays}+ days and aren't referenced in recent sessions: ${orphans.map(c => c.slug).slice(0, 3).join(', ')}`,
    suggestedAction: 'Archive or delete outdated concept pages, or update them with current project context',
    relatedConcepts: orphans.map(c => c.slug),
    detectedAt: nowISO(),
  }]
}

function detectRepeatedPatterns(sessions: SessionDebrief[], concepts: ConceptPage[]): Gap[] {
  // Count how many times each concept/pattern was mentioned across sessions
  const counts = new Map<string, number>()
  for (const s of sessions) {
    for (const concept of s.metadata.concepts ?? []) {
      counts.set(concept, (counts.get(concept) ?? 0) + 1)
    }
  }

  const conceptSlugs = new Set(concepts.map(c => c.slug))
  const repeatedWithoutPage: string[] = []

  for (const [slug, count] of counts) {
    if (count > 3 && !conceptSlugs.has(slug)) {
      repeatedWithoutPage.push(`${slug} (${count}x)`)
    }
  }

  if (repeatedWithoutPage.length === 0) return []

  return [{
    id: `repeated-pattern-${Date.now()}`,
    type: 'repeated-pattern',
    severity: 'medium',
    title: `${repeatedWithoutPage.length} patterns used 3+ times with no concept page`,
    description: `Frequently recurring patterns: ${repeatedWithoutPage.slice(0, 5).join(', ')}`,
    suggestedAction: 'Create concept pages for frequently-used patterns to capture best practices and prevent knowledge loss',
    relatedConcepts: repeatedWithoutPage.map(r => r.split(' ')[0] ?? r),
    detectedAt: nowISO(),
  }]
}

function detectPersistentUnknowns(sessions: SessionDebrief[]): Gap[] {
  // Only flag concepts where the developer actually had unknowns/questions
  // across multiple sessions. A concept appearing in sessions is NORMAL —
  // it's only a gap if the session debrief recorded it in "unknowns".
  // We detect this by checking if the concept appears in the "Unknowns" section
  // of multiple session debriefs (via content text, since metadata.concepts
  // tracks all mentions, not just unknowns).
  const unknownCounts = new Map<string, string[]>()

  for (const session of sessions) {
    // Check if session content has an "Unknowns & Learning Gaps" section with actual entries
    const unknownsMatch = /## Unknowns & Learning Gaps\n([\s\S]*?)(?=\n## |$)/.exec(session.content)
    if (!unknownsMatch) continue
    const unknownsText = unknownsMatch[1] ?? ''
    if (unknownsText.includes('No learning gaps') || unknownsText.includes('Không phát hiện')) continue

    // Extract concept slugs mentioned in unknowns section
    const conceptRefs = unknownsText.matchAll(/\[\[([^\]]+)\]\]/g)
    for (const match of conceptRefs) {
      const slug = match[1] ?? ''
      if (!slug) continue
      const existing = unknownCounts.get(slug) ?? []
      existing.push(session.metadata.sessionId)
      unknownCounts.set(slug, existing)
    }

    // Also check bold concept names in unknowns: "- **concept name** —"
    const boldConcepts = unknownsText.matchAll(/\*\*([^*]+)\*\*/g)
    for (const match of boldConcepts) {
      const name = match[1]?.trim() ?? ''
      if (!name || name.length < 3) continue
      const slug = slugify(name)
      if (!slug) continue
      const existing = unknownCounts.get(slug) ?? []
      if (!existing.includes(session.metadata.sessionId)) {
        existing.push(session.metadata.sessionId)
      }
      unknownCounts.set(slug, existing)
    }
  }

  const persistent = [...unknownCounts.entries()]
    .filter(([, sessionIds]) => sessionIds.length >= 2)
    .map(([slug, sessionIds]) => ({ slug, count: sessionIds.length }))
    .sort((a, b) => b.count - a.count)

  if (persistent.length === 0) return []

  return [{
    id: `persistent-unknown-${Date.now()}`,
    type: 'persistent-unknown',
    severity: 'high',
    title: `${persistent.length} recurring unknowns across sessions`,
    description: `The developer asked about or struggled with these concepts in multiple sessions: ${persistent.slice(0, 5).map(p => `${p.slug} (${p.count} sessions)`).join(', ')}`,
    suggestedAction: 'These are genuine knowledge gaps that keep recurring. Review the related concept pages and add Human Notes with your understanding.',
    relatedConcepts: persistent.slice(0, 10).map(p => p.slug),
    detectedAt: nowISO(),
  }]
}

function detectStaleKnowledge(concepts: ConceptPage[], staleKnowledgeDays: number): Gap[] {
  const stale = concepts.filter(c => isOlderThanDays(c.metadata.lastUpdated, staleKnowledgeDays))

  if (stale.length === 0) return []

  return [{
    id: `stale-knowledge-${Date.now()}`,
    type: 'stale-knowledge',
    severity: 'low',
    title: `${stale.length} concept pages not updated in ${staleKnowledgeDays}+ days`,
    description: `Potentially stale knowledge: ${stale.map(c => c.slug).slice(0, 3).join(', ')}`,
    suggestedAction: 'Review stale concepts for accuracy. Mark as reviewed or update with current project context.',
    relatedConcepts: stale.map(c => c.slug),
    detectedAt: nowISO(),
  }]
}

function detectMissingCrossReferences(concepts: ConceptPage[]): Gap[] {
  const conceptSlugs = new Set(concepts.map(c => c.slug))
  const issues: string[] = []

  for (const page of concepts) {
    // Find mentions of other concept names in page content (not as [[links]])
    const explicitRefs = extractCrossReferences(page.content)
    const explicitSet = new Set(explicitRefs)

    for (const other of concepts) {
      if (other.slug === page.slug) continue
      if (explicitSet.has(other.slug)) continue // Already linked

      // Check if other concept's name appears in the text (without [[]] brackets)
      const namePattern = new RegExp(`\\b${escapeRegex(other.name)}\\b`, 'i')
      if (namePattern.test(page.content) && !page.content.includes(`[[${other.slug}]]`)) {
        issues.push(`${page.slug} mentions "${other.name}" without [[${other.slug}]] link`)
      }
    }
  }

  if (issues.length === 0) return []

  return [{
    id: `missing-cross-reference-${Date.now()}`,
    type: 'missing-cross-reference',
    severity: 'low',
    title: `${issues.length} missing cross-references between concepts`,
    description: `Concepts that mention each other but lack [[slug]] links: ${issues.slice(0, 3).join('; ')}`,
    suggestedAction: 'Add [[concept-slug]] cross-reference links to improve knowledge navigation and discoverability',
    detectedAt: nowISO(),
  }]
}

// ─── Summary Builder ──────────────────────────────────────────────────────────

function buildSummary(gaps: Gap[]): GapsAnalyzeResult['summary'] {
  const byType = {} as Record<GapType, number>
  const types: GapType[] = [
    'unreviewed-code', 'untouched-ai-code', 'concept-no-page', 'orphan-concept',
    'repeated-pattern', 'persistent-unknown', 'stale-knowledge', 'missing-cross-reference',
  ]
  for (const t of types) byType[t] = 0
  for (const g of gaps) byType[g.type]++

  return {
    total: gaps.length,
    high: gaps.filter(g => g.severity === 'high').length,
    medium: gaps.filter(g => g.severity === 'medium').length,
    low: gaps.filter(g => g.severity === 'low').length,
    byType,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
