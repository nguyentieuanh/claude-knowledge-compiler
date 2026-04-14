import matter from 'gray-matter'

export interface ParsedMarkdown<T = Record<string, unknown>> {
  frontmatter: T
  content: string
  raw: string
}

/**
 * Parse markdown file with YAML frontmatter.
 */
export function parseMarkdown<T = Record<string, unknown>>(raw: string): ParsedMarkdown<T> {
  const { data, content } = matter(raw)
  return {
    frontmatter: data as T,
    content: content.trim(),
    raw,
  }
}

/**
 * Serialize frontmatter + content back to markdown string.
 */
export function stringifyMarkdown(frontmatter: Record<string, unknown>, content: string): string {
  return matter.stringify(content, frontmatter)
}

/**
 * Fill {{placeholder}} values in a template string.
 */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = values[key]
    return val !== undefined ? String(val) : match
  })
}

/**
 * Get a section from markdown content by header name.
 * Returns the content under that ## header, or null if not found.
 */
export function getSection(content: string, sectionName: string): string | null {
  // No 'm' flag: $ matches end of string, preventing premature stop at end of each line
  const pattern = new RegExp(`(?:^|\\n)## ${sectionName}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`)
  const match = pattern.exec(content)
  return match?.[1]?.trim() ?? null
}

/**
 * Check if a markdown file has a Human Notes section.
 */
export function hasHumanNotesSection(content: string): boolean {
  return content.includes('## Human Notes')
}

/**
 * Extract the Human Notes section content.
 * Returns empty string if not found.
 */
export function getHumanNotes(content: string): string {
  return getSection(content, 'Human Notes') ?? ''
}

/**
 * Preserve Human Notes section when updating a concept page.
 * P4: DKC compiler NEVER modifies this section.
 */
export function preserveHumanNotes(existingContent: string, newContent: string): string {
  const humanNotes = getHumanNotes(existingContent)
  if (!humanNotes) return newContent

  // Replace the Human Notes section in new content with existing one
  const humanNotesPattern = /(## Human Notes\n)([\s\S]*?)(?=\n## |\s*$)/
  const replacement = `## Human Notes\n${humanNotes}\n`

  if (humanNotesPattern.test(newContent)) {
    return newContent.replace(humanNotesPattern, replacement)
  }
  // Append Human Notes if not present in new content
  return newContent.trimEnd() + '\n\n## Human Notes\n' + humanNotes + '\n'
}

/**
 * Extract code blocks from markdown content.
 */
export function extractCodeBlocks(content: string): Array<{ language: string; code: string }> {
  const blocks: Array<{ language: string; code: string }> = []
  const pattern = /```(\w*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content)) !== null) {
    blocks.push({
      language: match[1] ?? '',
      code: match[2] ?? '',
    })
  }

  return blocks
}

/**
 * Count words in a text string.
 */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Extract [[concept-slug]] cross-references from content.
 */
export function extractCrossReferences(content: string): string[] {
  const refs: string[] = []
  const pattern = /\[\[([^\]]+)\]\]/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content)) !== null) {
    if (match[1]) refs.push(match[1])
  }

  return [...new Set(refs)]
}
