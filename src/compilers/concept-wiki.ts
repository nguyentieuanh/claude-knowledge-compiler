import { getLLMClient } from './llm-client.js'
import { slugify, normalizeForMatch } from '../utils/slug.js'
import { nowISO, isoToDate } from '../utils/date.js'
import { preserveHumanNotes, extractCrossReferences } from '../utils/markdown.js'
import type {
  ConversationParsed,
  GitDiffParsed,
  ConceptPage,
  ConceptPageMetadata,
  CompileOptions,
  ConfusionSignal,
  DKCLanguage,
} from '../core/schema.js'

// ─── Concept Wiki Compiler ────────────────────────────────────────────────────
// Step 4: Extract concept mentions from session → create/update concept pages.
// Key constraints:
//   - Max maxConceptsPerSession new concepts (default 5)
//   - P4: NEVER overwrite "Human Notes" section
//   - Backlink weaving: when concept A mentions concept B, add backlink in B

export interface ConceptCompileResult {
  created: ConceptPage[]
  updated: ConceptPage[]
}

export interface BugLesson {
  concept: string
  bug: string
  fix: string
  lesson: string
}

export interface ConceptCompileInput {
  conversation: ConversationParsed
  gitDiff: GitDiffParsed
  existingConcepts: ConceptPage[]
  options: CompileOptions
  projectName?: string
  sessionId: string
  bugsAndLessons?: BugLesson[]
}

// ─── Extracted concept (before matching against existing) ─────────────────────

interface ExtractedConcept {
  name: string
  slug: string
  evidence: ConfusionSignal[]         // From conversation signals
  relatedFiles: string[]              // Files that used this concept
  description: string                 // Brief description (for new pages)
}

// ─── Main Compiler ────────────────────────────────────────────────────────────

export async function compileConceptWiki(input: ConceptCompileInput): Promise<ConceptCompileResult> {
  const { conversation, gitDiff, existingConcepts, options, sessionId, bugsAndLessons = [] } = input
  const maxNew = options.config.maxConceptsPerSession

  // 1. Extract candidate concepts from session
  const candidates = extractCandidateConcepts(conversation, gitDiff)

  if (candidates.length === 0) {
    return { created: [], updated: [] }
  }

  // 2. Match candidates against existing concepts (fuzzy)
  const { toCreate, toUpdate } = matchCandidates(candidates, existingConcepts, maxNew)

  // 3. Build concept content (LLM or deterministic)
  const llm = getLLMClient()

  const created: ConceptPage[] = []
  const updated: ConceptPage[] = []

  const language: DKCLanguage = options.config.language ?? 'en'

  for (const candidate of toCreate) {
    let description = candidate.description
    if (llm) {
      description = await enhanceConceptDescription(candidate, conversation, options, llm, language)
    }
    const page = buildNewConceptPage(candidate, description, sessionId, options, existingConcepts, bugsAndLessons)
    created.push(page)
  }

  for (const { candidate, existing } of toUpdate) {
    // Enhance stale descriptions via LLM (descriptions that are just boilerplate)
    const isBoilerplate = isBoilerplateDescription(existing.content)
    if (llm && isBoilerplate) {
      const enhanced = await enhanceConceptDescription(candidate, conversation, options, llm, language)
      candidate.description = enhanced
    }
    const page = updateConceptPage(existing, candidate, sessionId, options, existingConcepts, llm !== null && isBoilerplate, bugsAndLessons)
    updated.push(page)
  }

  // 4. Weave backlinks between newly created/updated pages
  const allChanged = [...created, ...updated]
  weaveBacklinks(allChanged, existingConcepts)

  // 5. Deduplicate Related Concepts sections (backlinks may have added entries
  //    that applyRelatedConceptsToContent already included)
  for (const page of allChanged) {
    page.content = deduplicateRelatedSection(page.content)
  }

  return { created, updated }
}

// ─── Concept Extraction ────────────────────────────────────────────────────────

