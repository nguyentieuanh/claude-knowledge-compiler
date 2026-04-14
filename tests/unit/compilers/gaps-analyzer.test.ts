import { describe, it, expect } from 'vitest'
import { analyzeGaps } from '../../../src/compilers/gaps-analyzer.js'
import type { DelegationMap, ConceptPage, SessionDebrief } from '../../../src/core/schema.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeConcept = (slug: string, daysOld: number = 0): ConceptPage => {
  const date = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString()
  return {
    slug,
    name: slug.split('-').map(w => w[0]!.toUpperCase() + w.slice(1)).join(' '),
    filePath: `/kb/concepts/${slug}.md`,
    content: `# ${slug}\n\n## What It Is (in this project)\nTest.\n\n## Human Notes\n<!-- DKC -->\n`,
    metadata: {
      name: slug,
      slug,
      firstSeen: date,
      lastUpdated: date,
      sessionCount: 1,
      relatedConcepts: [],
      relatedFiles: [],
      status: 'auto-generated',
    },
  }
}

const makeSession = (id: string, concepts: string[]): SessionDebrief => ({
  filePath: `/kb/sessions/${id}.md`,
  content: '',
  metadata: {
    sessionId: id,
    date: id.slice(0, 10),
    durationMinutes: 30,
    filesChanged: 2,
    concepts,
    status: 'auto-generated',
  },
})

