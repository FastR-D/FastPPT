import { access } from 'node:fs/promises'
import { join } from 'node:path'

const installer = join(import.meta.dirname, '..', 'dist', 'runtime', 'install-themes.js')

try {
  await access(installer)
} catch (cause) {
  if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')
    process.exit(0)
  throw cause
}

await import(installer)
