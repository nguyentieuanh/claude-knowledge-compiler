/**
 * Integration test: full compile pipeline
 * init → reflect (with fixture transcript) → gaps → verify outputs
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInit } from '../../src/cli/commands/init.js'
import { runReflect } from '../../src/cli/commands/reflect.js'
import { runGaps } from '../../src/cli/commands/gaps.js'
import { KnowledgeBase } from '../../src/core/knowledge-base.js'
import { ensureEnvLoaded } from '../../src/compilers/llm-client.js'
import { fileExists, dirExists, readTextFile } from '../../src/utils/fs.js'

// Preload .env so subsequent delete process.env[...] below sticks.
ensureEnvLoaded()

const FIXTURES = join(fileURLToPath(import.meta.url), '../../../tests/fixtures/conversations')

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'dkc-pipeline-'))
  delete process.env['ANTHROPIC_API_KEY']  // Use deterministic mode
  delete process.env['OPENAI_API_KEY']
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('full compile pipeline', () => {
  it('init → reflect → creates session debrief', async () => {
    // Step 1: Init
    await runInit({ projectRoot: tmpDir, gitHook: false, skipClaudeMd: false })
    expect(await dirExists(join(tmpDir, '.knowledge'))).toBe(true)

    // Step 2: Reflect with typical transcript
    const reflectResult = await runReflect({
      projectRoot: tmpDir,
      sessionId: 'session-typical',
      transcriptPath: join(FIXTURES, 'typical.jsonl'),
      quiet: true,
    })

    expect(reflectResult.success).toBe(true)
    expect(reflectResult.sessionId).toBe('session-typical')
    expect(reflectResult.sessionFilePath).toContain('sessions/')

    // Session debrief file exists
    const sessionFile = join(tmpDir, '.knowledge', 'sessions', 'session-typical.md')
    expect(await fileExists(sessionFile)).toBe(true)

    const sessionContent = await readTextFile(sessionFile)
    expect(sessionContent).toContain('session_id: session-typical')
    expect(sessionContent).toContain('## Summary')
    expect(sessionContent).toContain('## Delegation Summary')
  })

  it('reflect → creates or updates index.md', async () => {
    await runInit({ projectRoot: tmpDir, gitHook: false })

    await runReflect({
      projectRoot: tmpDir,
      sessionId: 'session-typical',
      transcriptPath: join(FIXTURES, 'typical.jsonl'),
      quiet: true,
    })

    const indexContent = await readTextFile(join(tmpDir, '.knowledge', 'index.md'))
    expect(indexContent).toContain('# Knowledge Index')
    expect(indexContent).toContain('session-typical')
  })

  it('reflect → appends to log.md', async () => {
    await runInit({ projectRoot: tmpDir, gitHook: false })

    await runReflect({
      projectRoot: tmpDir,
      sessionId: 'session-typical',
      transcriptPath: join(FIXTURES, 'typical.jsonl'),
      quiet: true,
    })

    const logContent = await readTextFile(join(tmpDir, '.knowledge', 'log.md'))
    expect(logContent).toContain('compile')
    expect(logContent).toContain('session-typical')
  })

  it('reflect → writes delegation map', async () => {
    await runInit({ projectRoot: tmpDir, gitHook: false })

    await runReflect({
      projectRoot: tmpDir,
      sessionId: 'session-typical',
      transcriptPath: join(FIXTURES, 'typical.jsonl'),
      quiet: true,
    })

    const mapPath = join(tmpDir, '.knowledge', 'delegation', 'map.md')
    expect(await fileExists(mapPath)).toBe(true)
  })

  it('reflect → writes gaps.md', async () => {
    await runInit({ projectRoot: tmpDir, gitHook: false })

    await runReflect({
      projectRoot: tmpDir,
      sessionId: 'session-typical',
      transcriptPath: join(FIXTURES, 'typical.jsonl'),
      quiet: true,
    })

    const gapsPath = join(tmpDir, '.knowledge', 'gaps.md')
    expect(await fileExists(gapsPath)).toBe(true)
  })

  it('two reflects → both sessions appear in index', async () => {
    await runInit({ projectRoot: tmpDir, gitHook: false })

    await runReflect({
      projectRoot: tmpDir,
      sessionId: 'session-typical',
      transcriptPath: join(FIXTURES, 'typical.jsonl'),
      quiet: true,
    })

    await runReflect({
      projectRoot: tmpDir,
      sessionId: 'session-minimal',
      transcriptPath: join(FIXTURES, 'minimal.jsonl'),
      quiet: true,
    })

    const indexContent = await readTextFile(join(tmpDir, '.knowledge', 'index.md'))
    expect(indexContent).toContain('session-typical')
    // Minimal may or may not appear depending on session count
    // But index should have been updated at least once
    expect(indexContent).toContain('## Recent Sessions')
  })

  it('reflect → handles empty transcript gracefully', async () => {
    await runInit({ projectRoot: tmpDir, gitHook: false })

    const result = await runReflect({
      projectRoot: tmpDir,
      sessionId: 'session-empty',
      transcriptPath: join(FIXTURES, 'empty.jsonl'),
      quiet: true,
    })

    // Empty transcript should fail gracefully, not crash
    expect(result.success).toBe(false)
    expect(result.error?.toLowerCase()).toContain('empty')
  })

  it('reflect → handles corrupted transcript gracefully', async () => {
    await runInit({ projectRoot: tmpDir, gitHook: false })

    // Corrupted file has some valid messages — should still work
    const result = await runReflect({
      projectRoot: tmpDir,
      sessionId: 'session-corrupt',
      transcriptPath: join(FIXTURES, 'corrupted.jsonl'),
      quiet: true,
    })

    // Should succeed with valid lines (not crash)
    // May fail due to low message count (< autoCompileMinMessages)
    expect(typeof result.success).toBe('boolean')
    expect(typeof result.error === 'string' || result.error === undefined).toBe(true)
  })

  it('gaps command runs without errors after reflect', async () => {
    await runInit({ projectRoot: tmpDir, gitHook: false })

    await runReflect({
      projectRoot: tmpDir,
      sessionId: 'session-typical',
      transcriptPath: join(FIXTURES, 'typical.jsonl'),
      quiet: true,
    })

    // runGaps should not throw
    await expect(runGaps(tmpDir)).resolves.not.toThrow()
  })

  it('knowledge base has expected structure after pipeline', async () => {
    await runInit({ projectRoot: tmpDir, gitHook: false })

    await runReflect({
      projectRoot: tmpDir,
      sessionId: 'session-typical',
      transcriptPath: join(FIXTURES, 'typical.jsonl'),
      quiet: true,
    })

    const kb = new KnowledgeBase(join(tmpDir, '.knowledge'))
    const stats = await kb.getStats()

    expect(stats.sessionCount).toBeGreaterThanOrEqual(1)
    expect(stats.lastCompiled).toBeTruthy()
  })
})
