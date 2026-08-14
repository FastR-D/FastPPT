import {
  appendFileSync,
  cpSync,
  mkdtempSync as createTemporaryDirectorySync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { loadThemeRegistry } from '../src/index.js'

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
)
const builtInThemes = join(repositoryRoot, 'themes')
const temporaryDirectories = new Set<string>()

function mkdtempSync(prefix: string): string {
  const directory = createTemporaryDirectorySync(prefix)
  temporaryDirectories.add(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories)
    rmSync(directory, { recursive: true, force: true })
  temporaryDirectories.clear()
})

describe('theme registry', () => {
  it('loads every built-in theme and its unique Skill mapping', async () => {
    const registry = await loadThemeRegistry(builtInThemes)
    expect(registry.themes.map((theme) => theme.manifest.id)).toEqual([
      'slidev-theme-academy',
      'slidev-theme-eloc',
      'slidev-theme-landing',
      'slidev-theme-ledger',
      'slidev-theme-magazine',
      'slidev-theme-mumbo',
      'slidev-theme-narrative',
      'slidev-theme-nicodevs',
      'slidev-theme-nmt',
      'slidev-theme-nord',
      'slidev-theme-practicum',
      'slidev-theme-raft',
      'slidev-theme-sketchdeck',
      'slidev-theme-squircle',
      'slidev-theme-strategy',
      'slidev-theme-tahta',
      'slidev-theme-the-unnamed',
      'slidev-theme-touying',
      'slidev-theme-tud-db',
    ])
    expect(
      registry.resolve('slidev-theme-academy').manifest.skill,
    ).toMatchObject({
      id: 'fastppt-theme-academy',
      version: '0.1.22-fastppt.2',
    })
    expect(registry.resolve('slidev-theme-landing').manifest.skill.id).toBe(
      'fastppt-theme-landing',
    )
    expect(
      new Set(registry.themes.map((theme) => theme.manifest.skill.id)).size,
    ).toBe(registry.themes.length)
  })

  it('rejects duplicate theme IDs without hard-coding package names', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-theme-registry-'))
    cpSync(join(builtInThemes, 'slidev-theme-academy'), join(root, 'first'), {
      recursive: true,
    })
    cpSync(join(builtInThemes, 'slidev-theme-academy'), join(root, 'second'), {
      recursive: true,
    })
    await expect(loadThemeRegistry(root)).rejects.toMatchObject({
      code: 'DUPLICATE_THEME_ID',
    })
  })

  it('rejects path escape and Skill version mismatch before registration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-theme-registry-'))
    const packageRoot = join(root, 'theme')
    cpSync(join(builtInThemes, 'slidev-theme-landing'), packageRoot, {
      recursive: true,
    })
    const manifestPath = join(packageRoot, 'agent/theme-manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    manifest.rulesFile = '../outside.md'
    writeFileSync(manifestPath, JSON.stringify(manifest))
    await expect(loadThemeRegistry(root)).rejects.toMatchObject({
      code: 'INVALID_PATH',
    })

    manifest.rulesFile = 'agent/theme-rules.md'
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const skillPath = join(packageRoot, 'agent/SKILL.md')
    writeFileSync(
      skillPath,
      readFileSync(skillPath, 'utf8').replace('0.0.5-fastppt.1', '9.9.9'),
    )
    await expect(loadThemeRegistry(root)).rejects.toMatchObject({
      code: 'SKILL_MISMATCH',
    })
  })

  it('rejects symlink escape and versions rule/runtime changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-theme-registry-'))
    const packageRoot = join(root, 'theme')
    cpSync(join(builtInThemes, 'slidev-theme-academy'), packageRoot, {
      recursive: true,
    })
    const before = await loadThemeRegistry(root)
    appendFileSync(
      join(packageRoot, 'agent/theme-rules.md'),
      '\nA versioned rule change.\n',
    )
    const after = await loadThemeRegistry(root)
    expect(after.version).not.toBe(before.version)

    const outside = join(root, 'outside.md')
    writeFileSync(outside, 'outside')
    const rulesPath = join(packageRoot, 'agent/theme-rules.md')
    unlinkSync(rulesPath)
    symlinkSync(outside, rulesPath)
    await expect(loadThemeRegistry(root)).rejects.toMatchObject({
      code: 'INVALID_PATH',
    })
  })
})
