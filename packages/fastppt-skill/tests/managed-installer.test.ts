import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadThemeRegistry } from '@fastppt/theme-registry'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ManagedSkillInstaller,
  McpConfigManager,
} from '../src/managed-installer.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const themesRoot = resolve(packageRoot, '../../themes')
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

describe('ManagedSkillInstaller', () => {
  it('plans and installs the base and every registered theme Skill for both Harnesses', async () => {
    const workspaceRoot = await temporaryDirectory('fastppt-skills-')
    const registry = await loadThemeRegistry(themesRoot)
    const installer = new ManagedSkillInstaller({
      workspaceRoot,
      commonSkillRoot: packageRoot,
      registry,
    })
    const dryRun = await installer.reconcile({ dryRun: true })
    const expectedStatusCount = (registry.themes.length + 1) * 2
    expect(dryRun.statuses).toHaveLength(expectedStatusCount)
    expect(dryRun.statuses.every((status) => status.state === 'missing')).toBe(
      true,
    )

    const installed = await installer.reconcile()
    expect(installed.statuses).toHaveLength(expectedStatusCount)
    expect(
      installed.statuses.every((status) => status.state === 'installed'),
    ).toBe(true)
    expect(
      installed.statuses.map((status) => `${status.harness}:${status.skillId}`),
    ).toEqual(
      expect.arrayContaining([
        'claude:fastppt',
        'claude:fastppt-theme-academy',
        'claude:fastppt-theme-landing',
        'codex:fastppt',
        'codex:fastppt-theme-academy',
        'codex:fastppt-theme-landing',
      ]),
    )
    await expect(
      installer.themeStatus('claude', 'slidev-theme-academy'),
    ).resolves.toMatchObject({
      available: true,
      skillId: 'fastppt-theme-academy',
    })
  })

  it('never overwrites a modified managed Skill or an unmanaged target', async () => {
    const workspaceRoot = await temporaryDirectory('fastppt-skills-')
    const registry = await loadThemeRegistry(themesRoot)
    const installer = new ManagedSkillInstaller({
      workspaceRoot,
      commonSkillRoot: packageRoot,
      registry,
    })
    await installer.reconcile()
    const managedPath = join(
      workspaceRoot,
      '.claude',
      'skills',
      'fastppt',
      'SKILL.md',
    )
    await writeFile(managedPath, 'user changed this managed file\n')
    const unmanagedPath = join(
      workspaceRoot,
      '.agents',
      'skills',
      'unmanaged-example',
    )
    await mkdir(unmanagedPath, { recursive: true })
    await writeFile(join(unmanagedPath, 'SKILL.md'), 'user owned\n')

    const statuses = await installer.inspect('claude')
    expect(
      statuses.find((status) => status.skillId === 'fastppt'),
    ).toMatchObject({
      state: 'conflict',
      managed: true,
    })
    await installer.reconcile()
    await expect(readFile(managedPath, 'utf8')).resolves.toBe(
      'user changed this managed file\n',
    )
    await expect(
      readFile(join(unmanagedPath, 'SKILL.md'), 'utf8'),
    ).resolves.toBe('user owned\n')
  })

  it('ignores files in Skill roots and reports file target conflicts', async () => {
    const workspaceRoot = await temporaryDirectory('fastppt-skills-files-')
    const claudeSkillsRoot = join(workspaceRoot, '.claude', 'skills')
    const codexSkillsRoot = join(workspaceRoot, '.agents', 'skills')
    await mkdir(claudeSkillsRoot, { recursive: true })
    await mkdir(codexSkillsRoot, { recursive: true })
    const settingsPath = join(claudeSkillsRoot, 'settings.json')
    await writeFile(settingsPath, '{"userOwned":true}\n')
    await writeFile(join(codexSkillsRoot, 'fastppt'), 'user owned file\n')

    const registry = await loadThemeRegistry(themesRoot)
    const report = await new ManagedSkillInstaller({
      workspaceRoot,
      commonSkillRoot: packageRoot,
      registry,
    }).reconcile({ dryRun: true })

    expect(
      report.statuses.find(
        (status) => status.harness === 'codex' && status.skillId === 'fastppt',
      ),
    ).toMatchObject({ state: 'conflict', managed: false })
    expect(report.staleManagedDirectories).toEqual([])
    await expect(readFile(settingsPath, 'utf8')).resolves.toBe(
      '{"userOwned":true}\n',
    )
  })

  it('installs a third registered theme without an installer code change', async () => {
    const fixtureThemes = await temporaryDirectory('fastppt-themes-')
    await cp(themesRoot, fixtureThemes, { recursive: true })
    const third = join(fixtureThemes, 'slidev-theme-fixture')
    await cp(join(themesRoot, 'slidev-theme-landing'), third, {
      recursive: true,
    })
    const packageJsonPath = join(third, 'package.json')
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      name: string
      version: string
    }
    packageJson.name = 'slidev-theme-fixture'
    await writeFile(
      packageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
    )
    const manifestPath = join(third, 'agent', 'theme-manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      id: string
      packageName: string
      displayName: string
      skill: { id: string }
    }
    manifest.id = 'slidev-theme-fixture'
    manifest.packageName = 'slidev-theme-fixture'
    manifest.displayName = 'Fixture theme'
    manifest.skill.id = 'fastppt-theme-fixture'
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const skillPath = join(third, 'agent', 'SKILL.md')
    await writeFile(
      skillPath,
      (await readFile(skillPath, 'utf8')).replaceAll(
        'fastppt-theme-landing',
        'fastppt-theme-fixture',
      ),
    )
    const workspaceRoot = await temporaryDirectory('fastppt-skills-')
    const registry = await loadThemeRegistry(fixtureThemes)
    const report = await new ManagedSkillInstaller({
      workspaceRoot,
      commonSkillRoot: packageRoot,
      registry,
    }).reconcile()
    expect(
      report.statuses.filter(
        (status) => status.skillId === 'fastppt-theme-fixture',
      ),
    ).toHaveLength(2)
  })

  it('cleans only unmodified stale managed Skills when explicitly requested', async () => {
    const workspaceRoot = await temporaryDirectory('fastppt-skills-')
    const fixtureThemes = await temporaryDirectory('fastppt-themes-')
    await cp(themesRoot, fixtureThemes, { recursive: true })
    const registry = await loadThemeRegistry(fixtureThemes)
    const installer = new ManagedSkillInstaller({
      workspaceRoot,
      commonSkillRoot: packageRoot,
      registry,
    })
    await installer.reconcile()
    const staleClean = join(
      workspaceRoot,
      '.claude',
      'skills',
      'fastppt-theme-landing',
    )
    const staleModified = join(
      workspaceRoot,
      '.agents',
      'skills',
      'fastppt-theme-landing',
    )
    await writeFile(join(staleModified, 'SKILL.md'), 'user modified\n')
    await rm(join(fixtureThemes, 'slidev-theme-landing'), {
      recursive: true,
      force: true,
    })
    const reducedRegistry = await loadThemeRegistry(fixtureThemes)
    const cleanup = await new ManagedSkillInstaller({
      workspaceRoot,
      commonSkillRoot: packageRoot,
      registry: reducedRegistry,
    }).reconcile({ cleanStale: true })

    expect(cleanup.cleanedStaleDirectories).toContain(staleClean)
    expect(cleanup.staleManagedDirectories).toContain(staleModified)
    await expect(
      readFile(join(staleModified, 'SKILL.md'), 'utf8'),
    ).resolves.toBe('user modified\n')
  })
})

