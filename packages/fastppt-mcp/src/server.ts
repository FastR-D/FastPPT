import { AnimationLibrary } from '@fastppt/animations'
import { ResourceLibrary, summarizeComposition } from '@fastppt/resources'
import { PaletteLibrary, PaletteSearchSchema } from '@fastppt/palettes'
import { access, readFile, realpath, stat } from 'node:fs/promises'
import { isIP } from 'node:net'
import { basename, extname, join, posix, resolve } from 'node:path'

import { listCollections, searchIcons } from '@fastppt/icons'
import { ManagedSkillInstaller } from '@fastppt/fastppt-skill'
import { formatSlidevMarkdown } from '@fastppt/markdown'
import { parseSlidevDocument } from '@fastppt/markdown/parser'
import { runThemeExtraction } from './theme-extraction.js'
import { createTheme } from './theme-create.js'
import {
  designThemeLayouts,
  designThemeSystem,
  themeDesignSampleDeck,
  themeDesignSamplePath,
  ThemeDesignSpecSchema,
} from './theme-design.js'
import { isContained, resolveExistingPath } from '@fastppt/workspace'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { ThemeRulesDocumentSchema, themeRulesDigest, themeRuleEvidenceRequirements, type ThemeRegistry } from '@fastppt/theme-registry'
import type { WorkspaceService } from '@fastppt/workspace'

export const FASTPPT_MCP_TOOL_NAMES = [
  'get_workspace',
  'list_themes',
  'get_theme_manifest',
  'get_theme_rules',
  'get_theme_skill',
  'import_theme_from_pptx',
  'create_theme',
  'design_theme_layouts',
  'design_theme_system',
  'create_theme_design_samples',
  'review_theme_design_samples',
  'read_slides',
  'write_slides',
  'format_slides',
  'validate_slides',
  'list_assets',
  'inspect_svg_asset',
  'create_image_run',
  'list_image_runs',
  'list_image_assets',
  'import_generated_image',
  'import_remote_image',
  'decide_image_candidate',
  'inspect_slide',
  'inspect_overflow',
  'inspect_quality',
  'get_quality_report',
  'get_preview_status',
  'export_editable_pptx',
  'list_icon_collections',
  'search_icons',
  'search_resources',
  'read_resource',
  'search_animations',
  'read_animation',
  'search_palettes',
  'read_palette',
] as const

const DeckPathSchema = z.object({
  path: z.string().min(1).default('slides.md'),
})
const FormatSlidesInputSchema = DeckPathSchema.extend({
  dryRun: z.boolean().default(false),
})
const ThemeInputSchema = z.object({ themeId: z.string().min(1) })
const THEME_ID = /^slidev-theme-[a-z0-9-]+$/
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
  deckPath: z.string().min(1).default('slides.md'),
  sourcePath: z.string().min(1),
  destinationPath: z.string().min(1),
  runId: z.string().uuid().optional(),
})
const ImportRemoteImageInputSchema = z.object({
  deckPath: z.string().min(1).default('slides.md'),
  url: z.string().url(),
  destinationPath: z.string().min(1),
  runId: z.string().uuid().optional(),
  license: z.string().trim().min(1).max(300),
  attribution: z.string().trim().min(1).max(1_000).optional(),
})
const CreateImageRunInputSchema = DeckPathSchema.extend({
  slide: z.number().int().positive(),
  purpose: z.enum(['generate', 'edit', 'variation']),
  prompt: z.string().trim().min(1).max(8_000),
  inputAssetIds: z.array(z.string().uuid()).max(8).optional(),
})
const ImageCandidateDecisionInputSchema = z.object({
  imageAssetId: z.string().uuid(),
  accepted: z.boolean(),
})
const SvgAssetInputSchema = z.object({
  path: z.string().min(1),
})

const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024

const IMAGE_MEDIA_TYPES = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
} as const
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[keyof typeof IMAGE_MEDIA_TYPES]

const SVG_NATIVE_ELEMENTS = [
  'circle',
  'ellipse',
  'line',
  'path',
  'polygon',
  'polyline',
  'rect',
  'text',
] as const

