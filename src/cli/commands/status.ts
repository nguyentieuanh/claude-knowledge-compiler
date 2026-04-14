import { resolve, join } from 'node:path'
import { KnowledgeBase } from '../../core/knowledge-base.js'
import { loadConfig } from '../../core/config.js'
import { out } from '../output.js'
import chalk from 'chalk'

export async function runStatus(projectRoot = process.cwd()): Promise<void> {
  const root = resolve(projectRoot)
  const config = await loadConfig(root)
  const kbPath = join(root, config.knowledgeBasePath)
  const kb = new KnowledgeBase(kbPath)

  if (!(await kb.exists())) {
    out.warn('No knowledge base found. Run `dkc init` to initialize.')
    return
  }

  const stats = await kb.getStats()

  out.header('DKC Knowledge Base Status')
  console.log(`  Sessions:     ${chalk.bold(stats.sessionCount)}`)
  console.log(`  Concepts:     ${chalk.bold(stats.conceptCount)}`)
  console.log(`  Gaps:         ${chalk.bold(stats.gapCount)}`)
  console.log(`  Last compile: ${chalk.bold(stats.lastCompiled ?? 'never')}`)
  out.blank()

  const { delegationSummary: d } = stats
  if (d.totalFiles > 0) {
    console.log(`  Files tracked: ${d.totalFiles}`)
    console.log(`  AI-generated:  ${d.aiGenerated} (${d.percentageAi}%)`)
    console.log(`  Unreviewed:    ${d.unreviewed}`)
  }
}
