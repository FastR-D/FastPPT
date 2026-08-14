import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ensureWorkspaceGitignore } from '../src/workspace-gitignore.js'

describe('ensureWorkspaceGitignore', () => {
  it('creates the FastPPT ignore block and remains idempotent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fastppt-gitignore-'))
    try {
      await ensureWorkspaceGitignore(root)
      const first = await readFile(join(root, '.gitignore'), 'utf8')
      await ensureWorkspaceGitignore(root)
      expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe(first)
      expect(first).toContain('.fastppt/')
      expect(first).toContain('.claude/')
      expect(first).toContain('.codex/')
      expect(first).toContain('.agents/')
      expect(first).toContain('.mcp.json')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves user entries while appending missing ignores', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fastppt-gitignore-'))
    try {
      await writeFile(join(root, '.gitignore'), 'dist/\n.fastppt/\n')
      await ensureWorkspaceGitignore(root)
      const source = await readFile(join(root, '.gitignore'), 'utf8')
      expect(source).toContain('dist/\n')
      expect(source.match(/\.fastppt\//g)).toHaveLength(1)
      expect(source).toContain('.claude/')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