const makeAIGeneratedMap = (files: string[]): DelegationMap => ({
  lastUpdated: new Date().toISOString(),
  summary: {
    totalFiles: files.length,
    aiGenerated: files.length,
    aiModified: 0,
    humanWritten: 0,
    unreviewed: files.length,
    percentageAi: 100,
  },
  entries: files.map(f => ({
    filePath: f,
    state: 'ai-generated' as const,
    confidence: 0.9,
    lastModified: new Date().toISOString(),
    sessions: ['session-1'],
    notes: '',
  })),
  trend: [],
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('analyzeGaps', () => {
  it('returns empty result when everything is clean', () => {
    const result = analyzeGaps({
      delegationMap: null,
      concepts: [],
      sessions: [],
      staleKnowledgeDays: 30,
      projectRoot: '/project',
    })

    expect(result.gaps).toHaveLength(0)
    expect(result.summary.total).toBe(0)
  })

  it('detects unreviewed AI-generated code', () => {
    const map = makeAIGeneratedMap([
      'src/auth.ts', 'src/token.ts', 'src/session.ts',
      'src/middleware.ts', 'src/config.ts', 'src/utils.ts',  // 6 files = high severity
    ])

    const result = analyzeGaps({
      delegationMap: map,
      concepts: [],
      sessions: [],
      staleKnowledgeDays: 30,
      projectRoot: '/project',
    })

    const gap = result.gaps.find(g => g.type === 'unreviewed-code')
    expect(gap).toBeDefined()
    expect(gap?.severity).toBe('high')
    expect(gap?.suggestedAction).toBeTruthy()
  })

  it('detects concepts mentioned in sessions but lacking pages', () => {
    const sessions = [
      makeSession('2026-04-08-14', ['dependency-injection', 'event-loop']),
      makeSession('2026-04-07-10', ['dependency-injection']),
    ]

    // No concept pages exist
    const result = analyzeGaps({
      delegationMap: null,
      concepts: [],
      sessions,
      staleKnowledgeDays: 30,
      projectRoot: '/project',
    })

    const gap = result.gaps.find(g => g.type === 'concept-no-page')
    expect(gap).toBeDefined()
    expect(gap?.relatedConcepts).toContain('dependency-injection')
  })

  it('detects orphan concepts not referenced recently', () => {
    // Concept last updated 60 days ago, not referenced in any session
    const staleConcept = makeConcept('old-pattern', 60)

    const result = analyzeGaps({
      delegationMap: null,
      concepts: [staleConcept],
      sessions: [],  // No sessions reference it
      staleKnowledgeDays: 30,
      projectRoot: '/project',
    })

    const gap = result.gaps.find(g => g.type === 'orphan-concept')
    expect(gap).toBeDefined()
    expect(gap?.relatedConcepts).toContain('old-pattern')
  })

  it('does not flag recently-updated concepts as orphan', () => {
    const freshConcept = makeConcept('fresh-concept', 5)  // 5 days old

    const result = analyzeGaps({
      delegationMap: null,
      concepts: [freshConcept],
      sessions: [],
      staleKnowledgeDays: 30,
      projectRoot: '/project',
    })

    const gap = result.gaps.find(g => g.type === 'orphan-concept')
    expect(gap).toBeUndefined()
  })

  it('detects persistent unknowns (concept mentioned in unknowns section of 2+ sessions)', () => {
    // detectPersistentUnknowns parses session content for "## Unknowns & Learning Gaps"
    // sections with [[slug]] or **concept** patterns — not just metadata.concepts
    const makeSessionWithUnknowns = (id: string, concepts: string[]): SessionDebrief => ({
      ...makeSession(id, concepts),
      content: `## Unknowns & Learning Gaps\n- **dependency injection** — asked about DI patterns\n  -> Related concept: [[dependency-injection]]\n\n## Delegation Summary\n`,
    })

    const sessions = [
      makeSessionWithUnknowns('2026-04-08-14', ['dependency-injection']),
      makeSessionWithUnknowns('2026-04-07-10', ['dependency-injection']),
      makeSessionWithUnknowns('2026-04-06-09', ['dependency-injection']),
    ]

    const result = analyzeGaps({
      delegationMap: null,
      concepts: [],
      sessions,
      staleKnowledgeDays: 30,
      projectRoot: '/project',
    })

    const gap = result.gaps.find(g => g.type === 'persistent-unknown')
    expect(gap).toBeDefined()
    expect(gap?.severity).toBe('high')
    expect(gap?.relatedConcepts).toContain('dependency-injection')
  })

  it('detects stale knowledge (concepts not updated in N days)', () => {
    const staleConcept = makeConcept('stale-concept', 45)  // 45 days old

    const result = analyzeGaps({
      delegationMap: null,
      concepts: [staleConcept],
      sessions: [makeSession('recent', ['stale-concept'])],  // Referenced in session
      staleKnowledgeDays: 30,
      projectRoot: '/project',
    })

    const gap = result.gaps.find(g => g.type === 'stale-knowledge')
    expect(gap).toBeDefined()
    expect(gap?.relatedConcepts).toContain('stale-concept')
  })

  it('detects missing cross-references', () => {
    const conceptA: ConceptPage = {
      ...makeConcept('concept-a'),
      content: `---\nname: Concept A\nslug: concept-a\n---\n\n# Concept A\n\n## What It Is (in this project)\nUses Dependency Injection extensively.\n\n## Human Notes\n<!-- DKC -->\n`,
    }
    const conceptDI: ConceptPage = makeConcept('dependency-injection')

    const result = analyzeGaps({
      delegationMap: null,
      concepts: [conceptA, conceptDI],
      sessions: [],
      staleKnowledgeDays: 30,
      projectRoot: '/project',
    })

    const gap = result.gaps.find(g => g.type === 'missing-cross-reference')
    expect(gap).toBeDefined()
  })

  it('produces summary with correct counts', () => {
    const map = makeAIGeneratedMap([
      'src/auth.ts', 'src/token.ts', 'src/session.ts',
      'src/middleware.ts', 'src/config.ts', 'src/utils.ts',
    ])
    const sessions = [
      makeSession('s1', ['dependency-injection']),
      makeSession('s2', ['dependency-injection']),
    ]

    const result = analyzeGaps({
      delegationMap: map,
      concepts: [],
      sessions,
      staleKnowledgeDays: 30,
      projectRoot: '/project',
    })

    expect(result.summary.total).toBe(result.gaps.length)
    expect(result.summary.high + result.summary.medium + result.summary.low).toBe(result.summary.total)
    expect(result.summary.byType).toBeDefined()
  })

  it('has suggestedAction for every gap (P3)', () => {
    const map = makeAIGeneratedMap(['src/auth.ts', 'src/token.ts', 'src/session.ts', 'src/mid.ts', 'src/cfg.ts', 'src/u.ts'])
    const sessions = [
      makeSession('s1', ['unknown-concept']),
      makeSession('s2', ['unknown-concept']),
    ]
    const staleConcept = makeConcept('stale', 45)

    const result = analyzeGaps({
      delegationMap: map,
      concepts: [staleConcept],
      sessions,
      staleKnowledgeDays: 30,
      projectRoot: '/project',
    })

    for (const gap of result.gaps) {
      expect(gap.suggestedAction).toBeTruthy()
      expect(gap.suggestedAction.length).toBeGreaterThan(10)
    }
  })
})
