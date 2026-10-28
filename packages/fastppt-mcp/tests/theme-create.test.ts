import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadThemeRegistry } from '@fastppt/theme-registry'
import { afterEach, expect, it } from 'vitest'

import { createTheme } from '../src/theme-create.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

it('creates a discoverable design theme with rules and Skill, without replacing existing themes', async () => {
  const themesRoot = await mkdtemp(join(tmpdir(), 'fastppt-theme-create-'))
  roots.push(themesRoot)
  const input = {
    themesRoot,
    themeId: 'slidev-theme-test',
    displayName: 'Test',
    design: {
      version: 1 as const,
      foundation: {
        colors: {
          canvas: '#ffffff',
          ink: '#111111',
          muted: '#666666',
          primary: '#123456',
          accent: '#654321',
          surface: '#eeeeee',
          border: '#cccccc',
        },
        typography: { heading: 'Arial', body: 'Arial' },
        geometry: {},
      },
      layouts: [
        {
          id: 'cover',
          label: 'Cover',
          purpose: 'Open the presentation',
          composition: 'cover' as const,
          regions: ['title'],
        },
      ],
      rules: {
        density: 'balanced' as const,
        imageTreatment: 'Preserve aspect ratio',
      },
    },
  }
  const created = await createTheme(input)
  expect(created.skillId).toBe('fastppt-theme-test')
  const registry = await loadThemeRegistry(themesRoot)
  expect(registry.resolve(input.themeId).manifest.designSystem).toBeTruthy()
  expect(
    await readFile(join(created.themeDir, 'agent/SKILL.md'), 'utf8'),
  ).toContain('Design system')
  expect(
    await readFile(join(created.themeDir, 'styles/index.ts'), 'utf8'),
  ).toContain('agent-design')
  await expect(createTheme(input)).rejects.toThrow()
  expect(
    (await loadThemeRegistry(themesRoot)).resolve(input.themeId).manifest
      .displayName,
  ).toBe('Test')
  await expect(
    createTheme({ ...input, themeId: '../outside' }),
  ).rejects.toThrow()
})
