import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const packagesRoot = new URL('../packages/', import.meta.url)

test('workspace packages expose and resolve source without dist dependencies', async () => {
  const entries = await readdir(packagesRoot, { withFileTypes: true })
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const packageRoot = new URL(`${entry.name}/`, packagesRoot)
    const manifest = JSON.parse(
      await readFile(new URL('package.json', packageRoot), 'utf8'),
    )
    // Development resolution must use source so a clean checkout does not
    // depend on a prior build. Publication metadata such as `files` and
    // `sideEffects` must still be allowed to describe generated dist files.
    for (const field of ['exports', 'bin']) {
      assert.doesNotMatch(
        JSON.stringify(manifest[field] ?? null),
        /(?:^|[\\/])dist(?:[\\/]|$)/,
        `${entry.name} package.json ${field} must not depend on dist`,
      )
    }

    const sourceRoot = new URL('src/', packageRoot)
    const pending = ['']
    while (pending.length) {
      const relativeDirectory = pending.pop()
      const sourceEntries = await readdir(
        new URL(relativeDirectory ? `${relativeDirectory}/` : './', sourceRoot),
        { withFileTypes: true },
      )
      for (const sourceEntry of sourceEntries) {
        const relativePath = join(relativeDirectory, sourceEntry.name)
        if (sourceEntry.isDirectory()) {
          pending.push(relativePath)
          continue
        }
        if (!/\.[cm]?[jt]sx?$/.test(sourceEntry.name)) continue
        const source = await readFile(new URL(relativePath, sourceRoot), 'utf8')
        assert.doesNotMatch(
          source,
          /['"]\.\.?[\\/][^'"]*\bdist(?:[\\/][^'"]*)?['"]|\bjoin\([^)]*['"]dist['"]/m,
          `${entry.name}/src/${relativePath} must not resolve through dist`,
        )
      }
    }
  }
})
