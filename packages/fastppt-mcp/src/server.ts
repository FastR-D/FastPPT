import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, posix, resolve } from 'node:path'

import { listCollections, searchIcons } from '@fastppt/icons'
import { ManagedSkillInstaller } from '@fastppt/fastppt-skill'
import { formatSlidevMarkdown } from '@fastppt/markdown'
import { isContained, resolveExistingPath } from '@fastppt/workspace'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { ThemeRegistry } from '@fastppt/theme-registry'
import type { WorkspaceService } from '@fastppt/workspace'

export const FASTPPT_MCP_TOOL_NAMES = [
  'get_workspace',
  'list_themes',
  'get_theme_manifest',
  'get_theme_rules',
  'get_theme_skill',
  'read_slides',
  'write_slides',
  'format_slides',
  'validate_slides',
  'list_assets',
  'import_generated_image',
  'inspect_slide',
  'inspect_overflow',
  'get_preview_status',
  'export_editable_pptx',
  'list_icon_collections',
  'search_icons',
] as const

const DeckPathSchema = z.object({
  path: z.string().min(1).default('slides.md'),
})
const FormatSlidesInputSchema = DeckPathSchema.extend({
  dryRun: z.boolean().default(false),
})
const ThemeInputSchema = z.object({ themeId: z.string().min(1) })
const ThemeSkillInputSchema = ThemeInputSchema.extend({
  harness: z.enum(['claude', 'codex']),
})
const WriteSlidesInputSchema = DeckPathSchema.extend({
  content: z.string(),
  expectedRevision: z.string().min(1).optional(),
})
const SlideInputSchema = DeckPathSchema.extend({
  slide: z.number().int().positive(),
})
const ExportInputSchema = DeckPathSchema.extend({
  outputName: z.string().min(1).max(160).default('presentation.pptx'),
})
const IconSearchInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
  prefix: z.string().min(1).optional(),
})
const ImportGeneratedImageInputSchema = z.object({
  sourcePath: z.string().min(1),
  destinationPath: z.string().min(1),
})

const IMAGE_MEDIA_TYPES = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
} as const

export interface BrowserCaptureDelegate {
  inspectOverflow(input: {
    path: string
    slide: number
  }): Promise<Record<string, unknown>>
  exportEditablePptx(input: {
    path: string
    outputName: string
  }): Promise<Record<string, unknown>>
  getPreviewStatus(path: string): Promise<Record<string, unknown>>
}

export interface FastPptMcpServiceOptions {
  workspace: WorkspaceService
  workspaceName: string
  registry: ThemeRegistry
  commonSkillRoot: string
  browserCapture?: BrowserCaptureDelegate
  generatedImagesRoot?: string
}

function result(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent:
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : { value: data },
  }
}

function slideChunks(source: string): string[] {
  const delimiter = /\r?\n---\r?\n/g
  const chunks: string[] = []
  let start = 0
  let match: RegExpExecArray | null
  let inFrontmatter = source.startsWith('---\n') || source.startsWith('---\r\n')
  while ((match = delimiter.exec(source))) {
    if (inFrontmatter) {
      inFrontmatter = false
      continue
    }
    chunks.push(source.slice(start, match.index).trim())
    start = match.index + match[0].length
    const next = source.slice(start, source.indexOf('\n', start)).trim()
    inFrontmatter = /^(layout|class|clicks|background|transition):/.test(next)
  }
  chunks.push(source.slice(start).trim())
  return chunks.filter(Boolean)
}

function imagePaths(source: string): string[] {
  return [...source.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g)]
    .map((match) => match[1] ?? '')
    .filter((path) => path && !/^(?:https?:|data:)/.test(path))
}

export class FastPptMcpService {
  readonly #options: FastPptMcpServiceOptions
  readonly #installer: ManagedSkillInstaller
  readonly #browserCapture: BrowserCaptureDelegate | undefined
  readonly #generatedImagesRoot: string | undefined

