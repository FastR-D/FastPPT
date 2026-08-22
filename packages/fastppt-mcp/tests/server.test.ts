import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ManagedSkillInstaller } from '@fastppt/fastppt-skill'
import { loadThemeRegistry } from '@fastppt/theme-registry'
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

import type { BrowserCaptureDelegate } from '../src/server.js'

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
    await expect(service.validateSlides()).resolves.toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        expect.objectContaining({
          code: 'ASSET_UNAVAILABLE',
          message: 'Asset cannot be resolved: ./assets/missing.png',
        }),
      ]),
    })
    await mkdir(join(workspaceRoot, 'assets'), { recursive: true })
    await writeFile(join(workspaceRoot, 'assets', 'missing.png'), Buffer.from([0]))
    await expect(service.validateSlides()).resolves.toMatchObject({ valid: true })
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

  it('downloads public HTTPS images into exact workspace paths safely', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ])
    const requested: string[] = []
    const { workspaceRoot, service } = await fixture({
      fetch: (async (input: string | URL | Request) => {
        requested.push(String(input))
        return new Response(png, {
          headers: { 'content-type': 'image/png' },
        })
      }) as typeof fetch,
    })

    await expect(
      service.importRemoteImage(
        'https://images.example.org/chart.png',
        'assets/sources/slide-02-chart.png',
      ),
    ).resolves.toMatchObject({
      path: 'assets/sources/slide-02-chart.png',
      mediaType: 'image/png',
    })
    expect(requested).toEqual(['https://images.example.org/chart.png'])
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
      JSON.stringify({ id: 'slidev-theme-test', layouts: [] }),
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
    expect(result.layouts.map((layout) => layout.id)).toEqual(['data', 'metrics'])
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
})
