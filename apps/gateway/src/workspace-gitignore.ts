import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FASTPPT_IGNORES = [
  '.fastppt/',
  '.claude/',
  '.codex/',
  '.agents/',
  '.mcp.json',
  '.mcp.json.fastppt-backup-*',
]

export async function ensureWorkspaceGitignore(
  workspaceRoot: string,
): Promise<void> {
  const path = join(workspaceRoot, '.gitignore')
  const source = await readFile(path, 'utf8').catch((cause: unknown) => {
    if (
      cause instanceof Error &&
      'code' in cause &&
      cause.code === 'ENOENT'
    )
      return ''
    throw cause
  })
  const existing = new Set(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  )
  const missing = FASTPPT_IGNORES.filter((entry) => !existing.has(entry))
  if (missing.length === 0) return
  const separator = source.length > 0 && !source.endsWith('\n') ? '\n' : ''
  const heading = source.includes('# FastPPT workspace files')
    ? ''
    : `${source.length > 0 ? '\n' : ''}# FastPPT workspace files\n`
  await writeFile(
    path,
    `${source}${separator}${heading}${missing.join('\n')}\n`,
    'utf8',
  )
}
