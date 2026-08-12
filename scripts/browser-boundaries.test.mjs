import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import test from 'node:test'

const repositoryRoot = new URL('..', import.meta.url)
const forbiddenRuntime =
  /(?:from\s+['"](?:@playwright\/test|playwright|playwright-core|puppeteer)|import\(['"](?:@playwright\/test|playwright|playwright-core|puppeteer)['"]\)|chromium\.launch\s*\()/

async function sourceFiles(relativeDirectory) {
  const directory = new URL(`${relativeDirectory}/`, repositoryRoot)
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = join(relativeDirectory, entry.name)
      if (entry.isDirectory()) return sourceFiles(relativePath)
      return ['.js', '.mjs', '.ts', '.vue'].includes(extname(entry.name))
        ? [relativePath]
        : []
    }),
  )
  return nested.flat()
}

test('keeps Chromium launchers outside server and theme Skill runtimes', async () => {
  const files = (
    await Promise.all(
      [
        'apps/gateway/src',
        'packages/fastppt-mcp/src',
        'packages/slidewave/src/server',
        'themes/slidev-theme-academy/agent',
        'themes/slidev-theme-landing/agent',
      ].map(sourceFiles),
    )
  ).flat()

  for (const file of files) {
    const source = await readFile(new URL(file, repositoryRoot), 'utf8')
    assert.doesNotMatch(source, forbiddenRuntime, file)
  }
})
