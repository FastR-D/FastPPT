import { createRequire } from 'node:module'
import { lstat, readdir, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
process.argv[1] = require.resolve('@slidev/cli/bin/slidev.mjs')

const { createServer, parser, resolveOptions } = await import('@slidev/cli')

const optionalOptimizeDependencies = [
  '@citation-js/core',
  '@citation-js/name',
  '@citation-js/plugin-bibtex',
  '@citation-js/plugin-csl',
  '@citation-js/plugin-doi',
]
const optimizeDependencyAliases = Object.fromEntries(
  optionalOptimizeDependencies.flatMap((dependency) => {
    try {
      return [[dependency, require.resolve(dependency)]]
    } catch {
      return []
    }
  }),
)

const ignoredWatchDirectories = new Set([
  '.agents',
  '.cache',
  '.claude',
  '.codex',
  '.fastppt',
  '.git',
  '.pnpm-store',
  '.pytest_cache',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'outputs',
  'target',
  'venv',
])

function shouldIgnoreWatchPath(path) {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .some((segment) => ignoredWatchDirectories.has(segment))
}

const [entry, rawPort, base, cacheDirectory, theme] = process.argv.slice(2)
const port = Number(rawPort)
const basePath = base || '/'

if (
  !entry ||
  !cacheDirectory ||
  !Number.isInteger(port) ||
  port <= 0 ||
  port > 65_535
) {
  process.stderr.write(
    'Usage: slidev-host runner <entry-file> <port> <base-path> <cache-directory> [theme-package-root]\n',
  )
  process.exitCode = 1
} else {
  const cleanupVirtualModules = async () => {
    const deckRoot = dirname(entry)
    const nodeModules = join(deckRoot, 'node_modules')
    const slidevDirectory = join(nodeModules, '.slidev')
    const virtualDirectory = join(slidevDirectory, 'virtual')
    for (const path of [nodeModules, slidevDirectory, virtualDirectory]) {
      const info = await lstat(path).catch(() => undefined)
      if (!info?.isDirectory() || info.isSymbolicLink()) return
    }
    const files = await readdir(virtualDirectory, {
      withFileTypes: true,
    }).catch(() => [])
    await Promise.all(
      files
        .filter(
          (file) =>
            file.isFile() && /^import-glob\.[a-f\d]{10}\.ts$/.test(file.name),
        )
        .map((file) =>
          unlink(join(virtualDirectory, file.name)).catch(() => undefined),
        ),
    )
    await rmdir(virtualDirectory).catch(() => undefined)
    await rmdir(slidevDirectory).catch(() => undefined)
  }

  await cleanupVirtualModules()
  const options = await resolveOptions(
    {
      entry,
      ...(theme ? { theme } : {}),
      base: basePath,
    },
    'dev',
  )
  options.roots.push(dirname(fileURLToPath(import.meta.url)))
  const server = await createServer(
    options,
    {
      base: basePath,
      clearScreen: false,
      ...(Object.keys(optimizeDependencyAliases).length
        ? {
            resolve: { alias: optimizeDependencyAliases },
            optimizeDeps: {
              include: Object.keys(optimizeDependencyAliases),
            },
          }
        : {}),
      server: {
        host: '127.0.0.1',
        port,
        strictPort: true,
        watch: {
          depth: 1,
          ignored: shouldIgnoreWatchPath,
        },
        fs: {
          deny: [
            '.env',
            '.env.*',
            '*.{crt,pem}',
            '**/.git/**',
            '**/.fastppt/**',
            '**/.claude/**',
            '**/.agents/**',
            '**/.codex/**',
            '**/.mcp.json',
          ],
        },
      },
      cacheDir: cacheDirectory,
    },
    {
      async loadData(loadedSource) {
        const loaded = await parser.load(
          options,
          options.entry,
          loadedSource,
          'dev',
        )
        return {
          ...loaded,
          themeMeta: options.data.themeMeta,
          config: parser.resolveConfig(
            loaded.headmatter,
            options.data.themeMeta,
            options.entry,
          ),
        }
      },
    },
  )

  const shutdown = async () => {
    await server.close()
    await cleanupVirtualModules()
    process.exitCode = 0
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
  await server.listen()
}
