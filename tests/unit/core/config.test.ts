import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, writeConfig, DEFAULT_CONFIG, resolveKnowledgeBasePath } from '../../../src/core/config.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'dkc-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('loadConfig', () => {
  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig(tmpDir)
    expect(config).toEqual(DEFAULT_CONFIG)
  })

  it('merges config file with defaults', async () => {
    await writeConfig(tmpDir, { autoCompile: false, autoCompileMinMessages: 10 })
    const config = await loadConfig(tmpDir)
    expect(config.autoCompile).toBe(false)
    expect(config.autoCompileMinMessages).toBe(10)
    expect(config.knowledgeBasePath).toBe(DEFAULT_CONFIG.knowledgeBasePath)
  })

  it('handles corrupted config file gracefully', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(tmpDir, '.dkc.config.json'), 'not json')
    const config = await loadConfig(tmpDir)
    expect(config).toEqual(DEFAULT_CONFIG)
  })
})

describe('resolveKnowledgeBasePath', () => {
  it('uses config path by default', () => {
    const config = { ...DEFAULT_CONFIG, knowledgeBasePath: '.knowledge' }
    const result = resolveKnowledgeBasePath('/project', config)
    expect(result).toBe('/project/.knowledge')
  })

  it('uses env var CLAUDE_PLUGIN_OPTION_KNOWLEDGEBASEPATH when set', () => {
    process.env['CLAUDE_PLUGIN_OPTION_KNOWLEDGEBASEPATH'] = 'custom-kb'
    const config = { ...DEFAULT_CONFIG }
    const result = resolveKnowledgeBasePath('/project', config)
    expect(result).toBe('/project/custom-kb')
    delete process.env['CLAUDE_PLUGIN_OPTION_KNOWLEDGEBASEPATH']
  })
})
