import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const outputRoot = join(packageRoot, 'dist')
const runtimeRoot = join(outputRoot, 'runtime')
const external = [
  '@fastppt/fonts',
  '@fastppt/slidewave',
  '@anthropic-ai/claude-agent-sdk',
  '@chenglou/pretext',
  '@fastify/cors',
  '@fastify/websocket',
  '@iconify-json/ant-design',
  '@iconify-json/mdi',
  '@modelcontextprotocol/sdk',
  '@slidev/cli',
  'better-sqlite3',
  'chokidar',
  'drizzle-orm',
  'fastify',
  'http-proxy',
  'jszip',
  'lucide',
  'picomatch',
  'pino',
  'pino-pretty',
  'pptxgenjs',
  'prettier',
  'prettier-plugin-slidev',
  'prismjs',
  'subset-font',
  'ttf2eot',
  'ws',
  'yaml',
  'zod',
]

await rm(outputRoot, { recursive: true, force: true })
await mkdir(runtimeRoot, { recursive: true })
await build({
  entryPoints: {
    cli: join(packageRoot, 'src/cli.ts'),
    'install-themes': join(packageRoot, 'src/install-themes.ts'),
    'mcp-server': join(packageRoot, 'src/mcp-server.ts'),
  },
  outdir: runtimeRoot,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  packages: 'bundle',
  external: external.flatMap((name) => [name, `${name}/*`]),
})

await Promise.all([
  cp(
    join(repositoryRoot, 'scripts', 'extract-theme.mjs'),
    join(outputRoot, 'scripts', 'extract-theme.mjs'),
  ),
  cp(join(repositoryRoot, 'themes'), join(outputRoot, 'themes'), {
    recursive: true,
    filter: (source) =>
      !source.includes(`${join('node_modules', '')}`) &&
      !source.includes(`${join('.turbo', '')}`) &&
      !source.includes(`${join('.theme-build', '')}`),
  }),
  cp(
    join(repositoryRoot, 'packages/fastppt-skill'),
    join(outputRoot, 'fastppt-skill'),
    {
      recursive: true,
      filter: (source) =>
        !source.includes(`${join('node_modules', '')}`) &&
        !source.includes(`${join('.turbo', '')}`) &&
        !source.includes(`${join('dist', '')}`) &&
        !source.includes(`${join('tests', '')}`),
    },
  ),
  cp(
    join(repositoryRoot, 'packages/database/migrations'),
    join(outputRoot, 'migrations'),
    { recursive: true },
  ),
  cp(
    join(repositoryRoot, 'packages/slidewave/dist'),
    join(outputRoot, 'node_modules/@fastppt/slidewave/dist'),
    { recursive: true },
  ),
  cp(
    join(repositoryRoot, 'packages/fonts'),
    join(outputRoot, 'node_modules/@fastppt/fonts'),
    {
      recursive: true,
      filter: (source) =>
        !source.includes(`${join('node_modules', '')}`) &&
        !source.includes(`${join('.turbo', '')}`) &&
        !source.includes(`${join('scripts', '')}`) &&
        !source.includes(`${join('tests', '')}`) &&
        !source.includes(`${join('dist', '')}`),
    },
  ),
  cp(
    join(repositoryRoot, 'packages/slidev-host/runner.mjs'),
    join(outputRoot, 'runner.mjs'),
  ),
])

const manifest = JSON.parse(
  await readFile(join(packageRoot, 'package.json'), 'utf8'),
)
const slidewaveManifest = JSON.parse(
  await readFile(join(repositoryRoot, 'packages/slidewave/package.json'), 'utf8'),
)
await writeFile(
  join(outputRoot, 'package.json'),
  `${JSON.stringify({ name: manifest.name, version: manifest.version, type: 'module' }, null, 2)}\n`,
)
await writeFile(
  join(outputRoot, 'node_modules/@fastppt/slidewave/package.json'),
  `${JSON.stringify(
    {
      name: '@fastppt/slidewave',
      version: slidewaveManifest.version,
      type: 'module',
      exports: {
        '.': './dist/core.js',
        './browser': './dist/browser/index.js',
        './browser/runtime': './dist/browser/runtime.js',
        './snapshot': './dist/snapshot.js',
        './server': './dist/server/index.js',
      },
      sideEffects: ['./dist/browser/runtime.js'],
    },
    null,
    2,
  )}\n`,
)
await Promise.all([
  chmod(join(runtimeRoot, 'cli.js'), 0o755),
  chmod(join(runtimeRoot, 'install-themes.js'), 0o755),
  chmod(join(runtimeRoot, 'mcp-server.js'), 0o755),
])
