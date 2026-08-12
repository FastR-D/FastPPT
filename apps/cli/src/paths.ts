import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CliRuntimePaths {
  packageRoot: string
  themesRoot: string
  commonSkillRoot: string
  mcpServerEntry: string
  slidevRunnerPath: string
}

export function resolveCliRuntimePaths(
  moduleUrl: string,
): CliRuntimePaths {
  const packageRoot = join(dirname(fileURLToPath(moduleUrl)), '..')
  return {
    packageRoot,
    themesRoot: join(packageRoot, 'themes'),
    commonSkillRoot: join(packageRoot, 'fastppt-skill'),
    mcpServerEntry: join(packageRoot, 'runtime', 'mcp-server.js'),
    slidevRunnerPath: join(packageRoot, 'runner.mjs'),
  }
}