function extractCandidateConcepts(
  conversation: ConversationParsed,
  gitDiff: GitDiffParsed,
): ExtractedConcept[] {
  const candidates = new Map<string, ExtractedConcept>()

  // Source 1: Confusion signals (explicit questions + long explanations)
  for (const signal of conversation.confusionSignals) {
    if (signal.concept) {
      const slug = slugify(signal.concept)
      if (!slug) continue

      const existing = candidates.get(slug)
      if (existing) {
        existing.evidence.push(signal)
      } else {
        candidates.set(slug, {
          name: signal.concept,
          slug,
          evidence: [signal],
          relatedFiles: [],
          description: extractDescriptionFromSignal(signal, conversation),
        })
      }
    }
  }

  // Source 2: User messages mentioning known patterns/concepts
  const conceptPatterns = [
    /\b(dependency injection|DI pattern|service locator|event loop|middleware|context provider|react hook|promise|async.await|design pattern|factory pattern|singleton|observer pattern)\b/gi,
    /\b(\w+\s+(?:pattern|middleware|injection|resolver|provider|hook|context|factory))\b/gi,
  ]

  for (const msg of conversation.userMessages) {
    for (const pattern of conceptPatterns) {
      let match: RegExpExecArray | null
      pattern.lastIndex = 0
      while ((match = pattern.exec(msg.text)) !== null) {
        const name = match[1]?.trim()
        if (!name || name.length < 4) continue
        const slug = slugify(name)
        if (!slug) continue

        if (!candidates.has(slug)) {
          candidates.set(slug, {
            name: name.toLowerCase(),
            slug,
            evidence: [],
            relatedFiles: [],
            description: `${name} mentioned during session.`,
          })
        }
      }
    }
  }

  // Source 3: Files modified — associate with mentioned concepts
  for (const [, candidate] of candidates) {
    for (const file of conversation.filesModified) {
      if (conceptAppliesToFile(candidate.name, file)) {
        candidate.relatedFiles.push(file)
      }
    }
    for (const f of gitDiff.files) {
      if (conceptAppliesToFile(candidate.name, f.path) && !candidate.relatedFiles.includes(f.path)) {
        candidate.relatedFiles.push(f.path)
      }
    }
  }

  // Source 4: Infer concepts from file paths (e.g. src/compilers/concept-wiki.ts → "concept-wiki")
  // This fires when signals are sparse (e.g. Vietnamese sessions, pure coding with no questions).
  // Only process relativized paths (files inside the project).
  const allFiles = [...new Set([...conversation.filesModified, ...gitDiff.files.map(f => f.path)])]
  const projectFiles = allFiles.filter(fp => !fp.startsWith('/'))  // skip outside-project files
  // Sort by directory priority: compilers/collectors first (richest concepts),
  // then hooks/core, then cli, then everything else.
  const dirPriority = (fp: string): number => {
    if (fp.startsWith('src/compilers/') || fp.startsWith('src/collectors/')) return 0
    if (fp.startsWith('src/core/') || fp.startsWith('src/hooks/')) return 1
    if (fp.startsWith('src/')) return 2
    if (fp.includes('/')) return 3
    return 4
  }
  projectFiles.sort((a, b) => dirPriority(a) - dirPriority(b))
  for (const fp of projectFiles) {
    const inferred = inferConceptFromFilePath(fp)
    if (!inferred) continue
    const slug = slugify(inferred)
    if (!slug || candidates.has(slug)) continue
    candidates.set(slug, {
      name: inferred,
      slug,
      evidence: [],
      relatedFiles: [fp],
      description: buildDeterministicDescription(inferred, fp),
    })
  }

  return [...candidates.values()].filter(c => {
    // Must have some signal (evidence or file anchor)
    if (c.evidence.length === 0 && c.relatedFiles.length === 0) return false

    // Relevance boundary: concept name must be a short technical term.
    // Reject full sentences (e.g. pasted terminal output, user instructions).
    // Rule: ≤5 words OR must have a project file anchor.
    const nameWords = c.name.trim().split(/\s+/).length
    const hasFileAnchor = c.relatedFiles.length > 0
    if (nameWords > 5 && !hasFileAnchor) return false

    // Reject camelCase/PascalCase function names without file anchors
    // (e.g. "applyRelatedConceptsToContent" from conversation)
    if (!hasFileAnchor && /^[a-z]+[A-Z]/.test(c.name.trim())) return false

    return true
  })
}

