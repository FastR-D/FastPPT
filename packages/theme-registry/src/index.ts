import { createHash } from 'node:crypto'
import { constants, type Dirent } from 'node:fs'
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

export const ThemeLayoutSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
})

export const ThemeSkillManifestSchema = z.object({
  id: z.string().regex(/^fastppt-theme-[a-z0-9-]+$/),
  sourceDir: z.string().min(1),
  version: z.string().min(1),
})

export const ThemeFeatureSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
  description: z.string().min(1),
})

export const ThemeManifestSchema = z.object({
  id: z.string().regex(/^slidev-theme-[a-z0-9-]+$/),
  packageName: z.string().min(1),
  displayName: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  repositoryUrl: z.url(),
  rootDir: z.string().min(1),
  rulesFile: z.string().min(1),
  skill: ThemeSkillManifestSchema,
  layouts: z.array(ThemeLayoutSchema).min(1),
  defaultAspectRatio: z.string().min(1).optional(),
  supportedFeatures: z.array(ThemeFeatureSchema),
})

export type ThemeLayout = z.infer<typeof ThemeLayoutSchema>
export type ThemeSkillManifest = z.infer<typeof ThemeSkillManifestSchema>
export type ThemeFeature = z.infer<typeof ThemeFeatureSchema>
export type ThemeManifest = z.infer<typeof ThemeManifestSchema>

export interface RegisteredTheme {
  manifest: ThemeManifest
  contentDigest: string
  packageRoot: string
  manifestPath: string
  rulesPath: string
  skillSourceDir: string
  skillPath: string
}

const DIGEST_PATHS = [
  'agent',
  'assets',
  'components',
  'layouts',
  'plugins',
  'public',
  'setup',
  'styles',
  'utils',
] as const

async function addPathToDigest(
  packageRoot: string,
  relativePath: string,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  const absolutePath = resolve(packageRoot, relativePath)
  let entries: Dirent[]
  try {
    entries = await readdir(absolutePath, { withFileTypes: true })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    throw cause
  }
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const childPath = posix.join(relativePath, entry.name)
    if (entry.isSymbolicLink())
      throw new ThemeRegistryError(
        'INVALID_PATH',
        'Theme source may not contain symbolic links',
        {
          path: childPath,
        },
      )
    if (entry.isDirectory()) await addPathToDigest(packageRoot, childPath, hash)
    else if (entry.isFile()) {
      hash.update(childPath)
      hash.update(await readFile(resolve(packageRoot, childPath)))
    }
  }
}

async function computeContentDigest(packageRoot: string): Promise<string> {
  const hash = createHash('sha256')
  for (const relativePath of DIGEST_PATHS)
    await addPathToDigest(packageRoot, relativePath, hash)
  for (const relativePath of [
    'global-top.vue',
    'package.json',
    'uno.config.ts',
  ]) {
    try {
      hash.update(relativePath)
      hash.update(await readFile(resolve(packageRoot, relativePath)))
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
  }
  return hash.digest('base64url')
}

export class ThemeRegistryError extends Error {
  constructor(
    public readonly code:
      | 'THEME_NOT_FOUND'
      | 'INVALID_MANIFEST'
      | 'DUPLICATE_THEME_ID'
      | 'DUPLICATE_SKILL_ID'
      | 'INVALID_PATH'
      | 'PACKAGE_MISMATCH'
      | 'SKILL_MISMATCH'
      | 'LAYOUT_MISMATCH',
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ThemeRegistryError'
  }
}

interface SkillFrontmatter {
  name?: unknown
  description?: unknown
  id?: unknown
  version?: unknown
  metadata?: unknown
}

function skillIdentity(frontmatter: SkillFrontmatter): {
  id: unknown
  version: unknown
} {
  const metadata =
    frontmatter.metadata &&
    typeof frontmatter.metadata === 'object' &&
    !Array.isArray(frontmatter.metadata)
      ? (frontmatter.metadata as Record<string, unknown>)
      : undefined
  return {
    id: metadata?.id ?? frontmatter.id,
    version: metadata?.version ?? frontmatter.version,
  }
}

function assertRelativePosixPath(value: string, label: string): void {
  if (
    value.includes('\\') ||
    value.includes('\0') ||
    isAbsolute(value) ||
    posix.isAbsolute(value) ||
    posix.normalize(value) !== value ||
    value === '..' ||
    value.startsWith('../') ||
    value.includes('/../')
  )
    throw new ThemeRegistryError(
      'INVALID_PATH',
      `${label} must be a normalized POSIX relative path`,
      {
        path: value,
      },
    )
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== '..' &&
      !isAbsolute(pathFromRoot))
  )
}

