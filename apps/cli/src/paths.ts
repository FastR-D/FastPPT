import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export interface CliRuntimePaths {
  packageRoot: string
  bundledThemesRoot: string
  themesRoot: string
  commonSkillRoot: string
  mcpServerEntry: string
  slidevRunnerPath: string
}

export function resolveCliRuntimePaths(
  moduleUrl: string,
  homeDirectory: string = homedir(),
): CliRuntimePaths {
  const packageRoot = join(dirname(fileURLToPath(moduleUrl)), '..')
  return {
    packageRoot,
    bundledThemesRoot: join(packageRoot, 'themes'),
    themesRoot: join(homeDirectory, '.fastppt', 'themes'),
    commonSkillRoot: join(packageRoot, 'fastppt-skill'),
    mcpServerEntry: join(packageRoot, 'runtime', 'mcp-server.js'),
    slidevRunnerPath: join(packageRoot, 'runner.mjs'),
  }
}
