import slugifyLib from 'slugify'

/**
 * Convert a concept name to a URL-safe slug for use as a filename.
 * e.g. "Dependency Injection" → "dependency-injection"
 */
export function slugify(name: string): string {
  return slugifyLib(name, {
    lower: true,
    strict: true,
    trim: true,
  })
}

/**
 * Convert a slug back to a display name.
 * e.g. "dependency-injection" → "Dependency Injection"
 */
export function slugToName(slug: string): string {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Normalize a concept name for fuzzy matching.
 * Strips spaces, hyphens, lowercases.
 * e.g. "Dependency Injection" → "dependencyinjection"
 */
export function normalizeForMatch(name: string): string {
  return name.toLowerCase().replace(/[\s\-_]/g, '')
}

/**
 * Check if two concept names refer to the same concept (fuzzy).
 * Handles: DI ↔ dependency-injection, camelCase ↔ kebab-case
 */
export function conceptsMatch(a: string, b: string): boolean {
  const na = normalizeForMatch(a)
  const nb = normalizeForMatch(b)
  if (na === nb) return true

  // Check if one is an abbreviation of the other
  const slugA = slugify(a)
  const slugB = slugify(b)
  if (slugA === slugB) return true

  return false
}