async function resolveOwnedPath(
  packageRoot: string,
  value: string,
  label: string,
): Promise<string> {
  assertRelativePosixPath(value, label)
  const candidate = await realpath(resolve(packageRoot, value))
  if (!isWithin(packageRoot, candidate))
    throw new ThemeRegistryError(
      'INVALID_PATH',
      `${label} escapes its theme package`,
      {
        path: value,
      },
    )
  return candidate
}

function parseSkillFrontmatter(
  source: string,
  skillPath: string,
): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)
  if (!match)
    throw new ThemeRegistryError(
      'SKILL_MISMATCH',
      'Theme Skill is missing YAML frontmatter',
      {
        skillPath,
      },
    )
  const parsed = parseYaml(match[1] ?? '') as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new ThemeRegistryError(
      'SKILL_MISMATCH',
      'Theme Skill frontmatter must be an object',
      {
        skillPath,
      },
    )
  return parsed
}

async function loadTheme(packageRoot: string): Promise<RegisteredTheme> {
  const manifestPath = await resolveOwnedPath(
    packageRoot,
    'agent/theme-manifest.json',
    'manifest',
  )
  let manifest: ThemeManifest
  try {
    manifest = ThemeManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
    )
  } catch (cause) {
    throw new ThemeRegistryError(
      'INVALID_MANIFEST',
      'Theme manifest is invalid',
      {
        manifestPath,
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    )
  }

  assertRelativePosixPath(manifest.rootDir, 'rootDir')
  const declaredRoot = await resolveOwnedPath(
    packageRoot,
    manifest.rootDir,
    'rootDir',
  )
  if (declaredRoot !== packageRoot)
    throw new ThemeRegistryError(
      'INVALID_PATH',
      'rootDir must resolve to the theme package root',
      {
        themeId: manifest.id,
      },
    )

  const packageJsonPath = await resolveOwnedPath(
    packageRoot,
    'package.json',
    'package.json',
  )
  const packageJson = z
    .object({ name: z.string(), version: z.string() })
    .parse(JSON.parse(await readFile(packageJsonPath, 'utf8')) as unknown)
  if (
    packageJson.name !== manifest.packageName ||
    packageJson.version !== manifest.version ||
    manifest.version !== manifest.skill.version
  )
    throw new ThemeRegistryError(
      'PACKAGE_MISMATCH',
      'Theme package identity/version does not match its manifest',
      {
        themeId: manifest.id,
        packageName: packageJson.name,
        packageVersion: packageJson.version,
      },
    )

  const rulesPath = await resolveOwnedPath(
    packageRoot,
    manifest.rulesFile,
    'rulesFile',
  )
  const skillSourceDir = await resolveOwnedPath(
    packageRoot,
    manifest.skill.sourceDir,
    'skill.sourceDir',
  )
  const skillPath = await resolveOwnedPath(
    skillSourceDir,
    'SKILL.md',
    'SKILL.md',
  )
  await Promise.all([
    access(rulesPath, constants.R_OK),
    access(skillPath, constants.R_OK),
  ])

  const frontmatter = parseSkillFrontmatter(
    await readFile(skillPath, 'utf8'),
    skillPath,
  )
  const identity = skillIdentity(frontmatter)
  if (
    frontmatter.name !== manifest.skill.id ||
    typeof frontmatter.description !== 'string' ||
    frontmatter.description.trim() === '' ||
    identity.id !== manifest.skill.id ||
    identity.version !== manifest.skill.version
  )
    throw new ThemeRegistryError(
      'SKILL_MISMATCH',
      'Theme Skill identity/version does not match its manifest',
      {
        themeId: manifest.id,
        skillId: manifest.skill.id,
      },
    )

  const layoutIds = new Set<string>()
  for (const layout of manifest.layouts) {
    if (layoutIds.has(layout.id))
      throw new ThemeRegistryError(
        'LAYOUT_MISMATCH',
        'Theme manifest contains a duplicate layout',
        {
          themeId: manifest.id,
          layoutId: layout.id,
        },
      )
    layoutIds.add(layout.id)
    const layoutPath = await resolveOwnedPath(
      packageRoot,
      join('layouts', `${layout.id}.vue`),
      'layout',
    )
    if (!(await stat(layoutPath)).isFile())
      throw new ThemeRegistryError(
        'LAYOUT_MISMATCH',
        'Declared layout is not a file',
        {
          themeId: manifest.id,
          layoutId: layout.id,
        },
      )
  }

  return {
    manifest,
    contentDigest: await computeContentDigest(packageRoot),
    packageRoot,
    manifestPath,
    rulesPath,
    skillSourceDir,
    skillPath,
  }
}

