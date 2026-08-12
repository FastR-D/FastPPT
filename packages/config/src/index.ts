import { realpathSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface GatewayConfig {
  host: '127.0.0.1'
  port: number
  allowedWebOrigins: readonly string[]
  workspaceRoot: string
  workspaceName: string
  themesRoot: string
  exportTimeoutMs: number
  maxConcurrentRunsPerHarness: number
  /** Interval between `.fastppt` state sweeps in milliseconds; default 1h. */
  cleanupIntervalMs?: number
  /** Entries older than this age (ms) are removed during a state sweep; default 7d. */
  cleanupMaxAgeMs?: number
}

export function parseWorkspaceArgument(
  argv: readonly string[],
): string | undefined {
  const index = argv.indexOf('--workspace')
  if (index >= 0) return argv[index + 1]
  return argv
    .find((argument) => argument.startsWith('--workspace='))
    ?.slice('--workspace='.length)
}

export function loadGatewayConfig(
  argv: readonly string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
  options: { themesRoot?: string } = {},
): GatewayConfig {
  const workspaceRoot = realpathSync(
    resolve(parseWorkspaceArgument(argv) ?? cwd),
  )
  if (!statSync(workspaceRoot).isDirectory()) {
    throw new Error(`Workspace is not a directory: ${workspaceRoot}`)
  }

  return {
    host: '127.0.0.1',
    port: 4317,
    allowedWebOrigins: [
      'https://fastppt.vercel.app',
      'https://fastppt.gugumur.dev',
      'https://fastapp.test',
      'http://fastapp.test:4317',
      'http://127.0.0.1:4317',
      'http://127.0.0.1:4318',
      'http://localhost:4318',
    ],
    workspaceRoot,
    workspaceName: basename(workspaceRoot),
    themesRoot: realpathSync(
      options.themesRoot ??
        resolve(dirname(fileURLToPath(import.meta.url)), '../../../themes'),
    ),
    exportTimeoutMs: 120_000,
    maxConcurrentRunsPerHarness: 1,
    cleanupIntervalMs: 3_600_000,
    cleanupMaxAgeMs: 7 * 24 * 3_600_000,
  }
}
