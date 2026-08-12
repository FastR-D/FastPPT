#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createGateway } from '@fastppt/gateway/app'
import { loadGatewayConfig } from '@fastppt/config'

import { CLI_HELP, parseCliArguments } from './arguments.js'
import { resolveCliRuntimePaths } from './paths.js'

async function packageVersion(packageRoot: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(join(packageRoot, 'package.json'), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : 'unknown'
}

async function main(): Promise<void> {
  const paths = resolveCliRuntimePaths(import.meta.url)
  const input = parseCliArguments(process.argv.slice(2), process.cwd())
  if (input.help) {
    process.stdout.write(CLI_HELP)
    return
  }
  if (input.version) {
    process.stdout.write(`${await packageVersion(paths.packageRoot)}\n`)
    return
  }

  const config = loadGatewayConfig(
    ['--workspace', input.workspaceRoot],
    process.cwd(),
    { themesRoot: paths.themesRoot },
  )
  const app = await createGateway(config, {
    watchThemes: false,
    commonSkillRoot: paths.commonSkillRoot,
    mcpServerEntry: paths.mcpServerEntry,
    mcpRuntimeArgs: [],
    slidevRunnerPath: paths.slidevRunnerPath,
  })
  let closing = false
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return
    closing = true
    app.log.info({ signal }, 'Shutting down FastPPT backend')
    await app.close()
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host: config.host, port: config.port })
  app.log.info(
    {
      workspaceRoot: config.workspaceRoot,
      gateway: `http://${config.host}:${String(config.port)}`,
      frontendStarted: false,
    },
    'FastPPT backend ready; open https://fastppt.vercel.app',
  )
}

main().catch((cause: unknown) => {
  process.stderr.write(
    `FastPPT failed to start: ${cause instanceof Error ? cause.message : String(cause)}\n`,
  )
  process.exitCode = 1
})
