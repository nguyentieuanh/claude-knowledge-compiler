import { join } from 'node:path'
import { loadConfig, resolveKnowledgeBasePath } from '../../core/config.js'
import { KnowledgeBase } from '../../core/knowledge-base.js'
import { analyzeGaps } from '../../compilers/gaps-analyzer.js'
import { fileExists } from '../../utils/fs.js'
import { out } from '../output.js'
import type { Gap } from '../../core/schema.js'

export async function runGaps(projectRoot: string): Promise<void> {
  const config = await loadConfig(projectRoot)
  const knowledgeBasePath = resolveKnowledgeBasePath(projectRoot, config)
  const kb = new KnowledgeBase(knowledgeBasePath)

  if (!(await kb.exists())) {
    out.error('Knowledge base not initialized. Run `dkc init` first.')
    return
  }

  out.header('Analyzing knowledge gaps...')

  const [delegationMap, concepts, sessions] = await Promise.all([
    kb.getDelegationMap(),
    kb.getConcepts(),
    kb.getRecentSessions(50),
  ])

  const result = analyzeGaps({
    delegationMap,
    concepts,
    sessions,
    staleKnowledgeDays: config.staleKnowledgeDays,
    projectRoot,
  })

  if (result.gaps.length === 0) {
    out.success('No knowledge gaps detected! Knowledge base is up to date.')
    return
  }

  out.info(`Found ${result.summary.total} gaps: ${result.summary.high} high, ${result.summary.medium} medium, ${result.summary.low} low`)
  out.info('')

  const highGaps = result.gaps.filter(g => g.severity === 'high')
  const medGaps = result.gaps.filter(g => g.severity === 'medium')
  const lowGaps = result.gaps.filter(g => g.severity === 'low')

  printGapGroup('High Priority', highGaps)
  printGapGroup('Medium Priority', medGaps)
  printGapGroup('Low Priority', lowGaps)

  await kb.appendLog('gaps', 'analysis', `${result.summary.total} gaps (${result.summary.high}H ${result.summary.medium}M ${result.summary.low}L)`)
}

function printGapGroup(title: string, gaps: Gap[]): void {
  if (gaps.length === 0) return
  out.info(`\n${title}:`)
  for (const gap of gaps) {
    out.warn(`  ${gap.title}`)
    out.info(`    ${gap.description}`)
    out.info(`    → ${gap.suggestedAction}`)
  }
}
