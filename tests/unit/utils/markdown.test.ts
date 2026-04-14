import { describe, it, expect } from 'vitest'
import {
  parseMarkdown,
  stringifyMarkdown,
  fillTemplate,
  getSection,
  hasHumanNotesSection,
  getHumanNotes,
  preserveHumanNotes,
  extractCodeBlocks,
  wordCount,
  extractCrossReferences,
} from '../../../src/utils/markdown.js'

describe('parseMarkdown', () => {
  it('parses frontmatter and content', () => {
    const raw = `---\nname: Test\nslug: test\n---\n\n# Test\n\nContent here.`
    const result = parseMarkdown(raw)
    expect(result.frontmatter).toEqual({ name: 'Test', slug: 'test' })
    expect(result.content).toBe('# Test\n\nContent here.')
  })

  it('handles markdown with no frontmatter', () => {
    const raw = `# Just content\n\nNo frontmatter here.`
    const result = parseMarkdown(raw)
    expect(result.frontmatter).toEqual({})
    expect(result.content).toContain('Just content')
  })

  it('handles empty string', () => {
    const result = parseMarkdown('')
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe('')
  })
})

describe('fillTemplate', () => {
  it('replaces placeholders', () => {
    const tpl = 'Hello {{name}}, you are {{age}} years old.'
    expect(fillTemplate(tpl, { name: 'World', age: 42 })).toBe('Hello World, you are 42 years old.')
  })

  it('leaves unknown placeholders unchanged', () => {
    const tpl = 'Hello {{name}}, today is {{date}}.'
    expect(fillTemplate(tpl, { name: 'World' })).toBe('Hello World, today is {{date}}.')
  })

  it('handles empty values', () => {
    const tpl = 'A: {{a}}, B: {{b}}'
    expect(fillTemplate(tpl, { a: '', b: '0' })).toBe('A: , B: 0')
  })
})

describe('getSection', () => {
  const content = `## Summary\nThis is the summary.\n\n## Decisions Made\nDecision 1.\n\n## Human Notes\nMy notes.`

  it('extracts a section by name', () => {
    expect(getSection(content, 'Summary')).toBe('This is the summary.')
  })

  it('returns null for missing section', () => {
    expect(getSection(content, 'Missing Section')).toBeNull()
  })

  it('extracts last section correctly', () => {
    expect(getSection(content, 'Human Notes')).toBe('My notes.')
  })
})

describe('hasHumanNotesSection', () => {
  it('returns true when section exists', () => {
    expect(hasHumanNotesSection('## Human Notes\nsome content')).toBe(true)
  })

  it('returns false when section missing', () => {
    expect(hasHumanNotesSection('## Summary\nsome content')).toBe(false)
  })
})

describe('preserveHumanNotes', () => {
  const existing = `# Concept\n\n## Summary\nOld summary.\n\n## Human Notes\nMy important notes here.`
  const newContent = `# Concept\n\n## Summary\nNew summary.\n\n## Human Notes\nAuto-generated notes.`

  it('preserves existing human notes over new content', () => {
    const result = preserveHumanNotes(existing, newContent)
    expect(result).toContain('My important notes here.')
    expect(result).not.toContain('Auto-generated notes.')
  })

  it('returns new content unchanged when no existing human notes', () => {
    const noNotes = `# Concept\n\n## Summary\nOld summary.`
    const result = preserveHumanNotes(noNotes, newContent)
    expect(result).toBe(newContent)
  })

  it('appends human notes if not in new content', () => {
    const noNotesNew = `# Concept\n\n## Summary\nNew summary.`
    const result = preserveHumanNotes(existing, noNotesNew)
    expect(result).toContain('My important notes here.')
    expect(result).toContain('## Human Notes')
  })
})

describe('extractCodeBlocks', () => {
  it('extracts code blocks with language', () => {
    const content = '```typescript\nconst x = 1;\n```\n\n```bash\necho hello\n```'
    const blocks = extractCodeBlocks(content)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ language: 'typescript', code: 'const x = 1;\n' })
    expect(blocks[1]).toEqual({ language: 'bash', code: 'echo hello\n' })
  })

  it('returns empty array when no code blocks', () => {
    expect(extractCodeBlocks('No code here.')).toEqual([])
  })
})

describe('wordCount', () => {
  it('counts words correctly', () => {
    expect(wordCount('hello world foo')).toBe(3)
  })

  it('handles extra whitespace', () => {
    expect(wordCount('  hello   world  ')).toBe(2)
  })

  it('returns 0 for empty string', () => {
    expect(wordCount('')).toBe(0)
  })
})

describe('extractCrossReferences', () => {
  it('extracts [[slug]] references', () => {
    const content = 'See [[dependency-injection]] and [[event-loop]] for details.'
    const refs = extractCrossReferences(content)
    expect(refs).toContain('dependency-injection')
    expect(refs).toContain('event-loop')
  })

  it('deduplicates references', () => {
    const content = '[[di]] then [[di]] again'
    expect(extractCrossReferences(content)).toEqual(['di'])
  })

  it('returns empty for no references', () => {
    expect(extractCrossReferences('No refs here.')).toEqual([])
  })
})
