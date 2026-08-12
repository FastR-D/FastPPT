import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const packageRoot = new URL('..', import.meta.url)

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(new URL(directory, packageRoot), {
    withFileTypes: true,
  })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(`${relativePath}/`)
      return entry.name.endsWith('.ts') ? [relativePath] : []
    }),
  )
  return files.flat()
}

async function combinedSource(directory: string): Promise<string> {
  const files = await sourceFiles(directory)
  const sources = await Promise.all(
    files.map((file) => readFile(new URL(file, packageRoot), 'utf8')),
  )
  return sources.join('\n')
}

async function configuredSource(configName: string): Promise<string> {
  const config = JSON.parse(
    await readFile(new URL(configName, packageRoot), 'utf8'),
  ) as { include?: string[] }
  const files = (
    await Promise.all(
      (config.include ?? []).flatMap((entry) => {
        if (!entry.startsWith('src/')) return []
        if (entry.endsWith('/**/*.ts')) {
          return [sourceFiles(entry.slice(0, -'**/*.ts'.length))]
        }
        return entry.endsWith('.ts') ? [Promise.resolve([entry])] : []
      }),
    )
  ).flat()
  const sources = await Promise.all(
    files.map((file) => readFile(new URL(file, packageRoot), 'utf8')),
  )
  return sources.join('\n')
}

