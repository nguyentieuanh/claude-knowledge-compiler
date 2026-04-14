import { Command } from 'commander'
import { runInit } from './commands/init.js'
import { runStatus } from './commands/status.js'
import { runReflect } from './commands/reflect.js'
import { runGaps } from './commands/gaps.js'
import { out } from './output.js'

const program = new Command()

program
  .name('dkc')
  .description('Developer Knowledge Compiler — compile knowledge across coding sessions')
  .version('0.1.0')

// ── dkc init ──────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize a knowledge base in the current project')
  .option('--no-git-hook', 'Skip installing the post-commit git hook')
  .option('--gitignore', 'Add .knowledge/ to .gitignore')
  .option('--no-claude-md', 'Skip updating CLAUDE.md')
  .option('--kb-path <path>', 'Knowledge base path (default: .knowledge)')
  .option('--project-root <path>', 'Project root (default: current directory)')
  .option('--lang <lang>', 'Output language: en (English) or vi (Vietnamese) (default: en)')
  .action(async (opts: {
    gitHook: boolean
    gitignore: boolean
    claudeMd: boolean
    kbPath?: string
    projectRoot?: string
    lang?: string
  }) => {
    try {
      const language = opts.lang === 'vi' ? 'vi' : 'en'
      await runInit({
        projectRoot: opts.projectRoot ?? process.cwd(),
        gitHook: opts.gitHook,
        gitignore: opts.gitignore,
        skipClaudeMd: !opts.claudeMd,
        language,
        ...(opts.kbPath !== undefined && { knowledgeBasePath: opts.kbPath }),
      })
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

// ── dkc status ────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show knowledge base health overview')
  .option('--project-root <path>', 'Project root (default: current directory)')
  .action(async (opts: { projectRoot?: string }) => {
    try {
      await runStatus(opts.projectRoot ?? process.cwd())
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

// ── dkc reflect ───────────────────────────────────────────────────────────────

program
  .command('reflect')
  .description('Compile knowledge from the most recent coding session')
  .option('--session-id <id>', 'Session ID (default: latest)')
  .option('--transcript <path>', 'Path to session transcript .jsonl')
  .option('--from-pending', 'Read from CLAUDE_PLUGIN_DATA/pending-compile.json (used by hooks)')
  .option('--quiet', 'Suppress output (used by hooks)')
  .option('--force', 'Recompile even if session was already compiled')
  .option('--project-root <path>', 'Project root (default: current directory)')
  .action(async (opts: {
    sessionId?: string
    transcript?: string
    fromPending?: boolean
    quiet?: boolean
    force?: boolean
    projectRoot?: string
  }) => {
    try {
      const result = await runReflect({
        projectRoot: opts.projectRoot ?? process.cwd(),
        ...(opts.sessionId !== undefined && { sessionId: opts.sessionId }),
        ...(opts.transcript !== undefined && { transcriptPath: opts.transcript }),
        ...(opts.fromPending !== undefined && { fromPending: opts.fromPending }),
        ...(opts.quiet !== undefined && { quiet: opts.quiet }),
        ...(opts.force !== undefined && { force: opts.force }),
      })
      if (!result.success && !opts.quiet) {
        out.error(result.error ?? 'Unknown error')
        process.exit(1)
      }
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

// ── dkc gaps ──────────────────────────────────────────────────────────────────

program
  .command('gaps')
  .description('Show knowledge gaps and blind spots in your codebase understanding')
  .option('--project-root <path>', 'Project root (default: current directory)')
  .action(async (opts: { projectRoot?: string }) => {
    try {
      await runGaps(opts.projectRoot ?? process.cwd())
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program.parse()
