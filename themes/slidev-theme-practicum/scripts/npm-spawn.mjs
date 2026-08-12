import process from 'node:process'

export function getNpmSpawnConfig(platform, cacheDir, environment = process.env) {
  const isWindows = platform === 'win32'
  const env = Object.fromEntries(
    Object.entries(environment).filter(([key]) => key.toLowerCase() !== 'npm_config_cache'),
  )
  env.npm_config_cache = cacheDir

  return {
    command: isWindows ? 'npm.cmd' : 'npm',
    args: ['pack', '--dry-run', '--json'],
    shell: isWindows,
    env,
  }
}

export function normalizeSpawnFailure(result) {
  const errorMessage = result.error instanceof Error ? result.error.message : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr : ''
  const stdout = typeof result.stdout === 'string' ? result.stdout : ''

  return {
    message:
      errorMessage
      || stderr
      || stdout
      || 'npm pack завершился без диагностического вывода',
    status: typeof result.status === 'number' ? result.status : 1,
  }
}