function extractDescriptionFromSignal(signal: ConfusionSignal, conv: ConversationParsed): string {
  // If there's a long explanation for this concept, use a condensed version
  const longExp = conv.confusionSignals.find(
    s => s.type === 'long-explanation-needed' && s.concept === signal.concept
  )
  if (longExp) {
    return longExp.text.slice(0, 300) + (longExp.text.length > 300 ? '...' : '')
  }
  return signal.text.slice(0, 200)
}

function conceptAppliesToFile(conceptName: string, filePath: string): boolean {
  const normalizedConcept = normalizeForMatch(conceptName)
  const normalizedFile = filePath.toLowerCase().replace(/[/\\.]/g, '-')
  return normalizedFile.includes(normalizedConcept.slice(0, 8))
}

/** Generate a meaningful description without LLM, based on directory conventions. */
function buildDeterministicDescription(name: string, filePath: string): string {
  const dir = filePath.split('/').at(-2) ?? ''
  const descriptions: Record<string, string> = {
    compilers: `${name} — part of DKC's compile pipeline. Processes session data to extract and persist developer knowledge into the .knowledge/ directory.`,
    collectors: `${name} — data collector in DKC's pipeline. Reads and parses raw source data (transcripts, git diffs) before the compile step.`,
    hooks: `${name} — Claude Code plugin hook. Responds to Claude Code lifecycle events (SessionEnd, PostToolUse, etc.) to trigger DKC's auto-compile flow.`,
    core: `${name} — core module of DKC. Defines central data structures, shared configuration, or knowledge base I/O logic.`,
    analyzers: `${name} — knowledge analyzer in DKC. Scans the knowledge base to surface gaps, stale pages, or patterns that need attention.`,
    utils: `${name} — utility module providing shared helpers used across the DKC compile pipeline.`,
    cli: `${name} — CLI command handler. Implements the user-facing \`dkc\` command interface.`,
  }
  return descriptions[dir] ?? `${name} — module in the DKC toolkit (\`${filePath}\`).`
}

function inferConceptFromFilePath(filePath: string): string | null {
  // Extract meaningful concept name from file basename (without ALL extensions)
  // e.g. "src/compilers/concept-wiki.ts" → "Concept Wiki"
  //      "src/templates/index.md.tpl" → skip (template file)
  //      "src/utils/date.ts" → skip (utility)
  const parts = filePath.split('/')
  const fullname = parts.at(-1) ?? ''
  const dir = parts.at(-2) ?? ''
  const parentDirs = parts.slice(0, -1).join('/')

  // Remove ALL extensions: "index.md.tpl" → "index", "concept-wiki.ts" → "concept-wiki"
  const basename = fullname.replace(/(\.[^.]+)+$/, '')

  // Skip test fixtures, templates, utils, CLI-level files
  const skipDirs = new Set(['utils', 'fixtures', 'templates', 'cli', '__tests__'])
  if (skipDirs.has(dir)) return null
  if (filePath.includes('/tests/') || filePath.includes('.test.')) return null
  if (basename.startsWith('.') || basename.startsWith('_')) return null
  if (basename.length < 4) return null

  // Skip generic basenames
  const skipNames = new Set(['index', 'package', 'tsconfig', 'tsup', 'vitest', 'eslint',
    'gitignore', 'prettierrc', 'KNOWLEDGE', 'AGENTS', 'README', 'log', 'gaps', 'map',
    'modules', 'hooks', 'schema', 'config', 'types', 'helpers', 'constants', 'template',
    'output', 'input', 'data', 'base', 'core', 'main', 'app', 'date', 'slug', 'fs',
    'init', 'status', 'reflect', 'markdown', 'workflow', 'integration'])
  if (skipNames.has(basename) || skipNames.has(basename.toUpperCase())) return null

  // Prefer src/compilers, src/collectors, src/hooks — skip src/utils already handled above
  // Also skip if it's a markdown or config file in root
  if (!parentDirs.includes('/') && (fullname.endsWith('.md') || fullname.endsWith('.json'))) return null

  // Convert kebab/snake to title: "concept-wiki" → "Concept Wiki"
  const name = basename
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())

  return name
}