describe('McpConfigManager', () => {
  it('merges managed MCP entries, preserves user servers and creates backups', async () => {
    const workspaceRoot = await temporaryDirectory('fastppt-mcp-config-')
    await writeFile(
      join(workspaceRoot, '.mcp.json'),
      `${JSON.stringify({ mcpServers: { user: { command: 'user-server' } } }, null, 2)}\n`,
    )
    await mkdir(join(workspaceRoot, '.codex'), { recursive: true })
    await writeFile(
      join(workspaceRoot, '.codex', 'config.toml'),
      'model = "user-choice"\n',
    )
    const manager = new McpConfigManager({
      workspaceRoot,
      themesRoot,
      serverEntry: '/stable/fastppt-mcp.ts',
      runtimeArgs: ['--import', '/stable/tsx-loader.mjs'],
      commonSkillRoot: packageRoot,
    })
    const statuses = await manager.reconcile()
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ harness: 'claude', state: 'pending-trust' }),
        expect.objectContaining({ harness: 'codex', state: 'pending-trust' }),
      ]),
    )
    const claude = JSON.parse(
      await readFile(join(workspaceRoot, '.mcp.json'), 'utf8'),
    ) as {
      mcpServers: Record<string, { command: string; args?: string[] }>
    }
    expect(claude.mcpServers.user?.command).toBe('user-server')
    expect(claude.mcpServers.fastppt?.command).toBe(process.execPath)
    expect(claude.mcpServers.fastppt?.args).toEqual(
      expect.arrayContaining([
        '--import',
        '/stable/tsx-loader.mjs',
        '/stable/fastppt-mcp.ts',
      ]),
    )
    const codex = await readFile(
      join(workspaceRoot, '.codex', 'config.toml'),
      'utf8',
    )
    expect(codex).toContain('model = "user-choice"')
    expect(codex).toContain('[mcp_servers.fastppt]')
    expect(
      (await readdir(workspaceRoot)).some((entry) =>
        entry.startsWith('.mcp.json.fastppt-backup-'),
      ),
    ).toBe(true)
    expect(
      (await readdir(join(workspaceRoot, '.codex'))).some((entry) =>
        entry.startsWith('config.toml.fastppt-backup-'),
      ),
    ).toBe(true)
  })

  it('migrates only legacy managed MCP entries away from dist', async () => {
    const workspaceRoot = await temporaryDirectory('fastppt-mcp-legacy-')
    const legacyEntry = '/repo/packages/fastppt-mcp/dist/cli.js'
    const legacyArgs = [
      legacyEntry,
      '--workspace',
      workspaceRoot,
      '--themes-root',
      '/repo/themes',
      '--common-skill-root',
      '/repo/packages/fastppt-skill',
    ]
    await writeFile(
      join(workspaceRoot, '.mcp.json'),
      `${JSON.stringify(
        {
          keep: true,
          mcpServers: {
            user: { command: 'user-server' },
            fastppt: { command: process.execPath, args: legacyArgs },
          },
        },
        null,
        2,
      )}\n`,
    )
    await mkdir(join(workspaceRoot, '.codex'), { recursive: true })
    await writeFile(
      join(workspaceRoot, '.codex', 'config.toml'),
      [
        'model = "user-choice"',
        '',
        '# BEGIN FASTPPT MCP',
        '[mcp_servers.fastppt]',
        `command = ${JSON.stringify(process.execPath)}`,
        `args = [${legacyArgs.map((value) => JSON.stringify(value)).join(', ')}]`,
        '# END FASTPPT MCP',
        '',
        '[unrelated]',
        'enabled = true',
        '',
      ].join('\n'),
    )
    const manager = new McpConfigManager({
      workspaceRoot,
      themesRoot,
      serverEntry: '/repo/packages/fastppt-mcp/src/cli.ts',
      runtimeArgs: ['--import', '/stable/tsx-loader.mjs'],
      commonSkillRoot: packageRoot,
    })

    const before = await Promise.all([
      manager.inspect('claude'),
      manager.inspect('codex'),
    ])
    expect(before).toEqual([
      expect.objectContaining({ state: 'conflict', managed: true }),
      expect.objectContaining({ state: 'conflict', managed: true }),
    ])
    const statuses = await manager.reconcile()
    expect(statuses.every((status) => status.state === 'pending-trust')).toBe(
      true,
    )

    const claudeSource = await readFile(
      join(workspaceRoot, '.mcp.json'),
      'utf8',
    )
    const claude = JSON.parse(claudeSource) as {
      keep: boolean
      mcpServers: Record<string, { command: string; args?: string[] }>
    }
    expect(claude.keep).toBe(true)
    expect(claude.mcpServers.user?.command).toBe('user-server')
    expect(claude.mcpServers.fastppt?.args).toEqual([
      '--import',
      '/stable/tsx-loader.mjs',
      '/repo/packages/fastppt-mcp/src/cli.ts',
      '--workspace',
      workspaceRoot,
      '--themes-root',
      themesRoot,
      '--common-skill-root',
      packageRoot,
    ])
    expect(claudeSource).not.toContain('/dist/')

    const codex = await readFile(
      join(workspaceRoot, '.codex', 'config.toml'),
      'utf8',
    )
    expect(codex).toContain('model = "user-choice"')
    expect(codex).toContain('[unrelated]')
    expect(codex).toContain('/repo/packages/fastppt-mcp/src/cli.ts')
    expect(codex).toContain('/stable/tsx-loader.mjs')
    expect(codex).not.toContain('/dist/')
  })

  it('migrates legacy source MCP entries with tsx runtime arguments', async () => {
    const workspaceRoot = await temporaryDirectory('fastppt-mcp-source-')
    const legacyEntry = '/repo/packages/fastppt-mcp/src/cli.ts'
    const legacyArgs = [
      '--require',
      '/repo/node_modules/tsx/dist/preflight.cjs',
      '--import',
      'file:///repo/node_modules/tsx/dist/loader.mjs',
      legacyEntry,
      '--workspace',
      workspaceRoot,
      '--themes-root',
      '/repo/themes',
      '--common-skill-root',
      '/repo/packages/fastppt-skill',
    ]
    await writeFile(
      join(workspaceRoot, '.mcp.json'),
      `${JSON.stringify(
        {
          mcpServers: {
            fastppt: { command: process.execPath, args: legacyArgs },
          },
        },
        null,
        2,
      )}\n`,
    )
    await mkdir(join(workspaceRoot, '.codex'), { recursive: true })
    await writeFile(
      join(workspaceRoot, '.codex', 'config.toml'),
      [
        '# BEGIN FASTPPT MCP',
        '[mcp_servers.fastppt]',
        `command = ${JSON.stringify(process.execPath)}`,
        `args = [${legacyArgs.map((value) => JSON.stringify(value)).join(', ')}]`,
        '# END FASTPPT MCP',
        '',
      ].join('\n'),
    )
    const manager = new McpConfigManager({
      workspaceRoot,
      themesRoot: '/package/dist/themes',
      serverEntry: '/package/dist/runtime/mcp-server.js',
      commonSkillRoot: '/package/dist/fastppt-skill',
    })

    await expect(manager.inspect('claude')).resolves.toMatchObject({
      state: 'conflict',
      managed: true,
    })
    await expect(manager.inspect('codex')).resolves.toMatchObject({
      state: 'conflict',
      managed: true,
    })
    const statuses = await manager.reconcile()

    expect(statuses).toEqual([
      expect.objectContaining({ state: 'pending-trust', managed: true }),
      expect.objectContaining({ state: 'pending-trust', managed: true }),
    ])
    await expect(
      readFile(join(workspaceRoot, '.mcp.json'), 'utf8'),
    ).resolves.not.toContain(legacyEntry)
    await expect(
      readFile(join(workspaceRoot, '.codex', 'config.toml'), 'utf8'),
    ).resolves.not.toContain(legacyEntry)
  })

  it('does not migrate user-defined fastppt MCP entries', async () => {
    const workspaceRoot = await temporaryDirectory('fastppt-mcp-user-')
    const customClaude = {
      mcpServers: {
        fastppt: { command: 'custom-fastppt', args: ['serve'] },
      },
    }
    await writeFile(
      join(workspaceRoot, '.mcp.json'),
      `${JSON.stringify(customClaude, null, 2)}\n`,
    )
    await mkdir(join(workspaceRoot, '.codex'), { recursive: true })
    const customCodex = [
      '# BEGIN FASTPPT MCP',
      '[mcp_servers.fastppt]',
      'command = "custom-fastppt"',
      'args = ["serve"]',
      '# END FASTPPT MCP',
      '',
    ].join('\n')
    await writeFile(join(workspaceRoot, '.codex', 'config.toml'), customCodex)
    const manager = new McpConfigManager({
      workspaceRoot,
      themesRoot,
      serverEntry: '/repo/packages/fastppt-mcp/src/cli.ts',
      runtimeArgs: ['--import', '/stable/tsx-loader.mjs'],
      commonSkillRoot: packageRoot,
    })

    const statuses = await manager.reconcile()
    expect(statuses).toEqual([
      expect.objectContaining({ state: 'conflict', managed: false }),
      expect.objectContaining({ state: 'conflict', managed: false }),
    ])
    await expect(
      readFile(join(workspaceRoot, '.mcp.json'), 'utf8'),
    ).resolves.toBe(`${JSON.stringify(customClaude, null, 2)}\n`)
    await expect(
      readFile(join(workspaceRoot, '.codex', 'config.toml'), 'utf8'),
    ).resolves.toBe(customCodex)
  })
})
