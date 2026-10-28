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

import {
  evaluateThemeRules,
  loadThemeRegistry,
  themeRuleEvidenceRequirements,
  ThemeRulesDocumentSchema,
} from '../src/index.js'

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
  it('loads only reviewed machine rules and leaves guidance-only themes absent', async () => {
    const registry = await loadThemeRegistry(builtInThemes)
    expect(
      registry.themes
        .filter((theme) => theme.machineRulesPath)
        .map((theme) => theme.manifest.id),
    ).toEqual([
      'slidev-theme-academy',
      'slidev-theme-crimson-violet',
      'slidev-theme-landing',
      'slidev-theme-whu-teaching',
      'slidev-theme-xiaomi',
    ])
    for (const id of [
      'slidev-theme-landing',
      'slidev-theme-academy',
      'slidev-theme-whu-teaching',
      'slidev-theme-crimson-violet',
      'slidev-theme-xiaomi',
    ]) {
      const theme = registry.resolve(id)
      expect(theme.machineRulesDigest).toMatch(/^[a-f0-9]{64}$/)
      const document = ThemeRulesDocumentSchema.parse(
        JSON.parse(readFileSync(theme.machineRulesPath!, 'utf8')),
      )
      expect(document.rules.length).toBeGreaterThan(0)
      expect(
        document.rules.every(
          (rule) =>
            rule.severity === 'warning' && rule.provenance === 'derived',
        ),
      ).toBe(true)
      expect(themeRuleEvidenceRequirements(document)).toEqual(
        document.rules.map((rule) => ({
          ruleId: rule.id,
          source: `agent/theme-rules.json#${rule.id}`,
          provenance: 'derived',
          authoring: 'compiled-structure',
          approval: 'not-applicable',
          readback: { evidence: 'pptx-xml', providerAvailable: true },
        })),
      )
      expect(
        evaluateThemeRules({
          document,
          phase: 'approval',
          slides: theme.manifest.layouts.map((layout, index) => ({
            index: index + 1,
            layout: layout.id,
          })),
        }),
      ).toEqual([])
      expect(
        evaluateThemeRules({
          document,
          phase: 'export',
          slides: [{ index: 1, layout: 'custom' }],
        }),
      ).toEqual([])
    }
  })
  it.each([
    ['crimson-violet', 'end'],
    ['xiaomi', 'ending'],
  ])(
    'checks %s positions without requiring a cover or closing page',
    async (name, closing) => {
      const registry = await loadThemeRegistry(builtInThemes)
      const theme = registry.resolve(`slidev-theme-${name}`)
      const document = ThemeRulesDocumentSchema.parse(
        JSON.parse(readFileSync(theme.machineRulesPath!, 'utf8')),
      )
      for (const phase of [
        'validate',
        'quality',
        'export',
        'readback',
      ] as const) {
        expect(
          evaluateThemeRules({
            document,
            phase,
            slides: [
              { index: 1, layout: 'cover' },
              { index: 2, layout: 'default' },
              { index: 3, layout: closing },
            ],
          }),
        ).toEqual([])
        expect(
          evaluateThemeRules({
            document,
            phase,
            slides: [{ index: 1, layout: 'custom' }],
          }),
        ).toEqual([])
        const issues = evaluateThemeRules({
          document,
          phase,
          slides: [
            { index: 1, layout: closing },
            { index: 2, layout: 'cover' },
            { index: 3, layout: 'custom' },
          ],
        })
        expect(issues.map(({ ruleId, slide }) => ({ ruleId, slide }))).toEqual(
          name === 'xiaomi'
            ? [{ ruleId: 'xiaomi.ending-position', slide: 1 }]
            : [
                { ruleId: `${name}.cover-position`, slide: 2 },
                { ruleId: `${name}.end-position`, slide: 1 },
              ],
        )
        for (const issue of issues)
          expect(issue).toMatchObject({
            code: 'THEME_RULE_LAYOUT_POSITION',
            severity: 'warning',
            status: 'violation',
          })
        const unavailable = evaluateThemeRules({
          document,
          phase,
          slides: [{ index: 1 }],
        })
        expect(unavailable).toHaveLength(document.rules.length)
        for (const issue of unavailable)
          expect(issue).toMatchObject({
            code: 'THEME_RULE_EVIDENCE_MISSING',
            status: 'unverified',
            severity:
              phase === 'export' || phase === 'readback'
                ? 'warning'
                : 'needs-human',
          })
      }
    },
  )
  it('loads every built-in theme and its unique Skill mapping', async () => {
    const registry = await loadThemeRegistry(builtInThemes)
    expect(registry.themes.map((theme) => theme.manifest.id)).toEqual([
      'slidev-theme-academy',
      'slidev-theme-crimson-violet',
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
      'slidev-theme-whu-teaching',
      'slidev-theme-xiaomi',
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

  it('versions native layout geometry without requiring a package version bump', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-native-layout-digest-'))
    const packageRoot = join(root, 'theme')
    cpSync(join(builtInThemes, 'slidev-theme-academy'), packageRoot, {
      recursive: true,
    })
    const nativePath = join(packageRoot, 'agent', 'native-layouts.json')
    const layout = {
      name: 'default',
      placeholders: [
        { index: 0, type: 'title', x: 100, y: 200, width: 3000, height: 400 },
      ],
    }
    writeFileSync(nativePath, JSON.stringify([layout]))
    const before = await loadThemeRegistry(root)
    layout.placeholders[0]!.x = 900
    writeFileSync(nativePath, JSON.stringify([layout]))
    const after = await loadThemeRegistry(root)
    expect(after.version).not.toBe(before.version)
    expect(after.resolve('slidev-theme-academy').contentDigest).not.toBe(
      before.resolve('slidev-theme-academy').contentDigest,
    )
    expect(after.resolve('slidev-theme-academy').manifest.version).toBe(
      before.resolve('slidev-theme-academy').manifest.version,
    )
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

  it('exposes a digest for machine-readable rules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fastppt-theme-rules-digest-'))
    const packageRoot = join(root, 'theme')
    cpSync(join(builtInThemes, 'slidev-theme-academy'), packageRoot, {
      recursive: true,
    })
    const manifestPath = join(packageRoot, 'agent', 'theme-manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    manifest.machineRulesFile = 'agent/theme-rules.json'
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(
      join(packageRoot, 'agent', 'theme-rules.json'),
      JSON.stringify({ version: 1, rules: [] }),
    )
    const registry = await loadThemeRegistry(root)
    expect(registry.resolve('slidev-theme-academy').machineRulesDigest).toMatch(
      /^[a-f0-9]{64}$/,
    )
  })
})