// ─── Matching ─────────────────────────────────────────────────────────────────

function matchCandidates(
  candidates: ExtractedConcept[],
  existing: ConceptPage[],
  maxNew: number,
): {
  toCreate: ExtractedConcept[]
  toUpdate: Array<{ candidate: ExtractedConcept; existing: ConceptPage }>
} {
  const toCreate: ExtractedConcept[] = []
  const toUpdate: Array<{ candidate: ExtractedConcept; existing: ConceptPage }> = []

  for (const candidate of candidates) {
    const match = findExistingConcept(candidate, existing)
    if (match) {
      toUpdate.push({ candidate, existing: match })
    } else {
      toCreate.push(candidate)
    }
  }

  // Respect max new concepts per session
  const trimmedCreate = toCreate.slice(0, maxNew)

  return { toCreate: trimmedCreate, toUpdate }
}

function findExistingConcept(candidate: ExtractedConcept, existing: ConceptPage[]): ConceptPage | null {
  const normalizedSlug = normalizeForMatch(candidate.slug)
  const normalizedName = normalizeForMatch(candidate.name)

  for (const page of existing) {
    if (normalizeForMatch(page.slug) === normalizedSlug) return page
    if (normalizeForMatch(page.name) === normalizedName) return page
    if (normalizeForMatch(page.slug) === normalizedName) return page
    if (normalizeForMatch(page.name) === normalizedSlug) return page
  }
  return null
}

// ─── LLM Enhancement ─────────────────────────────────────────────────────────

const CONCEPT_PROMPT: Record<DKCLanguage, (name: string, project: string, context: string, files: string) => string> = {
  en: (name, project, context, files) =>
    `In 2-3 sentences, describe the concept "${name}" specifically as it is used in ${project}. Be project-specific, not generic.\n\nContext from session:\n${context}\n\nFiles where it appears: ${files}\n\nIMPORTANT: Reply with ONLY the description text (2-3 sentences). No preamble, no reasoning, no XML tags, no markdown. Just the plain text description.`,
  vi: (name, project, context, files) =>
    `Trong 2-3 câu, mô tả khái niệm "${name}" cụ thể theo cách nó được sử dụng trong dự án ${project}. Viết đặc thù cho dự án này, không phải định nghĩa chung chung.\n\nContext từ session:\n${context}\n\nCác file liên quan: ${files}\n\nQUAN TRỌNG: Chỉ trả về phần mô tả (2-3 câu). Không có phần mở đầu, không reasoning, không XML tags, không markdown. Chỉ text thuần.`,
}

async function enhanceConceptDescription(
  candidate: ExtractedConcept,
  conv: ConversationParsed,
  options: CompileOptions,
  llm: import('./llm-client.js').LLMClient,
  language: DKCLanguage = 'en',
): Promise<string> {
  const projectName = options.projectRoot.split('/').at(-1) ?? 'this project'

  const longExp = conv.confusionSignals.find(
    s => s.type === 'long-explanation-needed' && s.concept === candidate.name
  )
  const context = (longExp?.text ?? candidate.evidence.map(e => e.text).join(' ')).slice(0, 500)
  const files = candidate.relatedFiles.join(', ') || 'none'

  const buildPrompt = CONCEPT_PROMPT[language] ?? CONCEPT_PROMPT['en']
  const prompt = buildPrompt(candidate.name, projectName, context, files)

  try {
    const { TOKEN_BUDGETS } = await import('./llm-client.js')
    const result = await llm.complete(prompt, TOKEN_BUDGETS.conceptEnhance)
    // If LLM returned empty (e.g. all content was in thinking tags), fall back
    return result.length > 10 ? result : candidate.description
  } catch {
    return candidate.description
  }
}

// ─── Page Builders ────────────────────────────────────────────────────────────

