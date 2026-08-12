import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveFastPptMcpCliEntry(): string {
  const directory = dirname(fileURLToPath(import.meta.url))
  return directory.endsWith(`${join('fastppt-mcp', 'src')}`)
    ? join(directory, 'cli.ts')
    : join(directory, '..', 'src', 'cli.ts')
}
