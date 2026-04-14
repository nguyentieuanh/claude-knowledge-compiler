/**
 * Unicode-safe path utilities.
 * node:path's relative() does NOT normalize Unicode — on macOS, filesystem paths
 * use NFD while in-memory strings are NFC, causing relative() to produce ../../../../
 * for paths that are actually inside the project root.
 * Use toRelativePath() everywhere instead of relative().
 */

/**
 * Convert an absolute path to a path relative to projectRoot.
 * Safe with Unicode characters in path (e.g. Vietnamese folder names on macOS).
 * Returns the original path if it does not start with projectRoot.
 */
export function toRelativePath(projectRoot: string, filePath: string): string {
  if (!filePath.startsWith('/')) return filePath

  // Normalize both to NFC (macOS uses NFD on disk, NFC in memory — they must match)
  const normRoot = projectRoot.normalize('NFC').replace(/\/$/, '')
  const normFp = filePath.normalize('NFC')

  if (normFp.startsWith(normRoot + '/')) {
    return normFp.slice(normRoot.length + 1)
  }
  if (normFp === normRoot) {
    return '.'
  }

  // File is outside project root — return as-is rather than producing ../../../../
  return filePath
}

/**
 * Returns true if filePath is inside projectRoot.
 */
export function isInsideProject(projectRoot: string, filePath: string): boolean {
  if (!filePath.startsWith('/')) return true // already relative
  const normRoot = projectRoot.normalize('NFC').replace(/\/$/, '')
  const normFp = filePath.normalize('NFC')
  return normFp.startsWith(normRoot + '/') || normFp === normRoot
}
