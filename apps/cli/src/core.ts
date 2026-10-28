import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { createFastPptRuntime } from '@fastppt/fastppt-mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { TOOL_COMMANDS, type CoreArguments } from './core-arguments.js'
import type { CliRuntimePaths } from './paths.js'
import { installBundledThemes } from './themes.js'

export async function coreParameters(
  input: CoreArguments,
): Promise<Record<string, unknown>> {
  const source = input.inputFile
    ? await readFile(input.inputFile, 'utf8')
    : input.input
  const value: unknown = source ? JSON.parse(source) : {}
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Core parameters must be a JSON object.')
  const parameters = { ...value, ...input.parameters }
  if (input.contentFile) {
    if (
      input.command !== 'deck write' &&
      !(input.command === 'tools call' && input.tool === 'write_slides')
    )
      throw new Error('--content-file is only supported for writing slides.')
    parameters.content = await readFile(input.contentFile, 'utf8')
  }
  if (input.command === 'theme import' && typeof parameters.name === 'string') {
    parameters.themeName = parameters.name
    delete parameters.name
  }
  if (input.command === 'theme create' && typeof parameters.name === 'string') {
    parameters.displayName = parameters.name
    delete parameters.name
  }
  return parameters
}

export function coreResultFailed(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (
    Array.isArray(item.slides) &&
    item.slides.some((slide: unknown) => {
      if (!slide || typeof slide !== 'object') return false
      const report = slide as Record<string, unknown>
      return (
        coreResultFailed(report.quality) || coreResultFailed(report.overflow)
      )
    })
  )
    return true
  return (
    item.valid === false ||
    item.inspectionAvailable === false ||
    item.reviewAvailable === false ||
    item.overflow === true ||
    item.status === 'failed' ||
    (Array.isArray(item.issues) &&
      item.issues.some(
        (issue: unknown) =>
          issue &&
          typeof issue === 'object' &&
          'severity' in issue &&
          issue.severity === 'error',
      )) ||
    (Array.isArray(item.statuses) &&
      item.statuses.some(
        (status: unknown) =>
          status &&
          typeof status === 'object' &&
          'state' in status &&
          ['conflict', 'missing', 'disabled', 'update-available'].includes(
            String(status.state),
          ),
      ))
  )
}

/** Runtime metadata is the only source of the workspace Gateway address. */
export async function gatewayRequest(
  workspaceRoot: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  let runtime: { version?: number; url?: string }
  try {
    runtime = JSON.parse(
      await readFile(
        join(workspaceRoot, '.fastppt/runtime/gateway.json'),
        'utf8',
      ),
    ) as typeof runtime
  } catch {
    throw new Error(
      'Start the workspace Gateway with fastppt start before using this command.',
    )
  }
  if (
    runtime.version !== 1 ||
    !runtime.url ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(runtime.url)
  )
    throw new Error('Invalid workspace Gateway runtime metadata.')
  const response = await fetch(`${runtime.url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = (await response.json()) as { error?: { message?: string } }
  if (!response.ok)
    throw new Error(
      payload.error?.message ?? `Gateway request failed (${response.status}).`,
    )
  return payload
}

async function gatewayCommand(
  workspaceRoot: string,
  command: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  if (command === 'theme rescan')
    return gatewayRequest(workspaceRoot, '/api/v1/themes/rescan', {})
  if (command === 'deck list')
    return gatewayRequest(workspaceRoot, '/api/v1/decks')
  if (command === 'deck create')
    return gatewayRequest(workspaceRoot, '/api/v1/decks', parameters)
  if (command === 'deck generate') {
    const { harness = 'codex', profile, prompt, title } = parameters
    if (
      !['codex', 'claude'].includes(String(harness)) ||
      typeof prompt !== 'string' ||
      !prompt.trim() ||
      !profile ||
      typeof profile !== 'object'
    )
      throw new Error(
        'deck generate requires prompt, profile and harness (codex or claude). Supply a SessionDeckProfile via --input-file.',
      )
    const session = (await gatewayRequest(workspaceRoot, '/api/v1/sessions', {
      harness,
      cwd: workspaceRoot,
      profile,
      ...(title ? { title } : {}),
    })) as { sessionId?: string }
    if (!session.sessionId)
      throw new Error('Gateway did not return a session id.')
    try {
      const run = await gatewayRequest(
        workspaceRoot,
        `/api/v1/sessions/${encodeURIComponent(String(harness))}/${encodeURIComponent(session.sessionId)}/messages`,
        { content: prompt },
      )
      return { harness, sessionId: session.sessionId, run, status: 'started' }
    } catch (cause) {
      throw new Error(
        `Session ${session.sessionId} was created but generation dispatch failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      )
    }
  }
  if (command === 'session status') {
    const { harness = 'codex', sessionId } = parameters
    if (
      !['codex', 'claude'].includes(String(harness)) ||
      typeof sessionId !== 'string' ||
      !sessionId
    )
      throw new Error(
        'session status requires --session and --harness codex|claude.',
      )
    const path = `/api/v1/sessions/${encodeURIComponent(String(harness))}/${encodeURIComponent(sessionId)}`
    const [session, run] = await Promise.all([
      gatewayRequest(workspaceRoot, path),
      gatewayRequest(workspaceRoot, `${path}/runs/latest`),
    ])
    return { session, run }
  }
  const decks = (await gatewayRequest(
    workspaceRoot,
    '/api/v1/decks',
  )) as Array<{ id: string; entryFile: string }>
  const path =
    typeof parameters.path === 'string'
      ? parameters.path.replaceAll('\\', '/')
      : 'slides.md'
  const deck = decks.find((candidate) => candidate.entryFile === path)
  if (!deck) throw new Error(`Gateway does not manage deck: ${path}`)
  return gatewayRequest(
    workspaceRoot,
    `/api/v1/decks/${encodeURIComponent(deck.id)}/preview/${command.split(' ')[1]}`,
    {},
  )
}