  constructor(options: FastPptMcpServiceOptions) {
    this.#options = options
    this.#installer = new ManagedSkillInstaller({
      workspaceRoot: options.workspace.root,
      commonSkillRoot: options.commonSkillRoot,
      registry: options.registry,
    })
    this.#browserCapture = options.browserCapture
    this.#generatedImagesRoot = options.generatedImagesRoot
      ? resolve(options.generatedImagesRoot)
      : process.env.CODEX_HOME
        ? join(resolve(process.env.CODEX_HOME), 'generated_images')
        : process.env.HOME
          ? join(resolve(process.env.HOME), '.codex', 'generated_images')
          : undefined
  }

  getWorkspace() {
    return {
      name: this.#options.workspaceName,
      root: this.#options.workspace.root,
      registryVersion: this.#options.registry.version,
    }
  }

  listThemes() {
    return this.#options.registry.themes.map((theme) => ({
      ...theme.manifest,
      registryVersion: this.#options.registry.version,
      source: theme.packageRoot,
      contentDigest: theme.contentDigest,
    }))
  }

  async listIconCollections() {
    return listCollections()
  }

  async searchIcons(
    query: string,
    options?: { limit?: number; prefix?: string },
  ) {
    return searchIcons(query, options)
  }

  getThemeManifest(themeId: string) {
    const theme = this.#options.registry.resolve(themeId)
    return {
      ...theme.manifest,
      registryVersion: this.#options.registry.version,
      source: theme.packageRoot,
      contentDigest: theme.contentDigest,
    }
  }

  async getThemeRules(themeId: string) {
    const theme = this.#options.registry.resolve(themeId)
    return {
      themeId,
      skillId: theme.manifest.skill.id,
      skillVersion: theme.manifest.skill.version,
      rules: await readFile(theme.rulesPath, 'utf8'),
    }
  }

  async getThemeSkill(themeId: string, harness: 'claude' | 'codex') {
    const theme = this.#options.registry.resolve(themeId)
    return {
      themeId,
      skillId: theme.manifest.skill.id,
      version: theme.manifest.skill.version,
      source: theme.skillSourceDir,
      installation: await this.#installer.themeStatus(harness, themeId),
    }
  }

  readSlides(path = 'slides.md') {
    return this.#options.workspace.readTextFile(path)
  }

  writeSlides(input: z.infer<typeof WriteSlidesInputSchema>) {
    return this.#options.workspace.writeTextFile(input)
  }

  async formatSlides(path = 'slides.md', dryRun = false) {
    const file = await this.#options.workspace.readTextFile(path)
    const content = await formatSlidevMarkdown(file.content)
    const changed = content !== file.content
    if (dryRun || !changed)
      return {
        path: file.path,
        content,
        revision: file.revision,
        changed,
        dryRun,
        written: false,
      }
    const written = await this.#options.workspace.writeTextFile({
      path,
      content,
      expectedRevision: file.revision,
    })
    return {
      path: written.path,
      content: written.content,
      revision: written.revision,
      changed: true,
      dryRun: false,
      written: true,
    }
  }

  async validateSlides(path = 'slides.md') {
    const file = await this.#options.workspace.readTextFile(path)
    const errors: Array<{ code: string; message: string }> = []
    const themePackage = /^theme:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(
      file.content,
    )?.[1]
    const theme = this.#options.registry.themes.find(
      (entry) => entry.manifest.packageName === themePackage,
    )
    if (!theme)
      errors.push({
        code: 'THEME_UNAVAILABLE',
        message: `Deck theme is not registered: ${themePackage ?? '(missing)'}`,
      })
    const layouts = [
      ...file.content.matchAll(/^layout:\s*['"]?([^'"\s]+)['"]?\s*$/gm),
    ].map((match) => match[1] ?? '')
    if (theme) {
      const allowed = new Set(theme.manifest.layouts.map((layout) => layout.id))
      for (const layout of layouts)
        if (!allowed.has(layout))
          errors.push({
            code: 'LAYOUT_UNAVAILABLE',
            message: `Layout is not registered for ${theme.manifest.id}: ${layout}`,
          })
    }
    for (const asset of imagePaths(file.content)) {
      const relativeAsset = posix.normalize(
        posix.join(posix.dirname(path.replaceAll('\\', '/')), asset),
      )
      try {
        await this.#options.workspace.readTextFile(relativeAsset)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        if (!message.includes('Binary files cannot be read as text'))
          errors.push({
            code: 'ASSET_UNAVAILABLE',
            message: `Asset cannot be resolved: ${asset}`,
          })
      }
    }
    return {
      path,
      revision: file.revision,
      valid: errors.length === 0,
      themeId: theme?.manifest.id,
      themeSkillId: theme?.manifest.skill.id,
      slideCount: slideChunks(file.content).length,
      errors,
    }
  }

  async listAssets() {
    const nodes = await this.#options.workspace.listFiles()
    const flatten = (items: typeof nodes): string[] =>
      items.flatMap((node) =>
        node.type === 'directory'
          ? flatten(node.children ? [...node.children] : [])
          : /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(node.path)
            ? [node.path]
            : [],
      )
    return { assets: flatten(nodes) }
  }

  async importGeneratedImage(sourcePath: string, destinationPath: string) {
    if (!this.#generatedImagesRoot)
      throw new Error(
        'Codex generated image storage is unavailable; images cannot be imported.',
      )
    const generatedRoot = await realpath(this.#generatedImagesRoot)
    const source = await realpath(resolve(sourcePath))
    if (!isContained(generatedRoot, source))
      throw new Error(
        'Only images from the Codex generated_images directory may be imported.',
      )
    const metadata = await stat(source)
    if (!metadata.isFile())
      throw new Error('The generated image source is not a file.')
    const extension = extname(source).toLowerCase()
    const mediaType =
      IMAGE_MEDIA_TYPES[extension as keyof typeof IMAGE_MEDIA_TYPES]
    if (!mediaType)
      throw new Error('The generated image format is not supported.')
    return await this.#options.workspace.writeImageAsset({
      name: basename(destinationPath),
      mediaType,
      bytes: await readFile(source),
      destinationPath,
    })
  }

  async inspectSlide(path: string, slide: number) {
    const file = await this.#options.workspace.readTextFile(path)
    const chunks = slideChunks(file.content)
    const content = chunks[slide - 1]
    if (!content) throw new Error(`Slide ${slide} does not exist`)
    return {
      path,
      slide,
      content,
      characters: content.length,
      headings: [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map(
        (match) => match[1],
      ),
      images: imagePaths(content),
    }
  }

  async inspectOverflow(path: string, slide: number) {
    const inspection = await this.inspectSlide(path, slide)
    if (!this.#browserCapture)
      return {
        ...inspection,
        inspectionAvailable: false,
        overflow: 'unknown',
        message:
          'Rendered inspection requires an active FastPPT browser preview; the MCP server does not launch Chromium.',
      }
    return {
      ...inspection,
      ...(await this.#browserCapture.inspectOverflow({ path, slide })),
    }
  }

  async getPreviewStatus(path = 'slides.md') {
    return this.#browserCapture
      ? await this.#browserCapture.getPreviewStatus(path)
      : {
          path,
          status: 'unavailable',
          message:
            'Preview status requires the FastPPT Gateway browser delegation.',
        }
  }

  async exportEditablePptx(
    path = 'slides.md',
    outputName = 'presentation.pptx',
  ) {
    await resolveExistingPath(this.#options.workspace.root, path)
    if (!this.#browserCapture)
      throw new Error(
        'Editable PPTX export requires an active FastPPT browser preview; the MCP server does not launch Chromium.',
      )
    return await this.#browserCapture.exportEditablePptx({ path, outputName })
  }

  dispose(): Promise<void> {
    return Promise.resolve()
  }
}

export function createFastPptMcpServer(service: FastPptMcpService): McpServer {
  const server = new McpServer({ name: 'fastppt-mcp', version: '0.1.0' })
  server.registerTool(
    'get_workspace',
    { description: 'Get the fixed FastPPT workspace.' },
    () => result(service.getWorkspace()),
  )
  server.registerTool(
    'list_themes',
    { description: 'List registered themes and Skills.' },
    () => result(service.listThemes()),
  )
  server.registerTool(
    'get_theme_manifest',
    {
      description: 'Read one registered theme manifest.',
      inputSchema: ThemeInputSchema,
    },
    ({ themeId }) => result(service.getThemeManifest(themeId)),
  )
  server.registerTool(
    'get_theme_rules',
    {
      description: 'Read rules for one registered theme.',
      inputSchema: ThemeInputSchema,
    },
    async ({ themeId }) => result(await service.getThemeRules(themeId)),
  )
  server.registerTool(
    'get_theme_skill',
    {
      description: 'Read registered Skill identity and managed install status.',
      inputSchema: ThemeSkillInputSchema,
    },
    async ({ themeId, harness }) =>
      result(await service.getThemeSkill(themeId, harness)),
  )
  server.registerTool(
    'read_slides',
    {
      description: 'Read a workspace Slidev deck.',
      inputSchema: DeckPathSchema,
    },
    async ({ path }) => result(await service.readSlides(path)),
  )
  server.registerTool(
    'write_slides',
    {
      description: 'Atomically write a workspace Slidev deck.',
      inputSchema: WriteSlidesInputSchema,
    },
    async (input) => result(await service.writeSlides(input)),
  )
  server.registerTool(
    'format_slides',
    {
      description: 'Format or dry-run a Slidev deck.',
      inputSchema: FormatSlidesInputSchema,
    },
    async ({ path, dryRun }) =>
      result(await service.formatSlides(path, dryRun)),
  )
  server.registerTool(
    'validate_slides',
    {
      description: 'Validate theme, layouts and assets.',
      inputSchema: DeckPathSchema,
    },
    async ({ path }) => result(await service.validateSlides(path)),
  )
  server.registerTool(
    'list_assets',
    { description: 'List image assets in the workspace.' },
    async () => result(await service.listAssets()),
  )
  server.registerTool(
    'import_generated_image',
    {
      description:
        'Copy an image produced by Codex image_gen from its managed generated_images directory into an exact workspace-relative path. Existing files are never overwritten.',
      inputSchema: ImportGeneratedImageInputSchema,
    },
    async ({ sourcePath, destinationPath }) =>
      result(await service.importGeneratedImage(sourcePath, destinationPath)),
  )
  server.registerTool(
    'inspect_slide',
    {
      description: 'Inspect one slide structurally.',
      inputSchema: SlideInputSchema,
    },
    async ({ path, slide }) => result(await service.inspectSlide(path, slide)),
  )
  server.registerTool(
    'inspect_overflow',
    {
      description: 'Inspect overflow evidence for one slide.',
      inputSchema: SlideInputSchema,
    },
    async ({ path, slide }) =>
      result(await service.inspectOverflow(path, slide)),
  )
  server.registerTool(
    'get_preview_status',
    {
      description: 'Get the managed preview status for a deck.',
      inputSchema: DeckPathSchema,
    },
    ({ path }) => result(service.getPreviewStatus(path)),
  )
  server.registerTool(
    'export_editable_pptx',
    {
      description: 'Request editable PPTX export.',
      inputSchema: ExportInputSchema,
    },
    async ({ path, outputName }) =>
      result(await service.exportEditablePptx(path, outputName)),
  )
  server.registerTool(
    'list_icon_collections',
    {
      description: 'List installed icon collections and their icon counts.',
    },
    async () => result(await service.listIconCollections()),
  )
  server.registerTool(
    'search_icons',
    {
      description:
        'Search installed icon collections (mdi, ant-design) for a query ' +
        'and return canonical icon identifiers plus inline SVG markup.',
      inputSchema: IconSearchInputSchema,
    },
    async ({ query, limit, prefix }) =>
      result(
        await service.searchIcons(query, {
          ...(limit !== undefined ? { limit } : {}),
          ...(prefix !== undefined ? { prefix } : {}),
        }),
      ),
  )
  return server
}
