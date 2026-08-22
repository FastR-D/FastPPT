import { createHash, randomUUID } from 'node:crypto'
import {
  cp,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import {
  McpConfigStatusSchema,
  SkillInstallStatusSchema,
  ThemeSkillStatusSchema,
} from '@fastppt/protocol'
import { z } from 'zod'

import type {
  HarnessKind,
  McpConfigStatus,
  SkillInstallStatus,
  ThemeSkillStatus,
} from '@fastppt/protocol'
import type { ThemeRegistry } from '@fastppt/theme-registry'

const MARKER_FILE = '.fastppt-managed.json'
const COMMON_ENTRIES = [
  'SKILL.md',
  'agents',
  'examples',
  'references',
  'scripts',
] as const

const MarkerSchema = z.object({
  schemaVersion: z.literal(1),
  skillId: z.string(),
  version: z.string(),
  source: z.string(),
  sourceDigest: z.string(),
  installedDigest: z.string(),
  registryVersion: z.string(),
  installedAt: z.iso.datetime(),
})
type Marker = z.infer<typeof MarkerSchema>

interface SkillArtifact {
  id: string
  kind: 'base' | 'theme'
  themeId?: string
  version: string
  sourceDir: string
  entries?: readonly string[]
  registryVersion: string
}

export interface ManagedSkillInstallerOptions {
  workspaceRoot: string
  commonSkillRoot: string
  registry: ThemeRegistry
  enabled?: boolean
}

export interface SkillInstallReport {
  dryRun: boolean
  enabled: boolean
  registryVersion: string
  statuses: SkillInstallStatus[]
  staleManagedDirectories: string[]
  cleanedStaleDirectories: string[]
}

export interface McpConfigManagerOptions {
  workspaceRoot: string
  serverEntry: string
  runtimeArgs?: readonly string[]
  themesRoot: string
  commonSkillRoot: string
}

function rootForHarness(workspaceRoot: string, harness: HarnessKind): string {
  return join(
    workspaceRoot,
    harness === 'claude' ? '.claude' : '.agents',
    'skills',
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
}

async function digestDirectory(
  root: string,
  entries?: readonly string[],
): Promise<string> {
  const hash = createHash('sha256')
  const visit = async (absolute: string, relative: string): Promise<void> => {
    const stats = await lstat(absolute)
    if (stats.isSymbolicLink())
      throw new Error(`Skill contains a symlink: ${relative}`)
    if (stats.isDirectory()) {
      const children = (await readdir(absolute)).sort()
      for (const child of children) {
        if (child === MARKER_FILE) continue
        await visit(join(absolute, child), join(relative, child))
      }
      return
    }
    if (!stats.isFile()) return
    hash.update(relative.replaceAll('\\', '/'))
    hash.update(await readFile(absolute))
  }
  for (const entry of entries ?? (await readdir(root)).sort()) {
    if (entry === MARKER_FILE) continue
    const absolute = join(root, entry)
    if (await exists(absolute)) await visit(absolute, entry)
  }
  return hash.digest('base64url')
}

async function readMarker(target: string): Promise<Marker | undefined> {
  try {
    return MarkerSchema.parse(
      JSON.parse(await readFile(join(target, MARKER_FILE), 'utf8')) as unknown,
    )
  } catch (cause) {
    if (
      ['ENOENT', 'ENOTDIR'].includes(
        (cause as NodeJS.ErrnoException).code ?? '',
      )
    )
      return undefined
    if (cause instanceof SyntaxError || cause instanceof z.ZodError)
      return undefined
    throw cause
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`,
  )
  await writeFile(temporary, content, { mode: 0o600 })
  await rename(temporary, path)
}

async function backup(path: string): Promise<void> {
  if (!(await exists(path))) return
  const suffix = new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replaceAll('.', '-')
  await copyFile(path, `${path}.fastppt-backup-${suffix}`)
}

export class ManagedSkillInstaller {
  readonly #workspaceRoot: string
  readonly #commonSkillRoot: string
  readonly #registry: ThemeRegistry
  readonly #enabled: boolean

  constructor(options: ManagedSkillInstallerOptions) {
    this.#workspaceRoot = resolve(options.workspaceRoot)
    this.#commonSkillRoot = resolve(options.commonSkillRoot)
    this.#registry = options.registry
    this.#enabled = options.enabled ?? true
  }

  async inspect(harness: HarnessKind): Promise<SkillInstallStatus[]> {
    return await Promise.all(
      this.#artifacts().map((artifact) =>
        this.#inspectArtifact(harness, artifact),
      ),
    )
  }

  async themeStatus(
    harness: HarnessKind,
    themeId: string,
  ): Promise<ThemeSkillStatus> {
    const theme = this.#registry.resolve(themeId).manifest
    const statuses = await this.inspect(harness)
    const base = statuses.find((status) => status.kind === 'base')
    const themeSkill = statuses.find((status) => status.themeId === themeId)
    if (!base || !themeSkill)
      throw new Error(`Missing install plan for ${themeId}`)
    return ThemeSkillStatusSchema.parse({
      harness,
      themeId,
      skillId: theme.skill.id,
      version: theme.skill.version,
      base,
      theme: themeSkill,
      available: base.state === 'installed' && themeSkill.state === 'installed',
    })
  }

  async reconcile(
    options: { dryRun?: boolean; cleanStale?: boolean } = {},
  ): Promise<SkillInstallReport> {
    const dryRun = options.dryRun ?? false
    const statuses: SkillInstallStatus[] = []
    for (const harness of ['claude', 'codex'] as const) {
      for (const artifact of this.#artifacts()) {
        let status = await this.#inspectArtifact(harness, artifact)
        if (!this.#enabled && status.state !== 'installed')
          status = SkillInstallStatusSchema.parse({
            ...status,
            state: 'disabled',
            message: 'Automatic managed Skill installation is disabled.',
          })
        else if (
          this.#enabled &&
          !dryRun &&
          (status.state === 'missing' || status.state === 'update-available')
        ) {
          await this.#installArtifact(harness, artifact)
          status = await this.#inspectArtifact(harness, artifact)
        }
        statuses.push(status)
      }
    }
    const staleManagedDirectories = await this.#staleManagedDirectories()
    const cleanedStaleDirectories =
      this.#enabled && !dryRun && options.cleanStale
        ? await this.#cleanUnmodifiedStaleDirectories(staleManagedDirectories)
        : []
    return {
      dryRun,
      enabled: this.#enabled,
      registryVersion: this.#registry.version,
      statuses,
      staleManagedDirectories: staleManagedDirectories.filter(
        (path) => !cleanedStaleDirectories.includes(path),
      ),
      cleanedStaleDirectories,
    }
  }

  #artifacts(): SkillArtifact[] {
    return [
      {
        id: 'fastppt',
        kind: 'base',
        version: '0.2.0',
        sourceDir: this.#commonSkillRoot,
        entries: COMMON_ENTRIES,
        registryVersion: this.#registry.version,
      },
      {
        id: 'fastppt-page-edit',
        kind: 'base',
        version: '0.1.0',
        sourceDir: join(this.#commonSkillRoot, 'page-edit'),
        registryVersion: this.#registry.version,
      },
      ...this.#registry.themes.map((theme) => ({
        id: theme.manifest.skill.id,
        kind: 'theme' as const,
        themeId: theme.manifest.id,
        version: theme.manifest.skill.version,
        sourceDir: theme.skillSourceDir,
        registryVersion: this.#registry.version,
      })),
    ]
  }

  async #inspectArtifact(
    harness: HarnessKind,
    artifact: SkillArtifact,
  ): Promise<SkillInstallStatus> {
    const targetPath = join(
      rootForHarness(this.#workspaceRoot, harness),
      artifact.id,
    )
    const base = {
      harness,
      skillId: artifact.id,
      kind: artifact.kind,
      ...(artifact.themeId ? { themeId: artifact.themeId } : {}),
      expectedVersion: artifact.version,
      targetPath,
    }
    if (!(await exists(targetPath)))
      return SkillInstallStatusSchema.parse({
        ...base,
        state: 'missing',
        managed: false,
      })
    const marker = await readMarker(targetPath)
    if (!marker || marker.skillId !== artifact.id)
      return SkillInstallStatusSchema.parse({
        ...base,
        state: 'conflict',
        managed: false,
        message: 'The target directory exists but is not managed by FastPPT.',
      })
    const installedDigest = await digestDirectory(targetPath)
    if (installedDigest !== marker.installedDigest)
      return SkillInstallStatusSchema.parse({
        ...base,
        installedVersion: marker.version,
        state: 'conflict',
        managed: true,
        message: 'Managed Skill files were modified after installation.',
      })
    const sourceDigest = await digestDirectory(
      artifact.sourceDir,
      artifact.entries,
    )
    const current =
      marker.version === artifact.version &&
      marker.sourceDigest === sourceDigest
    return SkillInstallStatusSchema.parse({
      ...base,
      installedVersion: marker.version,
      state: current ? 'installed' : 'update-available',
      managed: true,
    })
  }

  async #installArtifact(
    harness: HarnessKind,
    artifact: SkillArtifact,
  ): Promise<void> {
    const parent = rootForHarness(this.#workspaceRoot, harness)
    const target = join(parent, artifact.id)
    const staging = join(
      parent,
      `.fastppt-stage-${artifact.id}-${randomUUID()}`,
    )
    const previous = join(
      parent,
      `.fastppt-previous-${artifact.id}-${randomUUID()}`,
    )
    await mkdir(staging, { recursive: true })
    try {
      for (const entry of artifact.entries ??
        (await readdir(artifact.sourceDir))) {
        const source = join(artifact.sourceDir, entry)
        if (await exists(source))
          await cp(source, join(staging, entry), { recursive: true })
      }
      const digest = await digestDirectory(staging)
      const marker: Marker = {
        schemaVersion: 1,
        skillId: artifact.id,
        version: artifact.version,
        source: artifact.sourceDir,
        sourceDigest: digest,
        installedDigest: digest,
        registryVersion: artifact.registryVersion,
        installedAt: new Date().toISOString(),
      }
      await writeFile(
        join(staging, MARKER_FILE),
        `${JSON.stringify(marker, null, 2)}\n`,
      )
      await mkdir(parent, { recursive: true })
      const replacing = await exists(target)
      if (replacing) await rename(target, previous)
      try {
        await rename(staging, target)
      } catch (cause) {
        if (replacing) await rename(previous, target)
        throw cause
      }
      if (replacing) await rm(previous, { recursive: true, force: true })
    } catch (cause) {
      await rm(staging, { recursive: true, force: true })
      throw cause
    }
  }

  async #staleManagedDirectories(): Promise<string[]> {
    const expected = new Set(this.#artifacts().map((artifact) => artifact.id))
    const stale: string[] = []
    for (const harness of ['claude', 'codex'] as const) {
      const root = rootForHarness(this.#workspaceRoot, harness)
      if (!(await exists(root))) continue
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || expected.has(entry.name)) continue
        const target = join(root, entry.name)
        const marker = await readMarker(target)
        if (marker) stale.push(target)
      }
    }
    return stale.sort()
  }

  async #cleanUnmodifiedStaleDirectories(paths: string[]): Promise<string[]> {
    const cleaned: string[] = []
    for (const path of paths) {
      const marker = await readMarker(path)
      if (!marker) continue
      const digest = await digestDirectory(path)
      if (digest !== marker.installedDigest) continue
      await rm(path, { recursive: true, force: true })
      cleaned.push(path)
    }
    return cleaned
  }
}

function mcpArgs(options: McpConfigManagerOptions): string[] {
  return [
    ...(options.runtimeArgs ?? []),
    options.serverEntry,
    '--workspace',
    resolve(options.workspaceRoot),
    '--themes-root',
    resolve(options.themesRoot),
    '--common-skill-root',
    resolve(options.commonSkillRoot),
  ]
}

function isLegacyServerEntry(value: string): boolean {
  return /(?:^|[\\/])packages[\\/]fastppt-mcp[\\/](?:dist[\\/]cli\.js|src[\\/]cli\.ts)$/.test(
    value,
  )
}

function isLegacyMcpArgs(
  value: unknown,
  options: McpConfigManagerOptions,
): value is string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    return false
  const serverIndex = value.findIndex(isLegacyServerEntry)
  if (serverIndex < 0) return false
  const serverEntry = value[serverIndex]
  if (!serverEntry) return false
  const argumentsAfterEntry = value.slice(serverIndex + 1)
  const expectedArguments = (themesRoot: string, commonSkillRoot: string) => [
    '--workspace',
    resolve(options.workspaceRoot),
    '--themes-root',
    themesRoot,
    '--common-skill-root',
    commonSkillRoot,
  ]
  const legacyRepositoryRoot = resolve(dirname(serverEntry), '../../..')
  return [
    expectedArguments(
      resolve(options.themesRoot),
      resolve(options.commonSkillRoot),
    ),
    expectedArguments(
      join(legacyRepositoryRoot, 'themes'),
      join(legacyRepositoryRoot, 'packages', 'fastppt-skill'),
    ),
  ].some(
    (expected) =>
      JSON.stringify(argumentsAfterEntry) === JSON.stringify(expected),
  )
}

function legacyCodexBlock(
  source: string,
  options: McpConfigManagerOptions,
): string | undefined {
  const match = source.match(
    /# BEGIN FASTPPT MCP\r?\n([\s\S]*?)\r?\n# END FASTPPT MCP/,
  )
  if (!match?.[0] || !match[1]) return undefined
  const lines = match[1].split(/\r?\n/)
  if (lines.length !== 3 || lines[0] !== '[mcp_servers.fastppt]')
    return undefined
  const commandMatch = lines[1]?.match(/^command = (.+)$/)
  const argsMatch = lines[2]?.match(/^args = (\[.*\])$/)
  if (!commandMatch?.[1] || !argsMatch?.[1]) return undefined
  try {
    const command = JSON.parse(commandMatch[1]) as unknown
    const args = JSON.parse(argsMatch[1]) as unknown
    return command === process.execPath && isLegacyMcpArgs(args, options)
      ? match[0]
      : undefined
  } catch {
    return undefined
  }
}

export class McpConfigManager {
  readonly #options: McpConfigManagerOptions

  constructor(options: McpConfigManagerOptions) {
    this.#options = options
  }

  async inspect(harness: HarnessKind): Promise<McpConfigStatus> {
    return harness === 'claude'
      ? await this.#inspectClaude()
      : await this.#inspectCodex()
  }

  async reconcile(
    options: { dryRun?: boolean } = {},
  ): Promise<McpConfigStatus[]> {
    const dryRun = options.dryRun ?? false
    const statuses: McpConfigStatus[] = []
    for (const harness of ['claude', 'codex'] as const) {
      let status = await this.inspect(harness)
      if (!dryRun) {
        if (harness === 'claude') {
          if (
            status.state === 'missing' ||
            (status.state === 'conflict' && status.managed)
          ) {
            await this.#writeClaude() // writes .mcp.json + auto-enables trust
          } else if (status.state === 'pending-trust') {
            // Config already written by an earlier version: backfill the
            // auto-enable entry so the server connects without a prompt.
            await this.#ensureClaudeMcpTrust()
          }
        } else if (
          status.state === 'missing' ||
          (status.state === 'conflict' && status.managed)
        ) {
          await this.#writeCodex()
        }
        status = await this.inspect(harness)
      }
      statuses.push(status)
    }
    return statuses
  }

  async #inspectClaude(): Promise<McpConfigStatus> {
    const configPath = join(this.#options.workspaceRoot, '.mcp.json')
    if (!(await exists(configPath)))
      return McpConfigStatusSchema.parse({
        harness: 'claude',
        state: 'missing',
        configPath,
        managed: false,
      })
    try {
      const config = z
        .object({ mcpServers: z.record(z.string(), z.unknown()).default({}) })
        .passthrough()
        .parse(JSON.parse(await readFile(configPath, 'utf8')) as unknown)
      const expected = {
        command: process.execPath,
        args: mcpArgs(this.#options),
      }
      const current = config.mcpServers.fastppt
      if (current === undefined)
        return McpConfigStatusSchema.parse({
          harness: 'claude',
          state: 'missing',
          configPath,
          managed: false,
        })
      const matching = JSON.stringify(current) === JSON.stringify(expected)
      const legacyManaged = z
        .object({ command: z.string(), args: z.unknown() })
        .safeParse(current)
      const legacy =
        legacyManaged.success &&
        legacyManaged.data.command === process.execPath &&
        isLegacyMcpArgs(legacyManaged.data.args, this.#options)
      const trusted = await this.#claudeMcpTrusted()
      const message = !matching
        ? legacy
          ? 'Legacy managed fastppt MCP entry requires migration.'
          : 'Existing fastppt MCP entry differs.'
        : trusted
          ? undefined
          : 'fastppt MCP 配置已写入 .mcp.json，等待 Claude Code 信任授权。'
      return McpConfigStatusSchema.parse({
        harness: 'claude',
        state: matching ? (trusted ? 'configured' : 'pending-trust') : 'conflict',
        configPath,
        managed: matching || legacy,
        ...(message ? { message } : {}),
      })
    } catch (cause) {
      return McpConfigStatusSchema.parse({
        harness: 'claude',
        state: 'conflict',
        configPath,
        managed: false,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  async #writeClaude(): Promise<void> {
    const configPath = join(this.#options.workspaceRoot, '.mcp.json')
    const config = (await exists(configPath))
      ? (JSON.parse(await readFile(configPath, 'utf8')) as Record<
          string,
          unknown
        >)
      : {}
    const servers =
      config.mcpServers && typeof config.mcpServers === 'object'
        ? (config.mcpServers as Record<string, unknown>)
        : {}
    config.mcpServers = {
      ...servers,
      fastppt: { command: process.execPath, args: mcpArgs(this.#options) },
    }
    await backup(configPath)
    await atomicWrite(configPath, `${JSON.stringify(config, null, 2)}\n`)
    await this.#ensureClaudeMcpTrust()
  }

  /** Whether the fastppt project MCP server is pre-authorized in Claude Code's
      `.claude/settings.json` via `enabledMcpjsonServers`. */
  async #claudeMcpTrusted(): Promise<boolean> {
    const settingsPath = join(
      this.#options.workspaceRoot,
      '.claude',
      'settings.json',
    )
    if (!(await exists(settingsPath))) return false
    try {
      const settings = JSON.parse(
        await readFile(settingsPath, 'utf8'),
      ) as { enabledMcpjsonServers?: unknown }
      return (
        Array.isArray(settings.enabledMcpjsonServers) &&
        settings.enabledMcpjsonServers.includes('fastppt')
      )
    } catch {
      return false
    }
  }

  /** Merge `enabledMcpjsonServers: ["fastppt"]` into the workspace
      `.claude/settings.json` so the project MCP server is auto-enabled without
      the first-use "Allow this MCP server?" prompt. Preserves all other keys. */
  async #ensureClaudeMcpTrust(): Promise<void> {
    const settingsPath = join(
      this.#options.workspaceRoot,
      '.claude',
      'settings.json',
    )
    const settings = (await exists(settingsPath))
      ? (JSON.parse(await readFile(settingsPath, 'utf8')) as Record<
          string,
          unknown
        >)
      : {}
    const enabled = Array.isArray(settings.enabledMcpjsonServers)
      ? settings.enabledMcpjsonServers.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : []
    if (enabled.includes('fastppt')) return
    settings.enabledMcpjsonServers = [...enabled, 'fastppt']
    await backup(settingsPath)
    await atomicWrite(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  }

  async #inspectCodex(): Promise<McpConfigStatus> {
    const configPath = join(
      this.#options.workspaceRoot,
      '.codex',
      'config.toml',
    )
    if (!(await exists(configPath)))
      return McpConfigStatusSchema.parse({
        harness: 'codex',
        state: 'missing',
        configPath,
        managed: false,
      })
    const source = await readFile(configPath, 'utf8')
    const expected = this.#codexBlock()
    if (source.includes(expected))
      return McpConfigStatusSchema.parse({
        harness: 'codex',
        state: 'pending-trust',
        configPath,
        managed: true,
        message: 'fastppt MCP 配置已写入 .codex/config.toml；首次在 Codex 中信任该项目后即启用。',
      })
    const legacyBlock = legacyCodexBlock(source, this.#options)
    if (legacyBlock)
      return McpConfigStatusSchema.parse({
        harness: 'codex',
        state: 'conflict',
        configPath,
        managed: true,
        message: 'Legacy managed fastppt MCP entry requires migration.',
      })
    if (
      /\[mcp_servers\.fastppt\]/.test(source) ||
      source.includes('# BEGIN FASTPPT MCP')
    )
      return McpConfigStatusSchema.parse({
        harness: 'codex',
        state: 'conflict',
        configPath,
        managed: false,
        message: 'Existing fastppt MCP configuration differs.',
      })
    return McpConfigStatusSchema.parse({
      harness: 'codex',
      state: 'missing',
      configPath,
      managed: false,
    })
  }

  async #writeCodex(): Promise<void> {
    const configPath = join(
      this.#options.workspaceRoot,
      '.codex',
      'config.toml',
    )
    const current = (await exists(configPath))
      ? await readFile(configPath, 'utf8')
      : ''
    const legacyBlock = legacyCodexBlock(current, this.#options)
    const next = legacyBlock
      ? current.replace(legacyBlock, this.#codexBlock())
      : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${this.#codexBlock()}\n`
    await backup(configPath)
    await atomicWrite(configPath, next)
  }

  #codexBlock(): string {
    return [
      '# BEGIN FASTPPT MCP',
      '[mcp_servers.fastppt]',
      `command = ${JSON.stringify(process.execPath)}`,
      `args = [${mcpArgs(this.#options)
        .map((value) => JSON.stringify(value))
        .join(', ')}]`,
      '# END FASTPPT MCP',
    ].join('\n')
  }
}