export async function runCoreCommand(
  input: CoreArguments,
  paths: CliRuntimePaths,
): Promise<unknown> {
  const parameters = await coreParameters(input)
  const workspaceRoot = await realpath(input.workspaceRoot)
  if (
    [
      'theme rescan',
      'deck list',
      'deck create',
      'deck generate',
      'preview start',
      'preview stop',
      'preview restart',
      'session status',
    ].includes(input.command)
  )
    return gatewayCommand(workspaceRoot, input.command, parameters)
  const manifest = JSON.parse(
    await readFile(join(paths.packageRoot, 'package.json'), 'utf8'),
  ) as { version: string }
  await installBundledThemes({
    bundledThemesRoot: paths.bundledThemesRoot,
    themesRoot: paths.themesRoot,
    version: manifest.version,
  })
  const runtime = await createFastPptRuntime({
    workspaceRoot,
    themesRoot: paths.themesRoot,
    commonSkillRoot: paths.commonSkillRoot,
    extractorPath: join(paths.packageRoot, 'scripts/extract-theme.mjs'),
  })
  const client = new Client({ name: 'fastppt-cli', version: manifest.version })
  try {
    if (input.command === 'skills install')
      return await runtime.skills.reconcile({
        dryRun: parameters.dryRun === true,
      })
    if (input.command === 'skills status')
      return {
        statuses: (
          await Promise.all(
            ['claude', 'codex'].map((harness) =>
              runtime.skills.inspect(harness as 'claude' | 'codex'),
            ),
          )
        ).flat(),
      }
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    await runtime.server.connect(serverTransport)
    await client.connect(clientTransport)
    if (input.command === 'tools list') return await client.listTools()
    const name = input.tool ?? TOOL_COMMANDS[input.command]
    if (!name) throw new Error(`No core tool for ${input.command}`)
    const result = await client.callTool(
      { name, arguments: parameters },
      undefined,
      { timeout: input.timeoutMs },
    )
    const blocks = result.content as Array<{ type: string; text?: string }>
    const content = blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n')
    if (result.isError) throw new Error(content || `Core tool ${name} failed.`)
    return content ? (JSON.parse(content) as unknown) : result.structuredContent
  } finally {
    await client.close()
    await runtime.server.close()
    await runtime.service.dispose()
  }
}