export interface SvgAssetInspection {
  path: string
  valid: boolean
  safeForWorkspace: boolean
  recommendation: 'embed-vector' | 'rebuild-natively' | 'blocked'
  elements: Record<string, number>
  blockers: string[]
  warnings: string[]
  nativeRebuildCandidates: string[]
}

function isImageMediaType(value: string): value is ImageMediaType {
  return (Object.values(IMAGE_MEDIA_TYPES) as readonly string[]).includes(value)
}

function svgElementCount(svg: string, name: string): number {
  return (svg.match(new RegExp(`<${name}(?:\\s|/|>)`, 'gi')) ?? []).length
}

function inspectSvgMarkup(path: string, svg: string): SvgAssetInspection {
  const blockers: string[] = []
  const warnings: string[] = []
  const elements: Record<(typeof SVG_NATIVE_ELEMENTS)[number], number> = {
    circle: svgElementCount(svg, 'circle'),
    ellipse: svgElementCount(svg, 'ellipse'),
    line: svgElementCount(svg, 'line'),
    path: svgElementCount(svg, 'path'),
    polygon: svgElementCount(svg, 'polygon'),
    polyline: svgElementCount(svg, 'polyline'),
    rect: svgElementCount(svg, 'rect'),
    text: svgElementCount(svg, 'text'),
  }
  const valid = /^\s*<svg(?:\s|>)/i.test(svg) && /<\/svg>\s*$/i.test(svg)
  if (!valid) blockers.push('The file must contain one complete SVG document.')
  if (/<(?:script|iframe|object|embed)\b/i.test(svg))
    blockers.push(
      'Active or embedded HTML content is not permitted in SVG assets.',
    )
  if (/\son[a-z]+\s*=/i.test(svg))
    blockers.push('SVG event-handler attributes are not permitted.')
  if (/\b(?:href|xlink:href)\s*=\s*["'](?:https?:)?\/\//i.test(svg))
    blockers.push('External SVG resources are not portable.')
  if (/\b(?:href|xlink:href)\s*=\s*["'](?:file:|\/)/i.test(svg))
    blockers.push('Absolute filesystem SVG resources are not permitted.')
  if (/<foreignObject\b/i.test(svg))
    warnings.push(
      'foreignObject is browser-specific; rebuild this content with native HTML or Slidev components.',
    )
  if (/<(?:animate|animateMotion|animateTransform|set)\b/i.test(svg))
    warnings.push('SVG animation is not preserved in editable PPTX export.')
  if (/<(?:filter|mask|clipPath|pattern)\b/i.test(svg))
    warnings.push(
      'SVG effects may not match PowerPoint; use a simpler vector or native Slidev composition.',
    )
  if (/<(?:image|use)\b/i.test(svg))
    warnings.push(
      'Referenced SVG content may not become editable PowerPoint objects.',
    )

  const nativeRebuildCandidates = SVG_NATIVE_ELEMENTS.filter(
    (name) => elements[name] > 0,
  )
  const safeForWorkspace = blockers.length === 0
  return {
    path,
    valid,
    safeForWorkspace,
    recommendation: !safeForWorkspace
      ? 'blocked'
      : warnings.length > 0
        ? 'rebuild-natively'
        : 'embed-vector',
    elements,
    blockers,
    warnings,
    nativeRebuildCandidates,
  }
}

export interface BrowserCaptureDelegate {
  inspectOverflow(input: {
    path: string
    slide: number
  }): Promise<Record<string, unknown>>
  inspectQuality?(input: {
    path: string
    slide: number
  }): Promise<Record<string, unknown>>
  getQualityReport?(path: string): Promise<Record<string, unknown>>
  exportEditablePptx(input: {
    path: string
    outputName: string
  }): Promise<Record<string, unknown>>
  getPreviewStatus(path: string): Promise<Record<string, unknown>>
}

export interface ImageProductionDelegate {
  createImageRun(input: {
    path: string
    slide: number
    purpose: 'generate' | 'edit' | 'variation'
    prompt: string
    inputAssetIds: string[]
  }): Promise<Record<string, unknown>>
  listImageRuns(path: string): Promise<Record<string, unknown>[]>
  listImageAssets(path: string): Promise<Record<string, unknown>[]>
  registerImageAsset(input: {
    path: string
    destinationPath: string
    runId?: string | undefined
    source: 'generated' | 'remote'
    sourceUrl?: string | undefined
    license?: string | undefined
    attribution?: string | undefined
  }): Promise<Record<string, unknown>>
  decideImageCandidate(input: {
    imageAssetId: string
    accepted: boolean
  }): Promise<Record<string, unknown>>
}

export interface FastPptMcpServiceOptions {
  workspace: WorkspaceService
  workspaceName: string
  registry: ThemeRegistry
  commonSkillRoot: string
  /** Directory that receives generated `slidev-theme-<slug>` packages. */
  themesRoot: string
  /** Absolute path to `scripts/extract-theme.mjs`. */
  extractorPath: string
  browserCapture?: BrowserCaptureDelegate
  imageProduction?: ImageProductionDelegate
  generatedImagesRoot?: string
  fetch?: typeof fetch
}

function assertPublicHttpsUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:')
    throw new Error('Remote images must use HTTPS.')
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  )
    throw new Error('Local and private network image URLs are not allowed.')
  const version = isIP(hostname)
  if (
    (version === 4 &&
      /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(
        hostname,
      )) ||
    (version === 6 &&
      /^(?:::1|fe[89ab][0-9a-f]:|f[cd][0-9a-f]{2}:)/i.test(hostname))
  )
    throw new Error('Local and private network image URLs are not allowed.')
  return url
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
  return parseSlidevDocument(source).map(slide => slide.raw)
}

function imagePaths(source: string): string[] {
  const markdown = [
    ...source.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g),
  ]
  const html = [...source.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
  return [...markdown, ...html]
    .map((match) => match[1] ?? '')
    .filter((path) => path && !/^(?:https?:|data:)/.test(path))
}

export class FastPptMcpService {
  readonly resources = new ResourceLibrary()
  readonly animations = new AnimationLibrary()
  readonly palettes = new PaletteLibrary()
  readonly #options: FastPptMcpServiceOptions
  readonly #installer: ManagedSkillInstaller
  readonly #browserCapture: BrowserCaptureDelegate | undefined
  readonly #imageProduction: ImageProductionDelegate | undefined
  readonly #generatedImagesRoot: string | undefined
  readonly #themesRoot: string
  readonly #extractorPath: string

  constructor(options: FastPptMcpServiceOptions) {
    this.#options = options
    this.#themesRoot = options.themesRoot
    this.#extractorPath = options.extractorPath
    this.#installer = new ManagedSkillInstaller({
      workspaceRoot: options.workspace.root,
      commonSkillRoot: options.commonSkillRoot,
      registry: options.registry,
    })
    this.#browserCapture = options.browserCapture
    this.#imageProduction = options.imageProduction
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
    const document = theme.machineRulesPath
      ? ThemeRulesDocumentSchema.parse(JSON.parse(await readFile(
          await resolveExistingPath(theme.packageRoot, theme.manifest.machineRulesFile!),
          'utf8',
        )))
      : null
    const digest = document ? themeRulesDigest(document) : null
    if (digest !== (theme.machineRulesDigest ?? null))
      throw new Error('Theme machine rules changed after registration. Reload the theme registry before authoring.')
    return {
      themeId,
      skillId: theme.manifest.skill.id,
      skillVersion: theme.manifest.skill.version,
      rules: await readFile(theme.rulesPath, 'utf8'),
      contentDigest: theme.contentDigest,
      machineRules: document,
      machineRulesDigest: digest,
      machineRulesSource: theme.manifest.machineRulesFile ?? null,
      machineRulesStatus: document ? document.rules.length ? 'available' : 'empty' : 'absent',
      evidenceRequirements: document ? themeRuleEvidenceRequirements(document).map(requirement => ({ ...requirement, source: `${theme.manifest.machineRulesFile}#${requirement.ruleId}` })) : [],
    }
  }

  async getThemeSkill(themeId: string, harness: 'claude' | 'codex') {
    const theme = this.#options.registry.resolve(themeId)
    return {
      themeId,
      skillId: theme.manifest.skill.id,
      version: theme.manifest.skill.version,
      source: theme.skillSourceDir,
      installation: await this.#installer.ensureTheme(harness, themeId),
    }
  }

  /** Extract a theme from a workspace PPTX and create a Slidev theme package. */
  async createTheme(themeId: string, displayName: string, design: z.input<typeof ThemeDesignSpecSchema>) {
    return createTheme({ themesRoot: this.#themesRoot, themeId, displayName, design })
  }

  async importThemeFromPptx(filePath: string, themeName?: string) {
    const absolute = resolve(this.#options.workspace.root, filePath)
    if (!isContained(this.#options.workspace.root, absolute)) {
      throw new Error('The PPTX file must be inside the workspace')
    }
    await stat(absolute)
    const { slug, themeDir } = await runThemeExtraction({
      pptxPath: absolute,
      ...(themeName !== undefined ? { themeName } : {}),
      themesRoot: this.#themesRoot,
      extractorPath: this.#extractorPath,
    })
    return {
      themeId: `slidev-theme-${slug}`,
      displayName: slug.charAt(0).toUpperCase() + slug.slice(1),
      packageName: `slidev-theme-${slug}`,
      skillId: `fastppt-theme-${slug}`,
      version: '0.1.0-extracted.1',
      slug,
      themeDir,
    }
  }

  /** Materialize a harness-designed set of layouts + components into a theme. */
  async designThemeLayouts(
    themeId: string,
    layouts: Array<{
      id: string
      label: string
      kind: string
      hint?: string | undefined
    }>,
    components: Array<{
      name: string
      kind: string
      hint?: string | undefined
    }>,
  ) {
    const themeDir = this.#themeDirectory(themeId)
    await access(join(themeDir, 'package.json'))
    return designThemeLayouts({ themeDir, layouts, components })
  }

  /** Compile an agent-authored design contract into a portable theme system. */
  async designThemeSystem(
    themeId: string,
    design: z.input<typeof ThemeDesignSpecSchema>,
  ) {
    const themeDir = this.#themeDirectory(themeId)
    await access(join(themeDir, 'package.json'))
    return designThemeSystem({ themeDir, design })
  }

  /** Write a five-slide visual-review deck for a compiled design system. */
  async createThemeDesignSamples(themeId: string) {
    const themeDir = this.#themeDirectory(themeId)
    const spec = ThemeDesignSpecSchema.parse(
      JSON.parse(
        await readFile(join(themeDir, 'agent', 'theme-design.json'), 'utf8'),
      ),
    )
    const path = themeDesignSamplePath(themeId)
    const written = await this.#options.workspace.writeTextFile({
      path,
      content: themeDesignSampleDeck(themeId, spec),
    })
    return { path: written.path, revision: written.revision, slides: 5 }
  }

  /**
   * Inspect all design fixtures only when the normal preview is already ready.
   * This avoids spawning browser-delegation jobs from a background harness with
   * no browser client available to complete them.
   */
  async reviewThemeDesignSamples(themeId: string) {
    this.#themeDirectory(themeId)
    const path = themeDesignSamplePath(themeId)
    await this.#options.workspace.readTextFile(path)
    const preview = await this.getPreviewStatus(path)
    if (preview.status !== 'ready')
      return {
        path,
        reviewAvailable: false,
        preview,
        message:
          'Open the theme sample deck in FastPPT Preview, then call this tool again.',
      }
    const slides: Array<{
      slide: number
      quality: unknown
      overflow: unknown
    }> = []
    for (let slide = 1; slide <= 5; slide++) {
      const quality = await this.inspectQuality(path, slide)
      const overflow = await this.inspectOverflow(path, slide)
      slides.push({ slide, quality, overflow })
    }
    return { path, reviewAvailable: true, slides }
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
        await this.#options.workspace.assertFileAvailable(relativeAsset)
        if (/\.svg$/i.test(relativeAsset)) {
          const inspection = await this.inspectSvgAsset(relativeAsset)
          for (const blocker of inspection.blockers)
            errors.push({
              code: 'SVG_ASSET_UNSAFE',
              message: `SVG asset cannot be used: ${asset}. ${blocker}`,
            })
        }
      } catch {
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

  async inspectSvgAsset(path: string): Promise<SvgAssetInspection> {
    if (!/\.svg$/i.test(path))
      throw new Error('SVG asset inspection requires a .svg workspace file.')
    const file = await this.#options.workspace.readTextFile(path)
    return inspectSvgMarkup(file.path, file.content)
  }

  async createImageRun(input: z.infer<typeof CreateImageRunInputSchema>) {
    if (!this.#imageProduction)
      throw new Error('Image production requires an active FastPPT Gateway.')
    return await this.#imageProduction.createImageRun({
      path: input.path,
      slide: input.slide,
      purpose: input.purpose,
      prompt: input.prompt,
      inputAssetIds: input.inputAssetIds ?? [],
    })
  }

  async listImageRuns(path = 'slides.md') {
    if (!this.#imageProduction)
      throw new Error('Image production requires an active FastPPT Gateway.')
    return { imageRuns: await this.#imageProduction.listImageRuns(path) }
  }

  async listImageAssets(path = 'slides.md') {
    if (!this.#imageProduction)
      throw new Error('Image production requires an active FastPPT Gateway.')
    return { imageAssets: await this.#imageProduction.listImageAssets(path) }
  }

  async importGeneratedImage(
    sourcePath: string,
    destinationPath: string,
    runId?: string,
    deckPath = 'slides.md',
  ) {
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
    const workspaceAsset = await this.#options.workspace.writeImageAsset({
      name: basename(destinationPath),
      mediaType,
      bytes: await readFile(source),
      destinationPath,
    })
    const imageAsset = this.#imageProduction
      ? await this.#imageProduction.registerImageAsset({
          path: deckPath,
          destinationPath: workspaceAsset.path,
          ...(runId ? { runId } : {}),
          source: 'generated',
        })
      : undefined
    return { ...workspaceAsset, ...(imageAsset ? { imageAsset } : {}) }
  }

  async importRemoteImage(
    url: string,
    destinationPath: string,
    runId?: string,
    deckPath = 'slides.md',
    license?: string,
    attribution?: string,
  ) {
    assertPublicHttpsUrl(url)
    const response = await (this.#options.fetch ?? fetch)(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: { accept: 'image/png,image/jpeg,image/gif,image/webp' },
    })
    if (!response.ok)
      throw new Error(
        `Remote image request failed with HTTP ${response.status}.`,
      )
    assertPublicHttpsUrl(response.url || url)
    const contentLength = Number(response.headers.get('content-length'))
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_REMOTE_IMAGE_BYTES
    )
      throw new Error('Remote image exceeds the 10 MiB limit.')
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0]
    if (!mediaType || !isImageMediaType(mediaType))
      throw new Error('Remote URL did not return a supported raster image.')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > MAX_REMOTE_IMAGE_BYTES)
      throw new Error('Remote image exceeds the 10 MiB limit.')
    const workspaceAsset = await this.#options.workspace.writeImageAsset({
      name: basename(destinationPath),
      mediaType,
      bytes,
      destinationPath,
    })
    const imageAsset = this.#imageProduction
      ? await this.#imageProduction.registerImageAsset({
          path: deckPath,
          destinationPath: workspaceAsset.path,
          ...(runId ? { runId } : {}),
          source: 'remote',
          sourceUrl: response.url || url,
          license,
          ...(attribution ? { attribution } : {}),
        })
      : undefined
    return { ...workspaceAsset, ...(imageAsset ? { imageAsset } : {}) }
  }

  async decideImageCandidate(
    input: z.infer<typeof ImageCandidateDecisionInputSchema>,
  ) {
    if (!this.#imageProduction)
      throw new Error('Image production requires an active FastPPT Gateway.')
    return await this.#imageProduction.decideImageCandidate(input)
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

  async inspectQuality(path: string, slide: number) {
    const inspection = await this.inspectSlide(path, slide)
    const browserCapture = this.#browserCapture
    if (!browserCapture?.inspectQuality)
      return {
        ...inspection,
        inspectionAvailable: false,
        message:
          'Rendered quality inspection requires an active FastPPT browser preview.',
      }
    return {
      ...inspection,
      ...(await browserCapture.inspectQuality({ path, slide })),
    }
  }

  async getQualityReport(path: string) {
    const browserCapture = this.#browserCapture
    if (!browserCapture?.getQualityReport)
      return { path, inspectionAvailable: false }
    return await browserCapture.getQualityReport(path)
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

  #themeDirectory(themeId: string): string {
    if (!THEME_ID.test(themeId)) throw new Error(`Invalid theme id: ${themeId}`)
    return join(this.#themesRoot, themeId)
  }
}

export function createFastPptMcpServer(service: FastPptMcpService): McpServer {
  const server = new McpServer({ name: 'fastppt-mcp', version: '0.1.0' })
  server.registerTool('create_theme', {
    description: 'Create a new Slidev theme from a complete design contract without a source PPTX. Existing themes are never overwritten.',
    inputSchema: { themeId: z.string().regex(THEME_ID), displayName: z.string().trim().min(1).max(120), design: ThemeDesignSpecSchema },
  }, async ({ themeId, displayName, design }) => result(await service.createTheme(themeId, displayName, design)))
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
      description: 'Read human guidance, machine rules, their digest and evidence requirements for one registered theme. Absence or an empty rule set is not a compliance result.',
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
    'import_theme_from_pptx',
    {
      description:
        'Extract a visual theme (palette, fonts, typography) from a workspace PPTX and create a Slidev theme under the themes folder.',
      inputSchema: {
        filePath: z
          .string()
          .describe('Workspace-relative path to the .pptx file'),
        themeName: z
          .string()
          .optional()
          .describe('Optional theme name; a slug is derived from it'),
      },
    },
    async ({ filePath, themeName }) =>
      result(await service.importThemeFromPptx(filePath, themeName)),
  )
  server.registerTool(
    'design_theme_layouts',
    {
      description:
        'Materialize a designed set of characteristic Slidev layouts and components into an imported theme. Use after importing a theme to add on-palette layouts and components.',
      inputSchema: {
        themeId: z
          .string()
          .describe('The imported theme id, e.g. slidev-theme-<slug>'),
        layouts: z
          .array(
            z.object({
              id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
              label: z.string(),
              kind: z.enum([
                'cover',
                'section',
                'two-col',
                'data',
                'statement',
                'image-right',
                'quote',
                'grid',
                'metrics',
                'agenda',
                'ending',
              ]),
              hint: z.string().optional(),
            }),
          )
          .optional()
          .describe('Characteristic layouts to add'),
        components: z
          .array(
            z.object({
              name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
              kind: z.enum(['stat', 'callout', 'badge', 'pill', 'chip']),
              hint: z.string().optional(),
            }),
          )
          .optional()
          .describe('Signature components to add'),
      },
    },
    async ({ themeId, layouts, components }) =>
      result(
        await service.designThemeLayouts(
          themeId,
          layouts ?? [],
          components ?? [],
        ),
      ),
  )
  server.registerTool(
    'design_theme_system',
    {
      description:
        'Compile an agent-designed visual system into a theme. Submit a structured design contract with palette, typography, geometry, signature components, and semantic layouts; the server generates safe token-based Vue/CSS sources and updates the Theme Skill.',
      inputSchema: {
        themeId: z
          .string()
          .describe('The imported theme id, e.g. slidev-theme-<slug>'),
        design: ThemeDesignSpecSchema.describe(
          'The complete, versioned design contract to materialize.',
        ),
      },
    },
    async ({ themeId, design }) =>
      result(await service.designThemeSystem(themeId, design)),
  )
  server.registerTool(
    'create_theme_design_samples',
    {
      description:
        'Create or refresh a five-slide workspace deck for visual review of a compiled theme design system. The deck exercises cover, narrative, metrics, media, and closing treatments and can be opened in the normal FastPPT preview.',
      inputSchema: {
        themeId: z
          .string()
          .describe('The theme id that already has agent/theme-design.json'),
      },
    },
    async ({ themeId }) =>
      result(await service.createThemeDesignSamples(themeId)),
  )
  server.registerTool(
    'review_theme_design_samples',
    {
      description:
        'Run quality and overflow inspections across the five generated theme-design samples. First open that sample deck in FastPPT Preview. Use returned issues to revise the design contract with design_theme_system.',
      inputSchema: {
        themeId: z
          .string()
          .describe(
            'The theme id whose generated sample deck should be reviewed',
          ),
      },
    },
    async ({ themeId }) =>
      result(await service.reviewThemeDesignSamples(themeId)),
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
    'inspect_svg_asset',
    {
      description:
        'Audit a workspace SVG for portable vector embedding versus a native Slidev rebuild. This does not claim SVG shapes are editable in PowerPoint.',
      inputSchema: SvgAssetInputSchema,
    },
    async ({ path }) => result(await service.inspectSvgAsset(path)),
  )
  server.registerTool(
    'create_image_run',
    {
      description:
        'Register the visual brief for one generated, edited, or varied image before producing a candidate.',
      inputSchema: CreateImageRunInputSchema,
    },
    async (input) => result(await service.createImageRun(input)),
  )
  server.registerTool(
    'list_image_runs',
    {
      description: 'List persistent image-production runs for a deck.',
      inputSchema: DeckPathSchema,
    },
    async ({ path }) => result(await service.listImageRuns(path)),
  )
  server.registerTool(
    'list_image_assets',
    {
      description:
        'List persistent generated and sourced image assets for a deck.',
      inputSchema: DeckPathSchema,
    },
    async ({ path }) => result(await service.listImageAssets(path)),
  )
  server.registerTool(
    'import_generated_image',
    {
      description:
        'Copy an image produced by Codex image_gen from its managed generated_images directory into an exact workspace-relative path. Existing files are never overwritten.',
      inputSchema: ImportGeneratedImageInputSchema,
    },
    async ({ deckPath, sourcePath, destinationPath, runId }) =>
      result(
        await service.importGeneratedImage(
          sourcePath,
          destinationPath,
          runId,
          deckPath,
        ),
      ),
  )
  server.registerTool(
    'import_remote_image',
    {
      description:
        'Download one publicly reachable HTTPS raster image into an exact workspace-relative path. Supports PNG, JPEG, GIF and WebP up to 10 MiB; existing files are never overwritten.',
      inputSchema: ImportRemoteImageInputSchema,
    },
    async ({ deckPath, url, destinationPath, runId, license, attribution }) =>
      result(
        await service.importRemoteImage(
          url,
          destinationPath,
          runId,
          deckPath,
          license,
          attribution,
        ),
      ),
  )
  server.registerTool(
    'decide_image_candidate',
    {
      description:
        'Accept or reject a registered image candidate. Only accepted candidates may be applied to the deck.',
      inputSchema: ImageCandidateDecisionInputSchema,
    },
    async (input) => result(await service.decideImageCandidate(input)),
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
    'inspect_quality',
    {
      description:
        'Run deterministic Pretext and DOM quality checks for one slide.',
      inputSchema: SlideInputSchema,
    },
    async ({ path, slide }) =>
      result(await service.inspectQuality(path, slide)),
  )
  server.registerTool(
    'get_quality_report',
    {
      description: 'Get the latest persisted quality report for a deck.',
      inputSchema: DeckPathSchema,
    },
    async ({ path }) => result(await service.getQualityReport(path)),
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
  server.registerTool('search_resources', {
    description: 'Search reusable Slidev page layouts and logic diagrams by slide purpose, relationship, density and keywords. Returns ranked summaries and conversion limitations; read candidates before composing with the active theme.',
    inputSchema: z.object({ query: z.string().max(2000).default(''), kind: z.enum(['layout', 'diagram']).optional(), density: z.enum(['airy', 'balanced', 'dense']).optional(), limit: z.number().int().min(1).max(20).default(6), offset: z.number().int().min(0).default(0) }),
  }, async (input) => result(await service.resources.search(input)))
  server.registerTool('read_resource', {
    description: 'Read one Slidev composition reference, its source/licensing and reconstruction warnings. Adapt its structure to the active theme; copy local assets into the deck and preserve factual content.',
    inputSchema: z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/), maxChars: z.number().int().min(4000).max(300000).default(60000) }),
  }, async ({ id, maxChars }) => {
    const value = await service.resources.read(id)
    if (!value) return { content: [{ type: 'text' as const, text: 'Resource not found' }], isError: true }
    const assets = [...value.markdown.matchAll(/(?:src|href|xlink:href)="(\.\.\/assets\/[^"<>]+)"/g), ...value.markdown.matchAll(/url\(["']?(\.\.\/assets\/[a-f0-9]+\.[a-z0-9]+)["']?\)/g)]
    const assetPaths = await Promise.all([...new Set(assets.map(match => match[1]!))].map(async path => ({ reference: path, localPath: await service.resources.filePath(path.slice(3)) })))
    const sourcePath = await service.resources.filePath(value.resource.file)
    const { searchText, ...resource } = value.resource
    void searchText
    return result({ resource, sourcePath, compositionPath: value.compositionPath, composition: value.composition ? summarizeComposition(value.composition) : null, compositionWarning: value.compositionWarning, sourceChars: value.markdown.length, markdown: value.markdown.length <= maxChars ? value.markdown : null,
      ...(value.markdown.length > maxChars ? { notice: 'Source exceeds response budget. Read sourcePath locally or request a larger maxChars. Do not treat a partial source as a complete page.' } : {}), assets: assetPaths })
  })
  server.registerTool('search_animations', {
    description: 'Find creative text/image/reveal/elastic/path/choreography effects. These are object motion references, not page layouts. Inspect candidates before binding effects to actual object anchors.',
    inputSchema: z.object({ query:z.string().max(2000).default(''),category:z.string().optional(),scope:z.enum(['object','multi-object']).optional(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(20).default(6) }),
  }, async input => result(await service.animations.search(input)))
  server.registerTool('read_animation', {
    description: 'Read a creative motion reference, native timing and browser limitations. Bind source targets explicitly to the destination object anchors; keep the existing theme and page. Do not insert the whole demo page unless requested.',
    inputSchema: z.object({id:z.string().regex(/^[a-f\d]{12}-\d{4}$/),maxChars:z.number().int().min(4000).max(300000).default(60000)}),
  }, async ({id,maxChars}) => {
    const value=await service.animations.read(id)
    if(!value)return {content:[{type:'text' as const,text:'Animation not found'}],isError:true}
    const sourcePath=await service.animations.filePath(value.resource.motionFile)
    return result({resource:value.resource,sourcePath,motion:JSON.stringify(value.motion).length<=maxChars?value.motion:null,notice:'Bind the selected motion targets to actual page anchors. Native timing exports via Slidewave; browser preview limits are listed in warnings.'})
  })
  server.registerTool('search_palettes', {
    description: 'Search sourced color palettes by mood, hue, design intent, source, scheme type and color count. Read candidates before assigning background/text/accent roles; preserve the confirmed theme unless recoloring is requested.',
    inputSchema: PaletteSearchSchema,
  }, async input => result(await service.palettes.search(input)))
  server.registerTool('read_palette', {
    description: 'Read exact palette hex colors, provenance and design tags. Verify text/background contrast for the chosen roles.',
    inputSchema: z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/) }),
  }, async ({ id }) => {
    const palette = await service.palettes.read(id)
    return palette ? result(palette) : { content: [{ type: 'text' as const, text: 'Palette not found' }], isError: true }
  })
  return server
}