describe('Slidewave workspace package boundaries', () => {
  it('does not depend on FastPPT application packages', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('package.json', packageRoot), 'utf8'),
    ) as {
      name: string
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const source = await combinedSource('src/')
    expect(manifest.name).toBe('@fastppt/slidewave')
    expect(
      Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      }).every((name) => !name.startsWith('@fastppt/')),
    ).toBe(true)
    expect(source).not.toMatch(/from\s+['"]@fastppt\//)
  })

  it('uses the repository workspace instead of a nested project', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('package.json', packageRoot), 'utf8'),
    ) as Record<string, unknown>
    const packageEntries = await readdir(packageRoot)
    expect(manifest).not.toHaveProperty('packageManager')
    expect(packageEntries).not.toContain('pnpm-lock.yaml')
    expect(JSON.stringify(manifest)).not.toContain('slidewave-dev')
  })

  it('uses repository project references for integration boundaries', async () => {
    const rootConfig = JSON.parse(
      await readFile(new URL('tsconfig.json', packageRoot), 'utf8'),
    ) as { references?: Array<{ path: string }> }
    const strictConfig = await readFile(
      new URL('tsconfig.strict.json', packageRoot),
      'utf8',
    )
    const compatibilityConfig = JSON.parse(
      await readFile(new URL('tsconfig.core.json', packageRoot), 'utf8'),
    ) as { include?: string[] }

    expect(strictConfig).toContain('../../tsconfig.base.json')
    expect(rootConfig.references?.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        './tsconfig.contracts.json',
        './tsconfig.browser.json',
        './tsconfig.server.json',
        './tsconfig.core.json',
      ]),
    )
    expect(compatibilityConfig.include).not.toContain('src/**/*.ts')
    expect(compatibilityConfig.include).not.toContain('test/**/*.ts')
  })

  it('resolves every public entry directly from workspace source', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('package.json', packageRoot), 'utf8'),
    ) as {
      exports: Record<string, string>
    }
    expect(manifest.exports).toMatchObject({
      '.': './src/index.ts',
      './browser': './src/browser/index.ts',
      './browser/runtime': './src/browser/capture-runtime.ts',
      './snapshot': './src/snapshot.ts',
      './server': './src/server/index.ts',
    })
    expect(JSON.stringify(manifest.exports)).not.toContain('/dist/')
  })

  it('publishes every public entry from compiled output', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('package.json', packageRoot), 'utf8'),
    ) as {
      publishConfig: { access: string; exports: Record<string, string> }
    }
    expect(manifest.publishConfig.access).toBe('public')
    expect(manifest.publishConfig.exports).toMatchObject({
      '.': './dist/core.js',
      './browser': './dist/browser/index.js',
      './browser/runtime': './dist/browser/runtime.js',
      './snapshot': './dist/snapshot.js',
      './server': './dist/server/index.js',
    })
  })

  it('uses the server implementation as its type contract', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('package.json', packageRoot), 'utf8'),
    ) as {
      exports: Record<string, string>
    }
    const serverEntry = manifest.exports['./server']
    expect(serverEntry).toBe('./src/server/index.ts')
    await expect(
      readFile(new URL('src/server/public.ts', packageRoot), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('owns the snapshot validation contract used by consumers', async () => {
    const protocolSource = await readFile(
      new URL('../protocol/src/index.ts', packageRoot),
      'utf8',
    )
    expect(protocolSource).toContain("from '@fastppt/slidewave/snapshot'")
    expect(protocolSource).not.toContain('const SlidewaveBoxSchema')
  })

  it('keeps Node and Chromium runtimes out of browser code', async () => {
    const browserSource = `${await combinedSource('src/browser/')}\n${await configuredSource('tsconfig.browser.json')}`
    expect(browserSource).not.toMatch(
      /from\s+['"](?:node:|playwright|playwright-core|puppeteer)/,
    )
    expect(browserSource).not.toMatch(/from\s+['"]\.\.\/server\//)
  })

  it('does not expose the legacy combined browser-to-file export', async () => {
    const rootSource = await readFile(
      new URL('src/index.ts', packageRoot),
      'utf8',
    )
    const slidevSource = await readFile(
      new URL('src/slidev/index.ts', packageRoot),
      'utf8',
    )
    const manifest = await readFile(
      new URL('package.json', packageRoot),
      'utf8',
    )
    expect(rootSource).not.toMatch(/export\s+\*\s+from\s+['"]\.\/slidev/)
    expect(slidevSource).not.toMatch(/export\s+\*\s+from\s+['"]\.\/export/)
    await expect(
      readFile(new URL('src/slidev/export.ts', packageRoot), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(manifest).not.toContain('exportSlidevOverviewToPptx')
  })

  it('typechecks browser and server runtimes with separate platform libraries', async () => {
    const browserConfig = await readFile(
      new URL('tsconfig.browser.json', packageRoot),
      'utf8',
    )
    const serverConfig = await readFile(
      new URL('tsconfig.server.json', packageRoot),
      'utf8',
    )
    expect(browserConfig).toContain('"DOM"')
    expect(browserConfig).not.toContain('"node"')
    expect(serverConfig).toContain('"node"')
    expect(serverConfig).not.toContain('"DOM"')
  })

  it('emits project-reference metadata only into package build state', async () => {
    for (const configName of [
      'tsconfig.contracts.json',
      'tsconfig.core.json',
      'tsconfig.browser.json',
      'tsconfig.server.json',
    ]) {
      const config = await readFile(new URL(configName, packageRoot), 'utf8')
      expect(config).toContain('"composite": true')
      expect(config).toContain('"emitDeclarationOnly": true')
      expect(config).toContain('"outDir": ".tsbuild/')
    }
  })

  it('cleans generated output before rebuilding public entries', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('package.json', packageRoot), 'utf8'),
    ) as { scripts: { build: string } }
    expect(manifest.scripts.build).toMatch(/rmSync\(['"]dist['"]/)
  })

  it('keeps DOM capture and browser launchers out of server code', async () => {
    const serverSource = `${await combinedSource('src/server/')}\n${await configuredSource('tsconfig.server.json')}`
    expect(serverSource).not.toMatch(
      /from\s+['"](?:playwright|playwright-core|puppeteer)/,
    )
    expect(serverSource).not.toMatch(
      /from\s+['"]\.\.\/(?:browser|slidev\/capture)/,
    )
  })

  it('keeps FastPPT export orchestration out of the server conversion API', async () => {
    const serverSource = await combinedSource('src/server/')
    expect(serverSource).not.toMatch(
      /EditablePptxExporter|ExportJob|AbortSignal|onProgress|getStatus|EXPORT_(?:FAILED|CANCELLED|CAPTURE_TIMEOUT)/,
    )
  })

  it('keeps one conversion algorithm with a platform-specific Node backend', async () => {
    const renderSource = await readFile(
      new URL('src/slidev/render.ts', packageRoot),
      'utf8',
    )
    expect(renderSource).toContain("from '../server/presentation.js'")
    expect(renderSource).not.toContain('FastPPT')
    expect(renderSource.match(/function renderElement/g)).toHaveLength(1)
  })
})