function buildNewConceptPage(
  candidate: ExtractedConcept,
  description: string,
  sessionId: string,
  options: CompileOptions,
  allExistingConcepts: ConceptPage[] = [],
  bugsAndLessons: BugLesson[] = [],
): ConceptPage {
  const now = nowISO()
  const slug = candidate.slug
  const name = toTitleCase(candidate.name)
  const filePath = `${options.knowledgeBasePath}/concepts/${slug}.md`

  const whereUsed = candidate.relatedFiles.length > 0
    ? candidate.relatedFiles.map(f => `- \`${f}\` — see session ${sessionId}`).join('\n')
    : '_Not yet tracked in specific files._'

  const historyRow = `| ${isoToDate(now)} | ${sessionId} | First seen — ${description.replace(/\n/g, ' ').replace(/\|/g, '—')} |`

  const relatedSlugs = findRelatedConcepts(
    { slug, name, relatedFiles: candidate.relatedFiles, description },
    allExistingConcepts,
  )
  const relatedConceptsSection = buildRelatedConceptsSection(relatedSlugs, allExistingConcepts)
  const relatedSlugsJson = relatedSlugs.map(s => `"${s}"`).join(', ')

  const matchingBugs = findBugsForConcept(slug, name, bugsAndLessons)
  const bugsSection = matchingBugs.length > 0
    ? matchingBugs.map(b => `- **${isoToDate(now)}**: ${b.bug} → Fix: ${b.fix} → Lesson: ${b.lesson}`).join('\n')
    : '_No bugs or lessons recorded yet._'

  const content = `---
name: ${name}
slug: ${slug}
first_seen: "${isoToDate(now)}"
last_updated: "${isoToDate(now)}"
session_count: 1
status: auto-generated
related_concepts: [${relatedSlugsJson}]
related_files: [${candidate.relatedFiles.map(f => `"${f}"`).join(', ')}]
---

# ${name}

## What It Is (in this project)
${description}

## Where It's Used
${whereUsed}

## History
| Date | Session | What happened |
|------|---------|---------------|
${historyRow}

## Bugs & Lessons
${bugsSection}

## Related Concepts
${relatedConceptsSection}

## Human Notes
<!-- DKC compiler will NEVER modify this section. -->
<!-- Add your own notes, links to docs, insights from external sources here. -->
`

  const metadata: ConceptPageMetadata = {
    name,
    slug,
    firstSeen: now,
    lastUpdated: now,
    sessionCount: 1,
    relatedConcepts: relatedSlugs,
    relatedFiles: candidate.relatedFiles,
    status: 'auto-generated',
  }

  return { slug, name, filePath, content, metadata }
}

/** Check if a concept page still has a boilerplate description (not LLM-enhanced) */
function isBoilerplateDescription(content: string): boolean {
  const whatItIsMatch = /## What It Is \(in this project\)\n([\s\S]*?)(?=\n## )/.exec(content)
  if (!whatItIsMatch) return true
  const desc = whatItIsMatch[1]?.trim() ?? ''
  return desc.includes('— inferred from file')
    || desc.includes('— part of DKC')
    || desc.includes('— data collector in DKC')
    || desc.includes('— Claude Code plugin hook')
    || desc.includes('— core module of DKC')
    || desc.includes('— knowledge analyzer in DKC')
    || desc.includes('— utility module providing')
    || desc.includes('— CLI command handler')
    || desc.includes('— module in the DKC toolkit')
    || desc.length < 30
}

