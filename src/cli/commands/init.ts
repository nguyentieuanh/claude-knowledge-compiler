import { join, resolve, basename } from 'node:path'
import { readFile, writeFile, chmod, access } from 'node:fs/promises'
import { KnowledgeBase } from '../../core/knowledge-base.js'
import { writeConfig, DEFAULT_CONFIG } from '../../core/config.js'
import { fileExists, dirExists, readTextFile, writeTextFile, ensureDir } from '../../utils/fs.js'
import { nowISO, isoToDate } from '../../utils/date.js'
import { out } from '../output.js'
import type { InitOptions, InitResult } from '../../core/schema.js'

const DKC_CLAUDE_MD_MARKER = '<!-- DKC:START -->'

export async function runInit(options: InitOptions): Promise<InitResult> {
  const projectRoot = resolve(options.projectRoot)
  const kbPath = options.knowledgeBasePath ?? DEFAULT_CONFIG.knowledgeBasePath
  const fullKbPath = join(projectRoot, kbPath)
  const projectName = basename(projectRoot)

  const result: InitResult = {
    created: [],
    modified: [],
    skipped: [],
    warnings: [],
  }

  out.header(`Initializing DKC for ${projectName}`)

  // ── 1. Check prerequisites ────────────────────────────────────────────────

  if (!(await dirExists(projectRoot))) {
    out.error(`Project root does not exist: ${projectRoot}`)
    throw new Error(`Project root does not exist: ${projectRoot}`)
  }

  const hasGit = await dirExists(join(projectRoot, '.git'))
  if (!hasGit) {
    result.warnings.push('No .git directory found — git hook will not be installed')
  }

  // ── 2. Scaffold .knowledge/ ───────────────────────────────────────────────

  const kb = new KnowledgeBase(fullKbPath)
  const alreadyExists = await kb.exists()

  if (alreadyExists) {
    out.skip(`${kbPath}/ already exists — repairing missing files only`)
  } else {
    out.step(`Creating ${kbPath}/`)
  }

  const config = { ...DEFAULT_CONFIG, knowledgeBasePath: kbPath, language: options.language ?? 'en' }
  const scaffolded = await kb.scaffold(config, projectName)

  for (const p of scaffolded) {
    out.success(`Created ${p.replace(projectRoot + '/', '')}`)
    result.created.push(p)
  }

  // ── 3. Write .dkc.config.json ─────────────────────────────────────────────

  const configPath = join(projectRoot, '.dkc.config.json')
  if (!(await fileExists(configPath))) {
    await writeConfig(projectRoot, config)
    out.success('Created .dkc.config.json')
    result.created.push(configPath)
  } else {
    out.skip('.dkc.config.json already exists')
    result.skipped.push(configPath)
  }

  // ── 4. Update CLAUDE.md ───────────────────────────────────────────────────

  if (!options.skipClaudeMd) {
    const claudeMdPath = join(projectRoot, 'CLAUDE.md')
    await updateClaudeMd(claudeMdPath, projectRoot, result)
  }

  // ── 5. Install git hook ───────────────────────────────────────────────────

  const installHook = options.gitHook !== false
  if (installHook && hasGit) {
    await installGitHook(projectRoot, result)
  } else if (installHook && !hasGit) {
    out.warn('Skipping git hook — no .git directory')
  }

  // ── 6. Update .gitignore (optional) ──────────────────────────────────────

  if (options.gitignore) {
    await updateGitignore(projectRoot, kbPath, result)
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  out.blank()
  out.success(`DKC initialized! Knowledge base at ${kbPath}/`)
  if (result.warnings.length > 0) {
    for (const w of result.warnings) out.warn(w)
  }
  out.info('Run `dkc reflect` after your next coding session to compile knowledge.')

  return result
}

async function updateClaudeMd(
  claudeMdPath: string,
  projectRoot: string,
  result: InitResult,
): Promise<void> {
  const templatePath = new URL('../../templates/claude-md-section.md.tpl', import.meta.url).pathname

  let sectionContent: string
  try {
    sectionContent = await readFile(templatePath, 'utf-8')
  } catch {
    sectionContent = '\n## Developer Knowledge Compiler (DKC)\n\n> Run `/reflect` to compile knowledge from recent sessions.\n'
  }

  if (await fileExists(claudeMdPath)) {
    const existing = await readTextFile(claudeMdPath)

    if (existing.includes(DKC_CLAUDE_MD_MARKER)) {
      out.skip('CLAUDE.md already has DKC section')
      result.skipped.push(claudeMdPath)
      return
    }

    const updated = existing.trimEnd() + '\n\n' + DKC_CLAUDE_MD_MARKER + '\n' + sectionContent.trim() + '\n<!-- DKC:END -->\n'
    await writeTextFile(claudeMdPath, updated)
    out.success('Updated CLAUDE.md with DKC section')
    result.modified.push(claudeMdPath)
  } else {
    const content = '# Project Instructions\n\n' + DKC_CLAUDE_MD_MARKER + '\n' + sectionContent.trim() + '\n<!-- DKC:END -->\n'
    await writeTextFile(claudeMdPath, content)
    out.success('Created CLAUDE.md')
    result.created.push(claudeMdPath)
  }
}

async function installGitHook(projectRoot: string, result: InitResult): Promise<void> {
  const hookPath = join(projectRoot, '.git', 'hooks', 'post-commit')
  const dkcLine = '# DKC: Developer Knowledge Compiler'
  const hookContent = [
    '#!/bin/sh',
    dkcLine,
    '# Auto-reflect is handled by Claude Code plugin (SessionEnd hook)',
    '# This hook is a fallback for non-Claude-Code workflows',
    'if command -v dkc &> /dev/null; then',
    '  dkc reflect --quiet 2>/dev/null || true',
    'fi',
  ].join('\n') + '\n'

  if (await fileExists(hookPath)) {
    const existing = await readTextFile(hookPath)
    if (existing.includes(dkcLine)) {
      out.skip('.git/hooks/post-commit already has DKC trigger')
      result.skipped.push(hookPath)
      return
    }
    // Append to existing hook
    await writeTextFile(hookPath, existing.trimEnd() + '\n\n' + hookContent)
    out.success('Updated .git/hooks/post-commit')
    result.modified.push(hookPath)
  } else {
    await ensureDir(join(projectRoot, '.git', 'hooks'))
    await writeTextFile(hookPath, hookContent)
    out.success('Created .git/hooks/post-commit')
    result.created.push(hookPath)
  }

  try {
    await chmod(hookPath, 0o755)
  } catch {
    result.warnings.push(`Could not chmod +x ${hookPath}`)
  }
}

async function updateGitignore(
  projectRoot: string,
  kbPath: string,
  result: InitResult,
): Promise<void> {
  const gitignorePath = join(projectRoot, '.gitignore')
  const entry = `\n# DKC Knowledge Base\n${kbPath}/\n`

  if (await fileExists(gitignorePath)) {
    const existing = await readTextFile(gitignorePath)
    if (existing.includes(kbPath + '/') || existing.includes(kbPath)) {
      out.skip('.gitignore already has .knowledge entry')
      result.skipped.push(gitignorePath)
      return
    }
    await writeTextFile(gitignorePath, existing.trimEnd() + entry)
    out.success('Updated .gitignore')
    result.modified.push(gitignorePath)
  } else {
    await writeTextFile(gitignorePath, entry.trimStart())
    out.success('Created .gitignore')
    result.created.push(gitignorePath)
  }
}
