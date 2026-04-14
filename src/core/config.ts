import { readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import type { DKCConfig } from './schema.js'

const CONFIG_FILENAME = '.dkc.config.json'

export const DEFAULT_CONFIG: DKCConfig = {
  knowledgeBasePath: '.knowledge',
  autoCompile: true,
  autoCompileMinMessages: 5,
  maxConceptsPerSession: 5,
  staleKnowledgeDays: 30,
  language: 'en',
  version: '1',
}

export async function loadConfig(projectRoot: string): Promise<DKCConfig> {
  const configPath = join(projectRoot, CONFIG_FILENAME)

  try {
    await access(configPath)
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return { ...DEFAULT_CONFIG, ...sanitizeConfig(parsed) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/**
 * Validate and sanitize user-provided config values.
 * Only keeps known fields with correct types; ignores invalid values.
 */
function sanitizeConfig(raw: Record<string, unknown>): Partial<DKCConfig> {
  const result: Partial<DKCConfig> = {}

  if (typeof raw['knowledgeBasePath'] === 'string' && raw['knowledgeBasePath'].length > 0) {
    result.knowledgeBasePath = raw['knowledgeBasePath']
  }
  if (typeof raw['autoCompile'] === 'boolean') {
    result.autoCompile = raw['autoCompile']
  }
  if (typeof raw['autoCompileMinMessages'] === 'number' && raw['autoCompileMinMessages'] >= 1) {
    result.autoCompileMinMessages = Math.floor(raw['autoCompileMinMessages'])
  }
  if (typeof raw['maxConceptsPerSession'] === 'number' && raw['maxConceptsPerSession'] >= 1 && raw['maxConceptsPerSession'] <= 20) {
    result.maxConceptsPerSession = Math.floor(raw['maxConceptsPerSession'])
  }
  if (typeof raw['staleKnowledgeDays'] === 'number' && raw['staleKnowledgeDays'] >= 1) {
    result.staleKnowledgeDays = Math.floor(raw['staleKnowledgeDays'])
  }
  if (raw['language'] === 'en' || raw['language'] === 'vi') {
    result.language = raw['language']
  }
  if (typeof raw['version'] === 'string') {
    result.version = raw['version']
  }

  return result
}

export async function writeConfig(projectRoot: string, config: Partial<DKCConfig>): Promise<void> {
  const configPath = join(projectRoot, CONFIG_FILENAME)
  const merged = { ...DEFAULT_CONFIG, ...config }
  await writeFile(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
}

export function getKnowledgeBasePath(projectRoot: string, config: DKCConfig): string {
  return join(projectRoot, config.knowledgeBasePath)
}

/**
 * Validate that a knowledge base path is safe (relative, no traversal).
 */
function isValidKBPath(kbPath: string): boolean {
  if (!kbPath || kbPath.startsWith('/') || kbPath.startsWith('~')) return false
  // Normalize to handle sneaky traversals like "foo/../../etc"
  const segments = kbPath.split(/[/\\]/)
  let depth = 0
  for (const seg of segments) {
    if (seg === '..') { depth--; if (depth < 0) return false }
    else if (seg !== '.' && seg !== '') depth++
  }
  return true
}

/**
 * Resolve knowledge base path from env var or config.
 * Env var CLAUDE_PLUGIN_OPTION_KNOWLEDGEBASEPATH overrides config (from userConfig).
 */
export function resolveKnowledgeBasePath(projectRoot: string, config: DKCConfig): string {
  const envPath = process.env['CLAUDE_PLUGIN_OPTION_KNOWLEDGEBASEPATH']
  const kbPath = envPath ?? config.knowledgeBasePath
  if (!isValidKBPath(kbPath)) {
    throw new Error(`Invalid knowledge base path "${kbPath}": must be a relative path within the project`)
  }
  return join(projectRoot, kbPath)
}
