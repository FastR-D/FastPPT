import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ManagedSkillInstaller } from '@fastppt/fastppt-skill'
import { loadThemeRegistry, ThemeRulesDocumentSchema, themeRulesDigest } from '@fastppt/theme-registry'
import { WorkspaceService } from '@fastppt/workspace'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createFastPptMcpServer,
  FASTPPT_MCP_TOOL_NAMES,
  FastPptMcpService,
} from '../src/server.js'

import type {
  BrowserCaptureDelegate,
  ImageProductionDelegate,
} from '../src/server.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const themesRoot = resolve(packageRoot, '../../themes')
const commonSkillRoot = resolve(packageRoot, '../fastppt-skill')
const temporaryDirectories = new Set<string>()

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.add(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
  temporaryDirectories.clear()
})

async function fixture(
  options: {
    browserCapture?: BrowserCaptureDelegate
    imageProduction?: ImageProductionDelegate
    generatedImagesRoot?: string
    themesRoot?: string
    fetch?: typeof fetch
  } = {},
) {
  const workspaceRoot = await temporaryDirectory('fastppt-mcp-')
  await writeFile(
    join(workspaceRoot, 'slides.md'),
    `---
theme: slidev-theme-academy
title: MCP test
---

# Opening

Hello

---
layout: content
---

# Details

- One
- Two
`,
  )
  const [workspace, registry] = await Promise.all([
    WorkspaceService.create(workspaceRoot),
    loadThemeRegistry(themesRoot),
  ])
  await new ManagedSkillInstaller({
    workspaceRoot,
    commonSkillRoot,
    registry,
  }).reconcile()
  const service = new FastPptMcpService({
    workspace,
    workspaceName: 'fixture',
    registry,
    commonSkillRoot,
    themesRoot: options.themesRoot ?? themesRoot,
    extractorPath: resolve('extract-theme.mjs'),
    ...options,
  })
  return { workspaceRoot, service }
}

