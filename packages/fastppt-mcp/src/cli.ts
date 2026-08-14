#!/usr/bin/env node

import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadThemeRegistry } from '@fastppt/theme-registry'
import { WorkspaceService } from '@fastppt/workspace'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { createFastPptMcpServer, FastPptMcpService } from './server.js'
import { GatewayBrowserCaptureDelegate } from './gateway-delegate.js'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const input = z
  .object({
    workspaceRoot: z.string().min(1),
    themesRoot: z.string().min(1),
    commonSkillRoot: z.string().min(1),
  })
  .parse({
    workspaceRoot: argument('--workspace'),
    themesRoot: argument('--themes-root'),
    commonSkillRoot: argument('--common-skill-root'),
  })

const workspaceRoot = resolve(input.workspaceRoot)
const [workspace, registry] = await Promise.all([
  WorkspaceService.create(workspaceRoot),
  loadThemeRegistry(resolve(input.themesRoot)),
])
const extractorPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/extract-theme.mjs',
)
const service = new FastPptMcpService({
  workspace,
  workspaceName: basename(workspaceRoot),
  registry,
  commonSkillRoot: resolve(input.commonSkillRoot),
  themesRoot: resolve(input.themesRoot),
  extractorPath,
  browserCapture: new GatewayBrowserCaptureDelegate(workspaceRoot),
})
const server = createFastPptMcpServer(service)
await server.connect(new StdioServerTransport())
