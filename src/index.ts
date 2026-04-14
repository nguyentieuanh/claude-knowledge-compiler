/**
 * DKC Public API
 * Exported for use by hook scripts and external integrations.
 */

export { KnowledgeBase } from './core/knowledge-base.js'
export { loadConfig, writeConfig, DEFAULT_CONFIG, resolveKnowledgeBasePath } from './core/config.js'
export * from './core/schema.js'
export * from './utils/fs.js'
export * from './utils/markdown.js'
export * from './utils/slug.js'
export * from './utils/date.js'
