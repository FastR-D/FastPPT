import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  cleanupStaleSlidevCaches,
  cleanupSlidevVirtualModules,
  probeSlidevEnvironment,
  SlidevHost,
} from '../src/index.js'

const temporaryRoots = new Set<string>()

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  temporaryRoots.add(root)
  return root
}

afterEach(() => {
  for (const root of temporaryRoots)
    rmSync(root, { recursive: true, force: true })
  temporaryRoots.clear()
})

const fakeServer = `
const http = require('node:http')
const port = Number(process.argv[1])
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end('<main>fake slidev</main>')
})
server.listen(port, '127.0.0.1', () => console.log('\\u001b[32mready\\u001b[0m'))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
`

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return !(
      cause instanceof Error &&
      'code' in cause &&
      cause.code === 'ESRCH'
    )
  }
}

describe('SlidevHost', () => {
  it('runs Slidev in development mode for preview and overview capture', () => {
    const runner = readFileSync(
      new URL('../runner.mjs', import.meta.url),
      'utf8',
    )
    expect(runner.match(/'dev'/g)).toHaveLength(2)
    expect(runner.match(/base: basePath/g)).toHaveLength(2)
    expect(runner).toContain("require.resolve('@slidev/cli/bin/slidev.mjs')")
    expect(runner).toContain('depth: 1')
    expect(runner).toContain('ignored: shouldIgnoreWatchPath')
    expect(runner).toContain("'@citation-js/core'")
    expect(runner).toContain("'@citation-js/name'")
    expect(runner).toContain('options.roots.push')
    const appSetup = readFileSync(
      new URL('../setup/main.ts', import.meta.url),
      'utf8',
    )
    expect(appSetup).toContain("'@fastppt/slidewave/browser/runtime'")
    expect(runner).not.toContain('force: true')
  })

  it('probes the installed Slidev CLI without starting a process', async () => {
    const status = await probeSlidevEnvironment()
    expect(status.status).toBe('available')
    expect(status.version).toMatch(/^@slidev\/cli /)
  })

  it('starts a deck with the installed default theme', async () => {
    const root = temporaryRoot('fastppt-slidev-default-')
    const cacheRoot = temporaryRoot('fastppt-slidev-cache-')
    const entryFile = join(root, 'slides.md')
    writeFileSync(entryFile, '# Default theme')
    const logs: string[] = []
    const host = new SlidevHost({
      cacheRoot,
      onLog: (entry) => logs.push(entry.message),
    })

    try {
      expect(
        await host.start({ deckId: 'default-theme', entryFile }),
      ).toMatchObject({
        status: 'ready',
      })
      expect(logs.join('\n')).not.toContain('Failed to resolve dependency')
    } finally {
      await host.close()
    }
  })

  it('deduplicates start, reports readiness, restarts and stops', async () => {
    const root = temporaryRoot('fastppt-slidev-host-')
    const cacheRoot = temporaryRoot('fastppt-slidev-cache-')
    const entryFile = join(root, 'slides.md')
    writeFileSync(entryFile, '# Test')
    const states: string[] = []
    const logs: string[] = []
    const commandInputs: string[] = []
    const cacheDirectories: string[] = []
    const host = new SlidevHost({
      commandFactory: (input, port, cacheDirectory) => {
        commandInputs.push(input.themePackageRoot ?? '')
        cacheDirectories.push(cacheDirectory)
        mkdirSync(cacheDirectory, { recursive: true })
        return {
          command: process.execPath,
          args: ['-e', fakeServer, String(port)],
          cwd: root,
        }
      },
      readyTimeoutMs: 3000,
      stopTimeoutMs: 1000,
      idleTimeoutMs: 30_000,
      onState: (state) => states.push(state.status),
      onLog: (entry) => logs.push(`${entry.stream}:${entry.message}`),
      cacheRoot,
    })

    const ready = await host.start({
      deckId: 'deck-1',
      entryFile,
      themePackageRoot: '/registered/theme',
    })
    expect(ready.status).toBe('ready')
    expect(ready.previewUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    expect(await host.start({ deckId: 'deck-1', entryFile })).toEqual(ready)

    const restarted = await host.restart('deck-1')
    expect(restarted.status).toBe('ready')
    expect(restarted.pid).not.toBe(ready.pid)
    expect(await host.stop('deck-1')).toEqual({
      deckId: 'deck-1',
      status: 'stopped',
    })
    expect(cacheDirectories).toHaveLength(2)
    expect(new Set(cacheDirectories)).toHaveLength(1)
    expect(cacheDirectories.every((directory) => !existsSync(directory))).toBe(
      true,
    )
    expect(processExists(restarted.pid as number)).toBe(false)
    expect(states).toEqual(
      expect.arrayContaining(['starting', 'ready', 'restarting', 'stopped']),
    )
    expect(commandInputs).toEqual(['/registered/theme', '/registered/theme'])
    expect(logs).toContain('stdout:ready')
    await host.close()
  })

  it('returns a normalized failure with ANSI-free output', async () => {
    const root = temporaryRoot('fastppt-slidev-host-')
    const cacheRoot = temporaryRoot('fastppt-slidev-cache-')
    const entryFile = join(root, 'slides.md')
    writeFileSync(entryFile, '# Broken')
    const host = new SlidevHost({
      commandFactory: () => ({
        command: process.execPath,
        args: [
          '-e',
          "console.error('\\u001b[31mbroken config\\u001b[0m'); process.exit(2)",
        ],
        cwd: root,
      }),
      readyTimeoutMs: 2000,
      cacheRoot,
    })

    const state = await host.start({ deckId: 'broken', entryFile })
    expect(state.status).toBe('failed')
    expect(state.lastError?.code).toBe('SLIDEV_EXITED')
    expect(state.lastError?.output).toContain('broken config')
    expect(state.lastError?.output?.join('')).not.toContain('\u001b')
    await host.close()
  })

  it('removes cache owners from dead processes and preserves live owners', async () => {
    const cacheRoot = temporaryRoot('fastppt-slidev-cache-')
    const stale = join(cacheRoot, 'pid-999999', 'stale-session')
    const live = join(cacheRoot, `pid-${String(process.pid)}`, 'live-session')
    const unknown = join(cacheRoot, 'future-layout')
    mkdirSync(stale, { recursive: true })
    mkdirSync(live, { recursive: true })
    mkdirSync(unknown, { recursive: true })

    await cleanupStaleSlidevCaches(cacheRoot)

    expect(existsSync(stale)).toBe(false)
    expect(existsSync(live)).toBe(true)
    expect(existsSync(unknown)).toBe(true)
  })

  it('removes only owned Slidev import-glob proxies without following symlinks', async () => {
    const root = temporaryRoot('fastppt-slidev-virtual-')
    const virtual = join(root, 'node_modules', '.slidev', 'virtual')
    mkdirSync(virtual, { recursive: true })
    writeFileSync(join(virtual, 'import-glob.0123456789.ts'), 'generated')
    writeFileSync(join(virtual, 'import-glob.abcdef0123.ts'), 'generated')
    writeFileSync(join(virtual, 'drawings.json'), 'user state')
    writeFileSync(join(virtual, 'import-glob.not-a-hash.ts'), 'user file')

    expect(await cleanupSlidevVirtualModules(root)).toBe(2)
    expect(existsSync(join(virtual, 'drawings.json'))).toBe(true)
    expect(existsSync(join(virtual, 'import-glob.not-a-hash.ts'))).toBe(true)

    const linkedRoot = temporaryRoot('fastppt-slidev-linked-')
    const outside = temporaryRoot('fastppt-slidev-outside-')
    const outsideVirtual = join(outside, '.slidev', 'virtual')
    mkdirSync(outsideVirtual, { recursive: true })
    const outsideProxy = join(outsideVirtual, 'import-glob.0123456789.ts')
    writeFileSync(outsideProxy, 'outside')
    symlinkSync(outside, join(linkedRoot, 'node_modules'), 'dir')

    expect(await cleanupSlidevVirtualModules(linkedRoot)).toBe(0)
    expect(existsSync(outsideProxy)).toBe(true)
  })
})