describe('FastPPT MCP', () => {
  it('resolves SVG href and CSS webfont assets even when a resource exceeds the inline source budget', async () => {
    // Image packs are installed separately. Exercise the real MCP/file boundary
    // with a local pack; this test resolves asset bytes, it does not render fonts.
    const pack = await temporaryDirectory('fastppt-resource-pack-')
    await mkdir(join(pack, 'pages'))
    await mkdir(join(pack, 'assets'))
    const markdown = '---\nlayout: none\n---\n<svg><image xlink:href="../assets/aa.svg"/></svg>\n<style>@font-face{src:url("../assets/bb.woff2")}</style>\n' + '<!-- source budget -->'.repeat(300)
    await writeFile(join(pack, 'pages/9a04224856b0-0134.md'), markdown)
    await writeFile(join(pack, 'assets/aa.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await writeFile(join(pack, 'assets/bb.woff2'), 'opaque asset bytes for path resolution')
    await writeFile(join(pack, 'index.json'), JSON.stringify({ version: 1, entries: [{ id: '9a04224856b0-0134', file: 'pages/9a04224856b0-0134.md' }] }))
    const previousRoot = process.env.FASTPPT_RESOURCES_ROOT
    let service: FastPptMcpService
    try {
      process.env.FASTPPT_RESOURCES_ROOT = pack
      service = (await fixture()).service
    } finally {
      if (previousRoot === undefined) delete process.env.FASTPPT_RESOURCES_ROOT
      else process.env.FASTPPT_RESOURCES_ROOT = previousRoot
    }
    const reference = await service.resources.read('9a04224856b0-0134')
    expect(reference).toBeDefined()
    const hrefs = [...reference!.markdown.matchAll(/xlink:href="(\.\.\/assets\/[^"<>]+)"/g)].map(match => match[1]!)
    expect(hrefs.length).toBeGreaterThan(0)
    const fonts = [...reference!.markdown.matchAll(/url\("(\.\.\/assets\/[a-f0-9]+\.woff2)"\)/g)].map(match => match[1]!)
    expect(fonts.length).toBeGreaterThan(0)
    const server = createFastPptMcpServer(service)
    const client = new Client({ name: 'resource-test', version: '0.1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const response = await client.callTool({ name: 'read_resource', arguments: { id: '9a04224856b0-0134', maxChars: 4000 } })
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true)
      const data = response.structuredContent as { markdown: string | null; sourceChars: number; assets: { reference: string; localPath: string }[] }
      expect(data.sourceChars).toBe(reference!.markdown.length)
      expect(data.markdown).toBeNull()
      for (const href of new Set([...hrefs, ...fonts])) expect(data.assets).toContainEqual({ reference: href, localPath: await service.resources.filePath(href.slice(3)) })
    } finally { await client.close(); await server.close() }
  })
  it('exposes machine rules and missing evidence without confusing absent, empty and available coverage', async () => {
    const { workspaceRoot } = await fixture()
    const copiedThemes = await temporaryDirectory('fastppt-rules-catalog-')
    const copiedTheme = join(copiedThemes, 'slidev-theme-academy')
    await cp(join(themesRoot, 'slidev-theme-academy'), copiedTheme, { recursive: true, filter: path => !path.split('/').includes('node_modules') })
    const manifestPath = join(copiedTheme, 'agent/theme-manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    delete manifest.machineRulesFile
    await writeFile(manifestPath, JSON.stringify(manifest))
    const workspace = await WorkspaceService.create(workspaceRoot)
    const createService = async () => new FastPptMcpService({ workspace, workspaceName: 'rules', registry: await loadThemeRegistry(copiedThemes), commonSkillRoot, themesRoot: copiedThemes, extractorPath: resolve('extract-theme.mjs') })
    await expect((await createService()).getThemeRules('slidev-theme-academy')).resolves.toMatchObject({ machineRules: null, machineRulesDigest: null, machineRulesStatus: 'absent', evidenceRequirements: [] })
    manifest.machineRulesFile = 'agent/constraints.json'
    await writeFile(manifestPath, JSON.stringify(manifest))
    const rulePath = join(copiedTheme, 'agent/constraints.json')
    const document = ThemeRulesDocumentSchema.parse({ version: 1, rules: [
      { id: 'cover.layout', kind: 'first-layout', layout: 'cover', severity: 'error' },
      { id: 'body.lines', kind: 'max-text-lines', value: 12, severity: 'error' },
      { id: 'brand.token', kind: 'required-token', token: '--brand-primary', severity: 'warning' },
    ] })
    await writeFile(rulePath, JSON.stringify(document))
    const withRules = await createService()
    const result = await withRules.getThemeRules('slidev-theme-academy')
    expect(result.rules).toContain('Academy theme rules')
    expect(result).toMatchObject({ machineRules: document, machineRulesDigest: themeRulesDigest(document), machineRulesSource: 'agent/constraints.json', machineRulesStatus: 'available', evidenceRequirements: [
      { ruleId: 'cover.layout', source: 'agent/constraints.json#cover.layout', authoring: 'compiled-structure', approval: 'catalog-structure', readback: { evidence: 'pptx-xml', providerAvailable: true } },
      { ruleId: 'body.lines', authoring: 'browser-measurement', approval: 'unverified', readback: { evidence: 'pptx-render', providerAvailable: false } },
      { ruleId: 'brand.token', readback: { evidence: 'output-token-mapping', providerAvailable: false } },
    ] })
    // An authoring response must not pair changed rules with the old theme lock.
    await writeFile(rulePath, JSON.stringify({ version: 1, rules: [] }))
    await expect(withRules.getThemeRules('slidev-theme-academy')).rejects.toThrow('changed after registration')
    await expect((await createService()).getThemeRules('slidev-theme-academy')).resolves.toMatchObject({ machineRulesStatus: 'empty', machineRules: { version: 1, rules: [] }, evidenceRequirements: [] })
    await writeFile(rulePath, '{invalid')
    await expect(withRules.getThemeRules('slidev-theme-academy')).rejects.toThrow()
  })

  it('exposes the complete stable tool catalog through the official protocol', async () => {
    const { service } = await fixture()
    const server = createFastPptMcpServer(service)
    const client = new Client({ name: 'fastppt-test', version: '0.1.0' })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...FASTPPT_MCP_TOOL_NAMES].sort(),
    )
    const themes = await client.callTool({ name: 'list_themes', arguments: {} })
    expect(
      z.object({ value: z.array(z.unknown()) }).parse(themes.structuredContent)
        .value,
    ).toHaveLength((await loadThemeRegistry(themesRoot)).themes.length)
    const skill = await client.callTool({
      name: 'get_theme_skill',
      arguments: { themeId: 'slidev-theme-academy', harness: 'claude' },
    })
    expect(skill.structuredContent).toMatchObject({
      skillId: 'fastppt-theme-academy',
      installation: { available: true },
    })
    await client.close()
    await server.close()
  })

  it('inspects stable-ID pages using the same fenced-code and notes grammar as Slidev', async () => {
    const { service, workspaceRoot } = await fixture()
    await writeFile(join(workspaceRoot, 'slides.md'), [
      '---', 'theme: slidev-theme-academy', 'fastpptId: first', '---',
      '# First', '```md', '---', '# Code example', '```', '',
      '---', 'fastpptId: second', 'layout: content', '---', '# Second',
      '<!--', 'Speaker notes', '---', 'Still notes', '-->',
    ].join('\r\n'))
    await expect(service.validateSlides()).resolves.toMatchObject({ slideCount: 2 })
    await expect(service.inspectSlide('slides.md', 2)).resolves.toMatchObject({ slide: 2, headings: ['Second'] })
    await expect(service.inspectSlide('slides.md', 3)).rejects.toThrow('does not exist')
  })

  it('reads, formats and validates a registered workspace deck', async () => {
    const { service } = await fixture()
    await expect(service.validateSlides()).resolves.toMatchObject({
      valid: true,
      themeId: 'slidev-theme-academy',
      themeSkillId: 'fastppt-theme-academy',
      slideCount: 2,
    })
    await expect(service.inspectSlide('slides.md', 2)).resolves.toMatchObject({
      slide: 2,
      headings: ['Details'],
    })
    const formatted = await service.formatSlides()
    expect(formatted).toMatchObject({
      path: 'slides.md',
      dryRun: false,
      written: false,
    })
    const preview = await service.formatSlides('slides.md', true)
    expect(preview).toMatchObject({
      path: 'slides.md',
      changed: false,
      dryRun: true,
      written: false,
    })
    await expect(service.listAssets()).resolves.toEqual({ assets: [] })
  })

  it('validates workspace assets referenced by native HTML images', async () => {
    const { workspaceRoot, service } = await fixture()
    const slides = await service.readSlides()
    await service.writeSlides({
      path: 'slides.md',
      expectedRevision: slides.revision,
      content: `${slides.content}\n\n<img src="./assets/missing.png" alt="Missing" />\n`,
    })
    const validation = await service.validateSlides()
    expect(validation.valid).toBe(false)
    expect(validation.errors).toContainEqual({
      code: 'ASSET_UNAVAILABLE',
      message: 'Asset cannot be resolved: ./assets/missing.png',
    })
    await mkdir(join(workspaceRoot, 'assets'), { recursive: true })
    await writeFile(
      join(workspaceRoot, 'assets', 'missing.png'),
      Buffer.from([0]),
    )
    await expect(service.validateSlides()).resolves.toMatchObject({
      valid: true,
    })
  })

  it('validates referenced images larger than the text read limit', async () => {
    const { workspaceRoot, service } = await fixture()
    const slides = await service.readSlides()
    await mkdir(join(workspaceRoot, 'assets'), { recursive: true })
    await writeFile(
      join(workspaceRoot, 'assets', 'large.jpg'),
      Buffer.alloc(2 * 1024 * 1024 + 1, 0xff),
    )
    await service.writeSlides({
      path: 'slides.md',
      expectedRevision: slides.revision,
      content: `${slides.content}\n\n![Large](./assets/large.jpg)\n`,
    })

    await expect(service.validateSlides()).resolves.toMatchObject({
      valid: true,
      errors: [],
    })
  })

  it('audits SVG assets before they are used in an editable delivery', async () => {
    const { workspaceRoot, service } = await fixture()
    await mkdir(join(workspaceRoot, 'assets'), { recursive: true })
    await writeFile(
      join(workspaceRoot, 'assets', 'portable.svg'),
      '<svg viewBox="0 0 24 24"><rect width="24" height="24"/><path d="M0 0h24"/></svg>',
    )
    await writeFile(
      join(workspaceRoot, 'assets', 'complex.svg'),
      '<svg><foreignObject><div>Browser-only label</div></foreignObject><animate attributeName="x"/></svg>',
    )
    await writeFile(
      join(workspaceRoot, 'assets', 'unsafe.svg'),
      '<svg><image href="https://example.test/image.png"/></svg>',
    )

    await expect(
      service.inspectSvgAsset('assets/portable.svg'),
    ).resolves.toMatchObject({
      valid: true,
      safeForWorkspace: true,
      recommendation: 'embed-vector',
      elements: { rect: 1, path: 1 },
      warnings: [],
    })
    const complex = await service.inspectSvgAsset('assets/complex.svg')
    expect(complex.safeForWorkspace).toBe(true)
    expect(complex.recommendation).toBe('rebuild-natively')
    expect(
      complex.warnings.some((warning) => warning.includes('foreignObject')),
    ).toBe(true)
    const unsafe = await service.inspectSvgAsset('assets/unsafe.svg')
    expect(unsafe.safeForWorkspace).toBe(false)
    expect(unsafe.recommendation).toBe('blocked')
    expect(
      unsafe.blockers.some((blocker) => blocker.includes('External SVG')),
    ).toBe(true)
    await expect(service.inspectSvgAsset('slides.md')).rejects.toThrow(
      'requires a .svg workspace file',
    )
  })

  it('rejects SVG assets with non-portable active or external resources', async () => {
    const { workspaceRoot, service } = await fixture()
    await mkdir(join(workspaceRoot, 'assets'), { recursive: true })
    await writeFile(
      join(workspaceRoot, 'assets', 'unsafe.svg'),
      '<svg><script>alert(1)</script></svg>',
    )
    const slides = await service.readSlides()
    await service.writeSlides({
      path: 'slides.md',
      expectedRevision: slides.revision,
      content: `${slides.content}\n\n![Unsafe](./assets/unsafe.svg)\n`,
    })

    const validation = await service.validateSlides()
    expect(validation.valid).toBe(false)
    expect(
      validation.errors.some((error) => error.code === 'SVG_ASSET_UNSAFE'),
    ).toBe(true)
  })

  it('imports Codex-generated images into exact workspace paths safely', async () => {
    const generatedImagesRoot = await temporaryDirectory(
      'codex-generated-images-',
    )
    const outsideRoot = await temporaryDirectory('outside-generated-images-')
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ])
    const source = join(generatedImagesRoot, 'figure.png')
    const outside = join(outsideRoot, 'outside.png')
    await Promise.all([writeFile(source, png), writeFile(outside, png)])
    const { workspaceRoot, service } = await fixture({ generatedImagesRoot })

    await expect(
      service.importGeneratedImage(
        source,
        'assets/generated/slide-03-mechanism.png',
      ),
    ).resolves.toMatchObject({
      path: 'assets/generated/slide-03-mechanism.png',
      mediaType: 'image/png',
    })
    await expect(
      readFile(join(workspaceRoot, 'assets/generated/slide-03-mechanism.png')),
    ).resolves.toEqual(png)
    await expect(
      service.importGeneratedImage(
        source,
        'assets/generated/slide-03-mechanism.png',
      ),
    ).rejects.toMatchObject({ code: 'FILE_REVISION_CONFLICT' })
    await expect(
      service.importGeneratedImage(outside, 'assets/generated/outside.png'),
    ).rejects.toThrow('Only images from the Codex generated_images directory')
    await expect(
      service.importGeneratedImage(source, '../escaped.png'),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
  })

  it('registers generated candidates against the requested deck and requires a decision', async () => {
    const generatedImagesRoot = await temporaryDirectory(
      'codex-generated-images-',
    )
    const source = join(generatedImagesRoot, 'figure.png')
    await writeFile(
      source,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
    const calls: Array<{ kind: string; value: unknown }> = []
    const imageProduction: ImageProductionDelegate = {
      createImageRun: (input) => {
        calls.push({ kind: 'run', value: input })
        return Promise.resolve({
          id: 'a5e00f76-40a0-4a4d-b9d7-43af6d736df7',
          status: 'draft',
        })
      },
      listImageRuns: () => Promise.resolve([]),
      listImageAssets: () => Promise.resolve([]),
      registerImageAsset: (input) => {
        calls.push({ kind: 'asset', value: input })
        return Promise.resolve({
          id: 'f22ff83b-9ebd-4d2c-8306-7c482e9f74d3',
          accepted: false,
        })
      },
      decideImageCandidate: (input) => {
        calls.push({ kind: 'decision', value: input })
        return Promise.resolve({ ...input, accepted: input.accepted })
      },
    }
    const { service } = await fixture({ generatedImagesRoot, imageProduction })
    const run = await service.createImageRun({
      path: 'slides.md',
      slide: 1,
      purpose: 'generate',
      prompt: 'A reviewable visual',
    })
    await service.importGeneratedImage(
      source,
      'assets/generated/slide-01-visual.png',
      String(run.id),
      'slides.md',
    )
    await service.decideImageCandidate({
      imageAssetId: 'f22ff83b-9ebd-4d2c-8306-7c482e9f74d3',
      accepted: true,
    })
    expect(calls).toEqual([
      expect.objectContaining({ kind: 'run' }),
      {
        kind: 'asset',
        value: {
          path: 'slides.md',
          destinationPath: 'assets/generated/slide-01-visual.png',
          runId: 'a5e00f76-40a0-4a4d-b9d7-43af6d736df7',
          source: 'generated',
        },
      },
      expect.objectContaining({
        kind: 'decision',
        value: {
          imageAssetId: 'f22ff83b-9ebd-4d2c-8306-7c482e9f74d3',
          accepted: true,
        },
      }),
    ])
  })

  it('downloads public HTTPS images into exact workspace paths safely', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ])
    const requested: string[] = []
    const registrations: unknown[] = []
    const imageProduction: ImageProductionDelegate = {
      createImageRun: () => Promise.resolve({}),
      listImageRuns: () => Promise.resolve([]),
      listImageAssets: () => Promise.resolve([]),
      registerImageAsset: (input) => {
        registrations.push(input)
        return Promise.resolve({ id: 'remote-asset' })
      },
      decideImageCandidate: () => Promise.resolve({}),
    }
    const { workspaceRoot, service } = await fixture({
      imageProduction,
      fetch: (input) => {
        requested.push(
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        )
        return Promise.resolve(
          new Response(png, {
            headers: { 'content-type': 'image/png' },
          }),
        )
      },
    })

    await expect(
      service.importRemoteImage(
        'https://images.example.org/chart.png',
        'assets/sources/slide-02-chart.png',
        undefined,
        'slides.md',
        'CC BY 4.0',
        'Example photographer',
      ),
    ).resolves.toMatchObject({
      path: 'assets/sources/slide-02-chart.png',
      mediaType: 'image/png',
    })
    expect(requested).toEqual(['https://images.example.org/chart.png'])
    expect(registrations).toEqual([
      {
        path: 'slides.md',
        destinationPath: 'assets/sources/slide-02-chart.png',
        source: 'remote',
        sourceUrl: 'https://images.example.org/chart.png',
        license: 'CC BY 4.0',
        attribution: 'Example photographer',
      },
    ])
    await expect(
      readFile(join(workspaceRoot, 'assets/sources/slide-02-chart.png')),
    ).resolves.toEqual(png)
    await expect(
      service.importRemoteImage(
        'http://images.example.org/chart.png',
        'assets/sources/insecure.png',
      ),
    ).rejects.toThrow('must use HTTPS')
    await expect(
      service.importRemoteImage(
        'https://127.0.0.1/chart.png',
        'assets/sources/private.png',
      ),
    ).rejects.toThrow('private network')
  })

  it('inspects rendered slide overflow through a managed preview', async () => {
    const browserCapture: BrowserCaptureDelegate = {
      inspectOverflow: (input) =>
        Promise.resolve({
          inspectionAvailable: true,
          overflow: true,
          slide: input.slide,
          slideCount: 2,
          viewport: { width: 980, height: 551 },
          scroll: { width: 980, height: 584 },
          overflowBy: { top: 0, right: 0, bottom: 33, left: 0 },
          elements: [
            {
              selector: 'p.summary',
              text: 'Overflowing summary',
              overflow: { top: 0, right: 0, bottom: 33, left: 0 },
            },
          ],
        }),
      exportEditablePptx: () => Promise.resolve({ status: 'completed' }),
      getPreviewStatus: () => Promise.resolve({ status: 'ready' }),
    }
    const { service } = await fixture({ browserCapture })

    await expect(
      service.inspectOverflow('slides.md', 2),
    ).resolves.toMatchObject({
      slide: 2,
      headings: ['Details'],
      inspectionAvailable: true,
      overflow: true,
      overflowBy: { bottom: 33 },
      elements: [{ selector: 'p.summary' }],
    })
  })

  it('keeps tool file access inside the fixed workspace', async () => {
    const { workspaceRoot, service } = await fixture()
    await writeFile(join(workspaceRoot, '.env'), 'SECRET=not-readable\n')
    await expect(service.readSlides('.env')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
    await expect(service.readSlides('../../etc/passwd')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
  })

  it('exports an editable PPTX through the managed preview and Slidewave workspace package', async () => {
    const browserCapture: BrowserCaptureDelegate = {
      inspectOverflow: () => Promise.resolve({ overflow: false }),
      getPreviewStatus: () => Promise.resolve({ status: 'ready' }),
      exportEditablePptx: async ({ outputName }) => {
        const path = join(
          await temporaryDirectory('fastppt-export-'),
          outputName,
        )
        await writeFile(path, 'editable pptx fixture')
        return {
          id: 'fixture-export',
          status: 'completed',
          path,
          outputName: 'Unsafe-.pptx',
          slideCount: 2,
          elementCount: 8,
        }
      },
    }
    const { service } = await fixture({ browserCapture })
    const server = createFastPptMcpServer(service)
    const client = new Client({ name: 'fastppt-export-test', version: '0.1.0' })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])
    const response = await client.callTool({
      name: 'export_editable_pptx',
      arguments: { path: 'slides.md', outputName: '../Unsafe?.pptx' },
    })
    const exported = z
      .object({
        status: z.literal('completed'),
        path: z.string(),
        outputName: z.string(),
        slideCount: z.number(),
        elementCount: z.number(),
      })
      .parse(response.structuredContent)
    expect(exported).toMatchObject({
      status: 'completed',
      outputName: 'Unsafe-.pptx',
      slideCount: 2,
      elementCount: 8,
    })
    await expect(readFile(exported.path, 'utf8')).resolves.toBe(
      'editable pptx fixture',
    )
    await client.close()
    await server.close()
    await service.dispose()
  })

  it('lists icon collections and searches icons through MCP tools', async () => {
    const { service } = await fixture()
    const server = createFastPptMcpServer(service)
    const client = new Client({ name: 'fastppt-test', version: '0.1.0' })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])
    const collections = await client.callTool({
      name: 'list_icon_collections',
      arguments: {},
    })
    const collectionList = z
      .object({
        value: z.array(z.object({ prefix: z.string(), total: z.number() })),
      })
      .parse(collections.structuredContent).value
    expect(collectionList.map((collection) => collection.prefix)).toEqual([
      'mdi',
      'ant-design',
    ])
    const search = await client.callTool({
      name: 'search_icons',
      arguments: { query: 'home', limit: 3 },
    })
    const results = z
      .object({
        value: z.array(
          z.object({ prefix: z.string(), name: z.string(), svg: z.string() }),
        ),
      })
      .parse(search.structuredContent).value
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.name).toBe('home')
    expect(results[0]?.svg).toContain('<svg')
    await client.close()
    await server.close()
    await service.dispose()
  })

  it('import_theme_from_pptx rejects paths outside the workspace', async () => {
    const { service } = await fixture()
    await expect(
      service.importThemeFromPptx('../../outside.pptx', 'blocked'),
    ).rejects.toThrow(/inside the workspace/)
    await service.dispose()
  })

  it('materializes harness-designed layouts and components into a theme', async () => {
    const fixtureThemes = await temporaryDirectory('fastppt-design-')
    const themeDir = join(fixtureThemes, 'slidev-theme-test')
    await mkdir(join(themeDir, 'agent'), { recursive: true })
    await mkdir(join(themeDir, 'styles'), { recursive: true })
    await writeFile(
      join(themeDir, 'package.json'),
      JSON.stringify({ name: 'slidev-theme-test', version: '0.1.0' }),
    )
    await writeFile(
      join(themeDir, 'styles', 'base.css'),
      ':root { --ext-primary: #123456; }\n',
    )
    await writeFile(
      join(themeDir, 'agent', 'theme-manifest.json'),
      JSON.stringify({
        id: 'slidev-theme-test',
        layouts: [{ id: 'default', label: 'Default' }],
      }),
    )
    await writeFile(
      join(themeDir, 'agent', 'SKILL.md'),
      '---\nname: fastppt-theme-test\ndescription: Test theme.\n---\n\n## Registered layouts\n\n- `default`\n',
    )
    const { service } = await fixture({ themesRoot: fixtureThemes })
    const result = await service.designThemeLayouts(
      'slidev-theme-test',
      [
        { id: 'data', label: '数据页', kind: 'data', hint: 'chart-heavy' },
        { id: 'metrics', label: '指标页', kind: 'metrics' },
      ],
      [{ name: 'StatCard', kind: 'stat' }],
    )
    expect(result.layouts.map((layout) => layout.id)).toEqual([
      'data',
      'metrics',
    ])
    expect(result.components).toEqual(['StatCard'])
    await expect(
      readFile(join(themeDir, 'layouts', 'data.vue'), 'utf8'),
    ).resolves.toContain('<slot />')
    await expect(
      readFile(join(themeDir, 'components', 'StatCard.vue'), 'utf8'),
    ).resolves.toContain('ext-stat-card')
    const manifest = JSON.parse(
      await readFile(join(themeDir, 'agent', 'theme-manifest.json'), 'utf8'),
    ) as { layouts: Array<{ id: string }> }
    expect(manifest.layouts.map((layout) => layout.id)).toContain('data')
    await expect(
      readFile(join(themeDir, 'agent', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('`data`: chart-heavy')
    await service.dispose()
  })

  it('compiles a complete agent design contract into portable theme sources', async () => {
    const fixtureThemes = await temporaryDirectory('fastppt-design-system-')
    const themeDir = join(fixtureThemes, 'slidev-theme-test')
    await mkdir(join(themeDir, 'agent'), { recursive: true })
    await mkdir(join(themeDir, 'styles'), { recursive: true })
    await writeFile(
      join(themeDir, 'package.json'),
      JSON.stringify({ name: 'slidev-theme-test', version: '0.1.0' }),
    )
    await writeFile(
      join(themeDir, 'styles', 'index.ts'),
      "import './base.css'\n",
    )
    await writeFile(join(themeDir, 'styles', 'base.css'), ':root {}\n')
    await writeFile(
      join(themeDir, 'agent', 'theme-manifest.json'),
      JSON.stringify({
        id: 'slidev-theme-test',
        layouts: [{ id: 'default', label: 'Default' }],
      }),
    )
    await writeFile(
      join(themeDir, 'agent', 'SKILL.md'),
      '---\nname: fastppt-theme-test\ndescription: Test theme.\n---\n\n## Registered layouts\n\n- `default`\n',
    )
    const { service, workspaceRoot } = await fixture({
      themesRoot: fixtureThemes,
    })
    const result = await service.designThemeSystem('slidev-theme-test', {
      motionPreset: 'business',
      version: 1,
      foundation: {
        colors: {
          canvas: '#FAF7F0',
          ink: '#172033',
          muted: '#667085',
          primary: '#4059D6',
          accent: '#E46A42',
          surface: '#FFFFFF',
          border: '#D9DEEA',
        },
        typography: { heading: 'Inter', body: 'Noto Sans SC' },
        geometry: {
          margin: '2.5rem',
          gap: '1.25rem',
          radius: '1rem',
          ruleWidth: '3px',
        },
      },
      components: [
        {
          name: 'InsightPanel',
          purpose: 'Pairs a concise conclusion with supporting evidence.',
          archetype: 'panel',
          variants: ['quiet'],
        },
      ],
      layouts: [
        {
          id: 'hero-media',
          label: 'Hero media',
          purpose: 'Open a chapter with a short narrative and dominant image.',
          composition: 'media-right',
          regions: ['content', 'media'],
          nativePlaceholders: [{ index: 0, type: 'title', x: 100, y: 200, width: 3000, height: 400, textStyle: { language: 'zh-Hant', alternativeLanguage: '', fontFamily: 'Inter', fontSize: 28, color: '223344', bold: true, paragraph: { bullet: { kind: 'character', character: '•' }, bulletFont: { kind: 'font', fontFamily: 'Symbol' }, bulletSize: { kind: 'percent', value: 80 }, bulletColor: { kind: 'text' }, marginLeft: 500, indent: -200, tabStops: [{ position: 800, align: 'decimal' }], decimalTab: { separator: ',', provenance: 'user-declared', reason: 'Author confirms comma alignment', targetProfile: 'libreoffice-7.3.7.2-linux-fr-FR' } } }, textBody: { insets: { left: 0, bottom: 100 }, verticalAlign: 'middle', wrap: false, autoFit: 'none' } }],
          nativeCanvas: { width: 10000, height: 5000 },
          nativeFixedObjects: [{ name: 'Brand', x: 1000, y: 500, width: 2000, height: 500, fill: '112233', text: 'Brand {{ literal }} <text>', language: 'de-DE', alternativeLanguage: '' }],
        },
      ],
      rules: {
        density: 'airy',
        imageTreatment: 'cropped editorial photography',
        maxColorsPerSlide: 3,
      },
    })
    expect(result.specFile).toBe('agent/theme-design.json')
    expect(JSON.parse(await readFile(join(themeDir, 'agent', 'native-layouts.json'), 'utf8'))).toEqual([{ name: 'hero-media', canvas: { width: 10000, height: 5000 }, fixedObjects: [{ name: 'Brand', x: 1000, y: 500, width: 2000, height: 500, fill: '112233', text: 'Brand {{ literal }} <text>', language: 'de-DE', alternativeLanguage: '', fontFamily: 'Noto Sans SC', fontSize: 12, color: '172033' }], placeholders: [{ index: 0, type: 'title', x: 100, y: 200, width: 3000, height: 400, textStyle: { language: 'zh-Hant', alternativeLanguage: '', fontFamily: 'Inter', fontSize: 28, color: '223344', bold: true, paragraph: { bullet: { kind: 'character', character: '•' }, bulletFont: { kind: 'font', fontFamily: 'Symbol' }, bulletSize: { kind: 'percent', value: 80 }, bulletColor: { kind: 'text' }, marginLeft: 500, indent: -200, tabStops: [{ position: 800, align: 'decimal' }], decimalTab: { separator: ',', provenance: 'user-declared', reason: 'Author confirms comma alignment', targetProfile: 'libreoffice-7.3.7.2-linux-fr-FR' } } }, textBody: { insets: { left: 0, bottom: 100 }, verticalAlign: 'middle', wrap: false, autoFit: 'none' } }] }])
    expect(result.layouts).toEqual([{ id: 'hero-media', label: 'Hero media' }])
    const browserLayout = await readFile(join(themeDir, 'layouts', 'hero-media.vue'), 'utf8')
    expect(browserLayout).toContain('data-fastppt-layout-object="Brand"')
    expect(browserLayout).toContain('left:10%;top:10%;width:20%;height:10%')
    expect(browserLayout).toContain('<div v-pre')
    expect(browserLayout).toContain('Brand {{ literal }} &lt;text&gt;')
    expect(browserLayout).toContain('font-family:&quot;Noto Sans SC&quot;')
    expect(browserLayout).toContain('color:#172033')
    await expect(
      readFile(join(themeDir, 'agent', 'theme-design.json'), 'utf8'),
    ).resolves.toContain('cropped editorial photography')
    await expect(
      readFile(join(themeDir, 'styles', 'agent-design-tokens.css'), 'utf8'),
    ).resolves.toContain('--fastppt-design-primary: #4059D6')
    await expect(
      readFile(join(themeDir, 'styles', 'index.ts'), 'utf8'),
    ).resolves.toContain("import './agent-design-tokens.css'")
    await expect(
      readFile(join(themeDir, 'layouts', 'hero-media.vue'), 'utf8'),
    ).resolves.toContain('slot name="media"')
    await expect(
      readFile(join(themeDir, 'components', 'InsightPanel.vue'), 'utf8'),
    ).resolves.toContain('fastppt-component-insight-panel')
    const manifest = JSON.parse(
      await readFile(join(themeDir, 'agent', 'theme-manifest.json'), 'utf8'),
    ) as { designSystem?: { specFile: string }; layouts: Array<{ id: string }> }
    expect(manifest).toMatchObject({ motionPreset: 'business' })
    expect(manifest.designSystem?.specFile).toBe('agent/theme-design.json')
    expect(manifest.layouts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'default' }),
        expect.objectContaining({ id: 'hero-media' }),
      ]),
    )
    await expect(
      readFile(join(themeDir, 'agent', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('## Design system')
    const sample = await service.createThemeDesignSamples('slidev-theme-test')
    expect(sample).toMatchObject({
      path: 'theme-samples/slidev-theme-test.md',
      slides: 5,
    })
    const sampleContent = await readFile(
      join(workspaceRoot, sample.path),
      'utf8',
    )
    expect(sampleContent).toContain('theme: slidev-theme-test')
    expect(sampleContent.match(/^layout:/gm)).toHaveLength(5)
    await expect(
      service.reviewThemeDesignSamples('slidev-theme-test'),
    ).resolves.toMatchObject({
      path: 'theme-samples/slidev-theme-test.md',
      reviewAvailable: false,
    })
    await service.dispose()
  })
})
