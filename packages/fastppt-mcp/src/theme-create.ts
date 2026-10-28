import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ThemeManifestSchema } from '@fastppt/theme-registry'
import { z } from 'zod'

import { designThemeSystem, ThemeDesignSpecSchema } from './theme-design.js'

export async function createTheme(input: {
  themesRoot: string
  themeId: string
  displayName: string
  design: z.input<typeof ThemeDesignSpecSchema>
}) {
  const themeId = z
    .string()
    .regex(/^slidev-theme-[a-z0-9-]+$/)
    .parse(input.themeId)
  const displayName = z.string().trim().min(1).max(120).parse(input.displayName)
  const design = ThemeDesignSpecSchema.parse(input.design)
  const themeDir = join(input.themesRoot, themeId)
  const skillId = themeId.replace(/^slidev-theme-/, 'fastppt-theme-')
  const manifest = ThemeManifestSchema.parse({
    id: themeId,
    packageName: themeId,
    displayName,
    version: '0.1.0',
    description: `${displayName} design system created with FastPPT`,
    repositoryUrl: 'https://github.com/FastR-D/FastPPT',
    rootDir: '.',
    rulesFile: 'agent/theme-rules.md',
    skill: { id: skillId, sourceDir: 'agent', version: '0.1.0' },
    layouts: [{ id: 'default', label: 'Default' }],
    defaultAspectRatio: '16/9',
    supportedFeatures: [],
  })
  await mkdir(input.themesRoot, { recursive: true })
  // Exclusive directory creation prevents replacement of existing user themes.
  await mkdir(themeDir)
  try {
    for (const directory of ['agent', 'styles', 'layouts'])
      await mkdir(join(themeDir, directory))
    await writeFile(
      join(themeDir, 'package.json'),
      `${JSON.stringify({ name: themeId, version: '0.1.0', type: 'module', keywords: ['slidev-theme'], slidev: { colorSchema: 'both' }, engines: { slidev: '>=52.0.0' } }, null, 2)}\n`,
    )
    await writeFile(
      join(themeDir, 'agent/theme-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    await writeFile(
      join(themeDir, 'agent/theme-rules.md'),
      '# Theme rules\n\nUse the compiled design system and review rendered samples.\n',
    )
    await writeFile(
      join(themeDir, 'agent/SKILL.md'),
      `---\nname: ${skillId}\nmetadata:\n  id: ${skillId}\n  version: 0.1.0\ndescription: Create, edit and review decks using ${themeId}.\n---\n\n# Theme authoring\n\nRead theme-rules.md and theme-design.json. Use registered layouts and preserve the design tokens.\n`,
    )
    await writeFile(join(themeDir, 'styles/index.ts'), '')
    await writeFile(
      join(themeDir, 'layouts/default.vue'),
      '<template>\n  <div class="slidev-layout"><slot /></div>\n</template>\n',
    )
    const compiled = await designThemeSystem({ themeDir, design })
    return { themeId, displayName, skillId, themeDir, ...compiled }
  } catch (cause) {
    await rm(themeDir, { recursive: true, force: true })
    throw cause
  }
}