export class ThemeRegistry {
  readonly version: string
  readonly themes: readonly RegisteredTheme[]
  readonly #byThemeId: ReadonlyMap<string, RegisteredTheme>

  constructor(themes: readonly RegisteredTheme[]) {
    this.themes = Object.freeze([...themes])
    this.#byThemeId = new Map(themes.map((theme) => [theme.manifest.id, theme]))
    this.version = createHash('sha256')
      .update(
        JSON.stringify(
          themes.map((theme) => ({
            manifest: theme.manifest,
            contentDigest: theme.contentDigest,
          })),
        ),
      )
      .digest('base64url')
  }

  get(themeId: string): RegisteredTheme | undefined {
    return this.#byThemeId.get(themeId)
  }

  resolve(themeId: string): RegisteredTheme {
    const theme = this.get(themeId)
    if (!theme)
      throw new ThemeRegistryError(
        'THEME_NOT_FOUND',
        `Unknown or unavailable theme: ${themeId}`,
        {
          themeId,
        },
      )
    return theme
  }
}

export async function loadThemeRegistry(
  themesRoot: string,
): Promise<ThemeRegistry> {
  const canonicalRoot = await realpath(themesRoot)
  const entries = (await readdir(canonicalRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
  const themes: RegisteredTheme[] = []
  const themeIds = new Set<string>()
  const skillIds = new Set<string>()

  for (const entry of entries) {
    const packageRoot = await realpath(join(canonicalRoot, entry.name))
    if (!isWithin(canonicalRoot, packageRoot))
      throw new ThemeRegistryError(
        'INVALID_PATH',
        'Theme package escapes the themes root',
        {
          package: entry.name,
        },
      )
    const theme = await loadTheme(packageRoot)
    if (themeIds.has(theme.manifest.id))
      throw new ThemeRegistryError(
        'DUPLICATE_THEME_ID',
        `Duplicate theme ID: ${theme.manifest.id}`,
      )
    if (skillIds.has(theme.manifest.skill.id))
      throw new ThemeRegistryError(
        'DUPLICATE_SKILL_ID',
        `Duplicate theme Skill ID: ${theme.manifest.skill.id}`,
      )
    themeIds.add(theme.manifest.id)
    skillIds.add(theme.manifest.skill.id)
    themes.push(theme)
  }

  return new ThemeRegistry(themes)
}
