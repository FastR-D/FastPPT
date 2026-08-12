import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import {
  EXPECTED_THEME_ASSETS,
  EXPECTED_THEME_DECORS,
  EXPECTED_THEME_PHOTOS,
  validateAssetDirectory,
} from './theme-asset-inventory.mjs'
import { getNpmSpawnConfig, normalizeSpawnFailure } from './npm-spawn.mjs'

const MAX_PACKAGE_SIZE = 10 * 1024 * 1024
const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const cacheDir = mkdtempSync(join(tmpdir(), 'slidev-theme-practicum-pack-'))

try {
  const {
    command: npmCommand,
    args: npmArgs,
    shell,
    env,
  } = getNpmSpawnConfig(process.platform, cacheDir)
  const result = spawnSync(npmCommand, npmArgs, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env,
    shell,
  })

  if (result.error || result.status !== 0) {
    const failure = normalizeSpawnFailure(result)
    process.stderr.write(failure.message.endsWith('\n') ? failure.message : `${failure.message}\n`)
    process.exitCode = failure.status
  }
  else {
    const [pack] = JSON.parse(result.stdout)
    const files = new Set(pack.files.map(file => file.path))
    const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'))
    const errors = []
    const expectedPhotoFiles = EXPECTED_THEME_PHOTOS.map(file => `public/${file}`)
    const expectedDecorFiles = EXPECTED_THEME_DECORS.map(file => `public/${file}`)
    const expectedAssetFiles = EXPECTED_THEME_ASSETS.map(file => `public/${file}`)
    const packedPhotoFiles = [...files].filter(file => file.startsWith('public/photos/'))
    const packedDecorFiles = [...files].filter(file => file.startsWith('public/decor/'))

    try {
      await validateAssetDirectory(
        join(PROJECT_ROOT, 'public/photos'),
        EXPECTED_THEME_PHOTOS.map(file => file.slice('photos/'.length)),
      )
      await validateAssetDirectory(
        join(PROJECT_ROOT, 'public/decor'),
        EXPECTED_THEME_DECORS.map(file => file.slice('decor/'.length)),
      )
    }
    catch (error) {
      errors.push(error instanceof Error ? error.message : 'source inventory не прошёл проверку')
    }

    for (const file of expectedAssetFiles) {
      if (!files.has(file))
        errors.push(`package не содержит обязательный theme asset: ${file}`)
    }

    for (const file of packedPhotoFiles) {
      if (!expectedPhotoFiles.includes(file))
        errors.push(`package содержит неожиданный photo asset: ${file}`)
    }

    for (const file of packedDecorFiles) {
      if (!expectedDecorFiles.includes(file))
        errors.push(`package содержит неожиданный decor asset: ${file}`)
    }

    for (let number = 1; number <= 30; number++) {
      const pngPath = `public/photos/photo-${number}.png`
      if (files.has(pngPath))
        errors.push(`package не должен содержать ${pngPath}`)
    }

    if (!files.has('LICENSE'))
      errors.push('package должен содержать LICENSE')

    if (!files.has('skills/slidev-practicum/SKILL.md'))
      errors.push('package должен содержать skills/slidev-practicum/SKILL.md')

    if (!files.has('example.md'))
      errors.push('package должен содержать example.md как каноническую колоду для авторов')

    const defaultDeckTargets = new Set(
      Object.values(manifest.scripts ?? {})
        .flatMap(script => String(script).match(/\b[\w-]+\.md\b/g) ?? []),
    )
    for (const target of defaultDeckTargets) {
      if (!files.has(target))
        errors.push(`package script ссылается на отсутствующий deck target: ${target}`)
    }

    for (const guidancePath of ['README.md', 'skills/slidev-practicum/SKILL.md']) {
      const guidance = readFileSync(join(PROJECT_ROOT, guidancePath), 'utf8')
      if (!guidance.includes('example.md'))
        errors.push(`${guidancePath} должен ссылаться на канонический example.md`)
    }

    if (files.has('vite.config.mjs'))
      errors.push('package не должен содержать локальный vite.config.mjs')

    if (manifest.slidev?.defaults?.favicon !== '/theme/favicon.svg')
      errors.push('package manifest должен задавать favicon как /theme/favicon.svg')

    if (pack.size > MAX_PACKAGE_SIZE)
      errors.push(`package ${pack.size} bytes превышает лимит ${MAX_PACKAGE_SIZE} bytes`)

    if (errors.length > 0) {
      for (const error of errors)
        console.error(`- ${error}`)

      process.exitCode = 1
    }
    else {
      console.log(
        `Артефакт пакета: ${pack.size} байт, ${pack.files.length} файлов, `
        + `фото=${expectedPhotoFiles.length}, декоров=${expectedDecorFiles.length}`,
      )
    }
  }
}
finally {
  rmSync(cacheDir, { recursive: true, force: true })
}
