#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveCliRuntimePaths } from './paths.js'
import { installBundledThemes } from './themes.js'

async function main(): Promise<void> {
  const paths = resolveCliRuntimePaths(import.meta.url)
  const manifest = JSON.parse(
    await readFile(join(paths.packageRoot, 'package.json'), 'utf8'),
  ) as { version?: unknown }
  const version =
    typeof manifest.version === 'string' ? manifest.version : 'unknown'
  const result = await installBundledThemes({
    bundledThemesRoot: paths.bundledThemesRoot,
    themesRoot: paths.themesRoot,
    version,
  })
  if (result.updated)
    process.stdout.write(
      `FastPPT installed ${result.themeCount} themes in ${paths.themesRoot}.\n`,
    )
}

main().catch((cause: unknown) => {
  process.stderr.write(
    `FastPPT theme installation failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
  )
  process.exitCode = 1
})