function updateConceptPage(
  existing: ConceptPage,
  candidate: ExtractedConcept,
  sessionId: string,
  options: CompileOptions,
  allExistingConcepts: ConceptPage[] = [],
  hasLLMDescription = false,
  bugsAndLessons: BugLesson[] = [],
): ConceptPage {
  const now = nowISO()
  const newSessionCount = existing.metadata.sessionCount + 1

  // Build new history row — use LLM-enhanced description if available, not deterministic boilerplate
  const historyDesc = candidate.description.replace(/\n/g, ' ').replace(/\|/g, '—')
  const newRow = `| ${isoToDate(now)} | ${sessionId} | Revisited — ${historyDesc} |`

  // Update history section: append new row to existing table
  let updatedContent = existing.content

  // Update frontmatter fields
  updatedContent = updatedContent
    .replace(/^last_updated: .+$/m, `last_updated: "${isoToDate(now)}"`)
    .replace(/^session_count: \d+$/m, `session_count: ${newSessionCount}`)

  // Replace boilerplate "What It Is" with LLM-enhanced description
  if (hasLLMDescription && candidate.description && !candidate.description.includes('— inferred from file')) {
    const whatItIsPattern = /(## What It Is \(in this project\)\n)([\s\S]*?)(?=\n## )/m
    const whatMatch = whatItIsPattern.exec(updatedContent)
    if (whatMatch) {
      updatedContent = updatedContent.replace(
        whatItIsPattern,
        `${whatMatch[1]}${candidate.description}\n`
      )
    }
  }

  // Append to history table (rows between header separator and next ## section)
  const historyPattern = /(## History\n\|[^\n]+\|\n\|-+\|-+\|-+\|\n)((?:\|[^\n]*\|\n)*)/m
  const historyMatch = historyPattern.exec(updatedContent)
  if (historyMatch) {
    const existingRows = historyMatch[2] ?? ''
    updatedContent = updatedContent.replace(
      historyPattern,
      `${historyMatch[1]}${existingRows}${newRow}\n`
    )
  }

  // Add new related files (deduped)
  const newFiles = candidate.relatedFiles.filter(f => !existing.metadata.relatedFiles.includes(f))
  if (newFiles.length > 0) {
    const allFiles = [...existing.metadata.relatedFiles, ...newFiles]
    const filesStr = allFiles.map(f => `"${f}"`).join(', ')
    updatedContent = updatedContent.replace(
      /^related_files: \[.*\]$/m,
      `related_files: [${filesStr}]`
    )

    // Append to Where It's Used section
    const whereUsedPattern = /(## Where It's Used\n)([\s\S]*?)(?=\n## |\s*$)/m
    const whereMatch = whereUsedPattern.exec(updatedContent)
    if (whereMatch) {
      const existingWhere = whereMatch[2]?.trim() ?? ''
      const newLines = newFiles.map(f => `- \`${f}\` — see session ${sessionId}`).join('\n')
      const notTracked = '_Not yet tracked in specific files._'
      const updatedWhere = existingWhere === notTracked
        ? newLines
        : `${existingWhere}\n${newLines}`
      updatedContent = updatedContent.replace(
        whereUsedPattern,
        `${whereMatch[1]}${updatedWhere}\n`
      )
    }
  }

  // Append bugs & lessons for this concept
  const matchingBugs = findBugsForConcept(existing.slug, existing.name, bugsAndLessons)
  if (matchingBugs.length > 0) {
    const bugsPattern = /(## Bugs & Lessons\n)([\s\S]*?)(?=\n## )/m
    const bugsMatch = bugsPattern.exec(updatedContent)
    if (bugsMatch) {
      const existingBugs = bugsMatch[2]?.trim() ?? ''
      const noBugs = '_No bugs or lessons recorded yet._'
      const newBugLines = matchingBugs
        .map(b => `- **${isoToDate(now)}**: ${b.bug} → Fix: ${b.fix} → Lesson: ${b.lesson}`)
        .join('\n')
      const updatedBugs = existingBugs === noBugs ? newBugLines : `${existingBugs}\n${newBugLines}`
      updatedContent = updatedContent.replace(bugsPattern, `${bugsMatch[1]}${updatedBugs}\n`)
    }
  }

  // P4: Preserve Human Notes
  updatedContent = preserveHumanNotes(existing.content, updatedContent)

  // Proactively find new related concepts based on shared files and name mentions
  const allFiles = [...existing.metadata.relatedFiles, ...newFiles]
  const newRelated = findRelatedConcepts(
    { slug: existing.slug, name: existing.name, relatedFiles: allFiles, description: candidate.description },
    allExistingConcepts,
  )
  const mergedRelated = [...new Set([...existing.metadata.relatedConcepts, ...newRelated])]
  // Always rebuild related section to avoid duplicates from prior runs
  updatedContent = applyRelatedConceptsToContent(updatedContent, mergedRelated, allExistingConcepts)

  const updatedMetadata: ConceptPageMetadata = {
    ...existing.metadata,
    lastUpdated: now,
    sessionCount: newSessionCount,
    relatedFiles: allFiles,
    relatedConcepts: mergedRelated,
  }

  return {
    ...existing,
    content: updatedContent,
    metadata: updatedMetadata,
  }
}

// ─── Related Concepts Finding ────────────────────────────────────────────────
// Proactively find related concepts without requiring [[slug]] links to exist first.
// Two concepts are related if they share files or one mentions the other by name.

function findRelatedConcepts(
  candidate: { slug: string; name: string; relatedFiles: string[]; description: string },
  allConcepts: ConceptPage[],
): string[] {
  const related = new Set<string>()
  const candidateFiles = new Set(candidate.relatedFiles)
  const descLower = candidate.description.toLowerCase()

  // Extract directories from candidate's files (e.g. "src/compilers")
  const candidateDirs = new Set(
    candidate.relatedFiles.map(f => f.split('/').slice(0, -1).join('/'))
      .filter(d => d.length > 0)
  )

  for (const page of allConcepts) {
    if (page.slug === candidate.slug) continue

    // Shared files → related
    const sharedFile = page.metadata.relatedFiles.some(f => candidateFiles.has(f))
    if (sharedFile) {
      related.add(page.slug)
      continue
    }

    // Same directory → related (e.g. all src/compilers/* concepts are related)
    const pageDirs = page.metadata.relatedFiles.map(f => f.split('/').slice(0, -1).join('/'))
    const sameDir = pageDirs.some(d => candidateDirs.has(d))
    if (sameDir) {
      related.add(page.slug)
      continue
    }

    // Name mention in description (either direction)
    const pageNameLower = page.name.toLowerCase()
    const pageSlugLower = page.slug.toLowerCase()
    if (descLower.includes(pageNameLower) || descLower.includes(pageSlugLower)) {
      related.add(page.slug)
      continue
    }

    // Reverse check: page's description mentions this candidate
    const pageDescMatch = /## What It Is \(in this project\)\n([\s\S]*?)(?=\n## )/.exec(page.content)
    const pageDesc = pageDescMatch?.[1]?.toLowerCase() ?? ''
    const candidateNameLower = candidate.name.toLowerCase()
    const candidateSlugLower = candidate.slug.toLowerCase()
    if (pageDesc.includes(candidateNameLower) || pageDesc.includes(candidateSlugLower)) {
      related.add(page.slug)
    }
  }

  return [...related].slice(0, 8)
}

function buildRelatedConceptsSection(slugs: string[], allConcepts: ConceptPage[]): string {
  if (slugs.length === 0) return '_No related concepts identified yet._'

  return slugs.map(slug => {
    const page = allConcepts.find(p => p.slug === slug)
    const name = page?.name ?? slug
    return `- [[${slug}]] — ${name}`
  }).join('\n')
}

function applyRelatedConceptsToContent(content: string, relatedSlugs: string[], allConcepts: ConceptPage[]): string {
  if (relatedSlugs.length === 0) return content

  // Update frontmatter related_concepts field
  const slugsJson = relatedSlugs.map(s => `"${s}"`).join(', ')
  let updated = content.replace(
    /^related_concepts: \[.*\]$/m,
    `related_concepts: [${slugsJson}]`
  )

  // Build the full related concepts section from all slugs (complete rebuild)
  const relatedSection = buildRelatedConceptsSection(relatedSlugs, allConcepts)
  const relatedPattern = /(## Related Concepts\n)([\s\S]*?)(\n## Human Notes)/m
  const match = relatedPattern.exec(updated)
  if (match) {
    const existing = match[2]?.trim() ?? ''
    const noRelated = '_No related concepts identified yet._'
    // Only replace if currently empty/default or all entries are auto-generated [[slug]] links
    const isAutoGenerated = existing === noRelated || existing === '' ||
      existing.split('\n').every(line => line.trim() === '' || /^- \[\[[\w-]+\]\]/.test(line.trim()))
    if (isAutoGenerated) {
      // Full rebuild — replace entire section with the definitive list
      updated = updated.replace(relatedPattern, `${match[1]}${relatedSection}\n${match[3]}`)
    }
  }

  return updated
}

// ─── Backlink Weaving ─────────────────────────────────────────────────────────

function weaveBacklinks(changedPages: ConceptPage[], allExisting: ConceptPage[]): void {
  // For each changed page, check if it mentions other concepts via [[slug]]
  // If so, ensure the mentioned concept lists this one in Related Concepts.
  // Also check the reverse: add [[slug]] link to pages that mention this concept's name.

  const allPages = [...allExisting, ...changedPages]

  for (const page of changedPages) {
    const refs = extractCrossReferences(page.content)

    for (const ref of refs) {
      const target = allPages.find(p => p.slug === ref)
      if (!target) continue

      // Prefer to update a page in changedPages so it gets written to disk
      const targetInChanged = changedPages.find(p => p.slug === ref)
      const targetPage = targetInChanged ?? target

      // Add backlink if not already present
      if (!targetPage.metadata.relatedConcepts.includes(page.slug)) {
        targetPage.metadata.relatedConcepts.push(page.slug)

        // Only mutate content if the page is in changedPages (will be written)
        if (targetInChanged) {
          const newLink = `- [[${page.slug}]] — ${page.name}`
          const relatedPattern = /(## Related Concepts\n)([\s\S]*?)(\n## Human Notes)/m
          const match = relatedPattern.exec(targetInChanged.content)
          if (match) {
            const existing = match[2]?.trim() ?? ''
            const noRelated = '_No related concepts identified yet._'
            // Check if this link is already in the section (avoid duplicates)
            if (existing.includes(`[[${page.slug}]]`)) continue
            const updated = existing === noRelated ? newLink : `${existing}\n${newLink}`
            targetInChanged.content = targetInChanged.content.replace(
              relatedPattern,
              `${match[1]}${updated}\n${match[3]}`
            )
          }
        }
      }
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Match bugs/lessons from session debrief to a concept by slug or name.
 *  Uses fuzzy matching: exact slug/name match, substring match, and
 *  first-word match (e.g. "llm-provider-selection" → "llm-client" via shared "llm" prefix) */
function findBugsForConcept(slug: string, name: string, bugs: BugLesson[]): BugLesson[] {
  const slugLower = slug.toLowerCase()
  const nameLower = name.toLowerCase()
  // Extract significant words from the concept name for partial matching
  const slugWords = slugLower.split('-').filter(w => w.length > 2)

  return bugs.filter(b => {
    const conceptLower = b.concept.toLowerCase()
    // Exact or substring match
    if (conceptLower === slugLower || conceptLower === nameLower) return true
    if (slugLower.includes(conceptLower) || conceptLower.includes(slugLower)) return true
    if (nameLower.includes(conceptLower) || conceptLower.includes(nameLower)) return true
    // Word overlap: if ≥50% of slug words appear in the bug concept (or vice versa)
    const bugWords = conceptLower.split('-').filter(w => w.length > 2)
    const overlap = slugWords.filter(w => bugWords.includes(w)).length
    if (overlap > 0 && (overlap >= slugWords.length * 0.5 || overlap >= bugWords.length * 0.5)) return true
    return false
  })
}

/** Remove duplicate [[slug]] entries in Related Concepts section */
function deduplicateRelatedSection(content: string): string {
  // Use greedy match up to ## Human Notes (which always follows)
  const relatedPattern = /(## Related Concepts\n)([\s\S]*?)(\n## Human Notes)/m
  const match = relatedPattern.exec(content)
  if (!match) return content

  const section = match[2] ?? ''
  const lines = section.split('\n').filter(l => l.trim().length > 0)
  const seen = new Set<string>()
  const deduped: string[] = []

  for (const line of lines) {
    const slugMatch = /\[\[([^\]]+)\]\]/.exec(line)
    if (slugMatch) {
      const slug = slugMatch[1]!
      if (seen.has(slug)) continue
      seen.add(slug)
    }
    deduped.push(line)
  }

  return content.replace(relatedPattern, `${match[1]}${deduped.join('\n')}\n${match[3]}`)
}

function toTitleCase(str: string): string {
  return str
    .split(/[\s-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}
