import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const packageRoot = resolve(process.argv[2] ?? '.')
const packageJson = JSON.parse(
  await readFile(join(packageRoot, 'package.json'), 'utf8'),
)

if (
  typeof packageJson.name !== 'string' ||
  !/(^|\/)slidev-theme-/.test(packageJson.name)
)
  throw new Error('Theme build must target a Slidev theme package')

const outputDirectory = join(packageRoot, '.theme-build')
if (basename(outputDirectory) !== '.theme-build')
  throw new Error('Refusing to clean an unexpected build directory')

const entryFile = join(outputDirectory, 'slides.md')
const distributionDirectory = join(outputDirectory, 'dist')
const slidevHostRequire = createRequire(
  new URL('../packages/slidev-host/package.json', import.meta.url),
)
const slidevCli = slidevHostRequire.resolve('@slidev/cli/bin/slidev.mjs')

const source = `---
theme: ${JSON.stringify(packageJson.name)}
title: FastPPT theme build verification
---

# ${packageJson.name}

FastPPT workspace theme build verification.
`

try {
  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory)
  await writeFile(entryFile, source, 'utf8')

  await new Promise((resolveBuild, rejectBuild) => {
    const child = spawn(
      process.execPath,
      [
        slidevCli,
        'build',
        entryFile,
        '--theme',
        packageRoot,
        '--out',
        distributionDirectory,
        '--base',
        './',
      ],
      {
        cwd: packageRoot,
        env: process.env,
        stdio: 'inherit',
      },
    )

    child.once('error', rejectBuild)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveBuild()
      else
        rejectBuild(
          new Error(
            `Slidev build failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
          ),
        )
    })
  })

  const indexHtml = await readFile(
    join(distributionDirectory, 'index.html'),
    'utf8',
  )
  if (!indexHtml.includes('<div id="app">'))
    throw new Error('Slidev build did not produce a valid application entry')

  await rm(join(outputDirectory, 'node_modules'), {
    recursive: true,
    force: true,
  })

  console.log(`theme build passed: ${packageJson.name}`)
} catch (error) {
  await rm(outputDirectory, { recursive: true, force: true })
  throw error
}
