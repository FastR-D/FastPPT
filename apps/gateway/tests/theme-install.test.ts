import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installThemeDirectory } from '../src/theme-install.js'

describe('theme directory installation', () => {
  for (const failure of ['prepare', 'register', 'none'] as const) {
    it(`preserves the source and handles ${failure} failure`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'fastppt-install-test-'))
      try {
        const source = join(root, 'draft'); const target = join(root, 'themes', 'theme')
        await mkdir(source, { recursive: true }); await mkdir(target, { recursive: true })
        await writeFile(join(source, 'content'), 'source')
        await writeFile(join(target, 'content'), 'previous')
        const task = installThemeDirectory(source, target, async (candidate) => {
          await writeFile(join(candidate, 'content'), 'prepared')
          if (failure === 'prepare') throw new Error('prepare failed')
        }, () => failure === 'register' ? Promise.reject(new Error('register failed')) : Promise.resolve())
        if (failure === 'none') await task
        else await expect(task).rejects.toThrow(`${failure} failed`)
        expect(await readFile(join(source, 'content'), 'utf8')).toBe('source')
        expect(await readFile(join(target, 'content'), 'utf8')).toBe(failure === 'none' ? 'prepared' : 'previous')
        expect(await readdir(join(root, 'themes'))).toEqual(['theme'])
      } finally { await rm(root, { recursive: true, force: true }) }
    })
  }
})
