import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit } from '../../src/cli/commands/init.js'
import { fileExists, dirExists, readTextFile } from '../../src/utils/fs.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'dkc-init-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('dkc init', () => {
  it('creates full .knowledge/ structure', async () => {
    const result = await runInit({
      projectRoot: tmpDir,
      gitHook: false,
      skipClaudeMd: false,
    })

    expect(await dirExists(join(tmpDir, '.knowledge'))).toBe(true)
    expect(await dirExists(join(tmpDir, '.knowledge', 'sessions'))).toBe(true)
    expect(await dirExists(join(tmpDir, '.knowledge', 'concepts'))).toBe(true)
    expect(await dirExists(join(tmpDir, '.knowledge', 'delegation'))).toBe(true)
    expect(await fileExists(join(tmpDir, '.knowledge', 'KNOWLEDGE.md'))).toBe(true)
    expect(await fileExists(join(tmpDir, '.knowledge', 'index.md'))).toBe(true)
    expect(await fileExists(join(tmpDir, '.knowledge', 'log.md'))).toBe(true)
    expect(await fileExists(join(tmpDir, '.knowledge', 'gaps.md'))).toBe(true)
    expect(await fileExists(join(tmpDir, '.dkc.config.json'))).toBe(true)
    expect(result.created.length).toBeGreaterThan(0)
    // tmpDir has no .git, so there will be a warning about that — that's expected
    expect(result.warnings.every(w => w.includes('.git') || w.includes('git'))).toBe(true)
  })

  it('creates CLAUDE.md with DKC section', async () => {
    await runInit({ projectRoot: tmpDir, gitHook: false })

    const claudeMd = await readTextFile(join(tmpDir, 'CLAUDE.md'))
    expect(claudeMd).toContain('<!-- DKC:START -->')
    expect(claudeMd).toContain('Developer Knowledge Compiler')
  })

  it('appends DKC section to existing CLAUDE.md without overwriting', async () => {
    const { writeTextFile } = await import('../../src/utils/fs.js')
    const existingContent = '# My Project\n\nExisting instructions here.'
    await writeTextFile(join(tmpDir, 'CLAUDE.md'), existingContent)

    await runInit({ projectRoot: tmpDir, gitHook: false })

    const claudeMd = await readTextFile(join(tmpDir, 'CLAUDE.md'))
    expect(claudeMd).toContain('Existing instructions here.')
    expect(claudeMd).toContain('<!-- DKC:START -->')
  })

  it('is idempotent — running twice does not overwrite files', async () => {
    await runInit({ projectRoot: tmpDir, gitHook: false })

    // Modify index.md to check it's not overwritten
    const { writeTextFile } = await import('../../src/utils/fs.js')
    await writeTextFile(join(tmpDir, '.knowledge', 'index.md'), '# Custom Index\n\nCustom content.')

    const result2 = await runInit({ projectRoot: tmpDir, gitHook: false })

    // index.md should still have custom content
    const indexContent = await readTextFile(join(tmpDir, '.knowledge', 'index.md'))
    expect(indexContent).toContain('Custom content.')
    expect(result2.skipped).toContain(join(tmpDir, '.dkc.config.json'))
  })

  it('reports warning when no .git directory', async () => {
    const result = await runInit({
      projectRoot: tmpDir,
      gitHook: true,   // Request git hook but no .git exists
      skipClaudeMd: true,
    })

    expect(result.warnings.some(w => w.includes('.git'))).toBe(true)
  })

  it('skips CLAUDE.md update when skipClaudeMd is true', async () => {
    await runInit({ projectRoot: tmpDir, gitHook: false, skipClaudeMd: true })

    expect(await fileExists(join(tmpDir, 'CLAUDE.md'))).toBe(false)
  })

  it('does not duplicate DKC section on second run', async () => {
    await runInit({ projectRoot: tmpDir, gitHook: false })
    await runInit({ projectRoot: tmpDir, gitHook: false })

    const claudeMd = await readTextFile(join(tmpDir, 'CLAUDE.md'))
    const count = (claudeMd.match(/<!-- DKC:START -->/g) ?? []).length
    expect(count).toBe(1)
  })
})
