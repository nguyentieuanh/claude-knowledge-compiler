import {
  readFile,
  writeFile,
  mkdir,
  access,
  stat,
  readdir,
  copyFile,
  rename,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath)
    return s.isDirectory()
  } catch {
    return false
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

export async function readTextFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8')
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await ensureDir(dirname(filePath))
  // Atomic write: write to temp file in same directory, then rename
  const tmpPath = `${filePath}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmpPath, content, 'utf-8')
  await rename(tmpPath, filePath)
}

export async function appendTextFile(filePath: string, content: string): Promise<void> {
  await ensureDir(dirname(filePath))
  const existing = await fileExists(filePath) ? await readTextFile(filePath) : ''
  await writeFile(filePath, existing + content, 'utf-8')
}

export async function listFiles(dirPath: string, extension?: string): Promise<string[]> {
  if (!(await dirExists(dirPath))) return []
  const entries = await readdir(dirPath, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && (!extension || e.name.endsWith(extension)))
    .map(e => join(dirPath, e.name))
}

export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  await writeTextFile(filePath, JSON.stringify(data, null, 2) + '\n')
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await readTextFile(filePath)
  return JSON.parse(content) as T
}

export async function safeReadJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return await readJsonFile<T>(filePath)
  } catch {
    return fallback
  }
}

export async function copyFileIfNotExists(src: string, dest: string): Promise<boolean> {
  if (await fileExists(dest)) return false
  await ensureDir(dirname(dest))
  await copyFile(src, dest)
  return true
}
