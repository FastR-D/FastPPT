import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadGatewayConfig, parseWorkspaceArgument } from '../src/index.js'

const temporaryDirectories = new Set<string>()

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'fastppt-config-'))
  temporaryDirectories.add(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories)
    rmSync(directory, { recursive: true, force: true })
  temporaryDirectories.clear()
})

describe('gateway config', () => {
  it('parses the workspace argument', () => {
    expect(parseWorkspaceArgument(['--workspace', '/tmp/deck'])).toBe(
      '/tmp/deck',
    )
    expect(parseWorkspaceArgument(['--workspace=/tmp/deck'])).toBe('/tmp/deck')
  })

  it('uses the current directory as the zero-config workspace', () => {
    const root = temporaryDirectory()
    const config = loadGatewayConfig([], root)
    expect(config.workspaceRoot).toBe(realpathSync(root))
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(4317)
    expect(config.allowedWebOrigins).toContain('https://fastppt.vercel.app')
    expect(config.themesRoot).toMatch(/\/themes$/)
    expect(config.maxConcurrentRunsPerHarness).toBe(1)
  })

  it('accepts an explicit workspace argument', () => {
    const root = temporaryDirectory()
    const config = loadGatewayConfig(['--workspace', root], '/')
    expect(config.workspaceRoot).toBe(realpathSync(root))
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(4317)
  })

  it('accepts an explicit packaged themes root', () => {
    const root = temporaryDirectory()
    const themesRoot = temporaryDirectory()
    const config = loadGatewayConfig([], root, { themesRoot })
    expect(config.themesRoot).toBe(realpathSync(themesRoot))
  })
})
