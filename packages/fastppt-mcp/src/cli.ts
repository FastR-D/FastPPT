#!/usr/bin/env node

import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { createFastPptRuntime } from './runtime.js'

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

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const runtime = await createFastPptRuntime({
  workspaceRoot: resolve(input.workspaceRoot),
  themesRoot: resolve(input.themesRoot),
  commonSkillRoot: resolve(input.commonSkillRoot),
  extractorPath: resolve(
    moduleDirectory,
    basename(moduleDirectory) === 'runtime'
      ? '../scripts/extract-theme.mjs'
      : '../../../scripts/extract-theme.mjs',
  ),
})
await runtime.server.connect(new StdioServerTransport())
