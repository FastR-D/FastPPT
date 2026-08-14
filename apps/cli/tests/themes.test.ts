import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { installBundledThemes } from '../src/themes.js'

describe('bundled theme installation', () => {
  it('updates bundled themes and preserves imported themes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fastppt-cli-themes-'))
    const bundled = join(root, 'bundle')
    const installed = join(root, 'home', '.fastppt', 'themes')
    await mkdir(join(bundled, 'slidev-theme-built-in'), { recursive: true })
    await writeFile(join(bundled, 'slidev-theme-built-in', 'version.txt'), 'v1')

    expect(
      await installBundledThemes({
        bundledThemesRoot: bundled,
        themesRoot: installed,
        version: '1.0.0',
      }),
    ).toEqual({ updated: true, themeCount: 1 })
    await mkdir(join(installed, 'slidev-theme-imported'), { recursive: true })
    await writeFile(join(installed, 'slidev-theme-imported', 'keep.txt'), 'keep')
    await writeFile(join(bundled, 'slidev-theme-built-in', 'version.txt'), 'v2')

    expect(
      await installBundledThemes({
        bundledThemesRoot: bundled,
        themesRoot: installed,
        version: '1.0.1',
      }),
    ).toEqual({ updated: true, themeCount: 1 })
    expect(
      await readFile(join(installed, 'slidev-theme-built-in', 'version.txt'), 'utf8'),
    ).toBe('v2')
    expect(
      await readFile(join(installed, 'slidev-theme-imported', 'keep.txt'), 'utf8'),
    ).toBe('keep')
  })
})
