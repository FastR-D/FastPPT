import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'
import {
  EXPECTED_THEME_ASSETS,
  EXPECTED_THEME_DECORS,
  EXPECTED_THEME_PHOTOS,
  toPosixPath,
} from './theme-asset-inventory.mjs'
import {
  findThemeAssetOccurrences,
  readArtifactContentsWithinLimit,
} from './build-artifact-assets.mjs'

const MAX_BUILD_SIZE = 20 * 1024 * 1024
const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const DIST_DIR = join(PROJECT_ROOT, 'dist')
const errors = []

/**
 * @param {string} root
 * @param {string} path
 */
function isContained(root, path) {
  const relativePath = toPosixPath(relative(root, path))

  return relativePath === ''
    || (relativePath !== '..' && !relativePath.startsWith('../') && !isAbsolute(relativePath))
}

/**
 * @param {string} directory
 * @param {string} distRealPath
 * @returns {Promise<Array<{ path: string, relativePath: string, size: number }>>}
 */
async function listFiles(directory, distRealPath) {
  const entries = await readdir(directory)
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry)
    const fileStat = await lstat(path)
    const relativePath = toPosixPath(relative(DIST_DIR, path))

    if (fileStat.isSymbolicLink()) {
      errors.push(`dist не должен содержать symlink: ${relativePath}`)
      return []
    }

    const realPath = await realpath(path)
    if (!isContained(distRealPath, realPath)) {
      errors.push(`dist asset выходит за пределы dist: ${relativePath}`)
      return []
    }

    if (fileStat.isDirectory())
      return listFiles(path, distRealPath)

    if (!fileStat.isFile()) {
      errors.push(`dist содержит недопустимый тип файла: ${relativePath}`)
      return []
    }

    return [{
      path,
      relativePath,
      size: fileStat.size,
    }]
  }))

  return nestedFiles.flat()
}

/**
 * @param {string} relativePath
 * @param {string} distRealPath
 */
async function validateRequiredAsset(relativePath, distRealPath) {
  const path = resolve(DIST_DIR, relativePath)

  if (!isContained(DIST_DIR, path)) {
    errors.push(`обязательный asset выходит за пределы dist: ${relativePath}`)
    return
  }

  try {
    const fileStat = await lstat(path)

    if (fileStat.isSymbolicLink()) {
      errors.push(`обязательный asset не должен быть symlink: ${relativePath}`)
      return
    }

    if (!fileStat.isFile()) {
      errors.push(`обязательный asset должен быть файлом: ${relativePath}`)
      return
    }

    const realPath = await realpath(path)
    if (!isContained(distRealPath, realPath))
      errors.push(`обязательный asset выходит за пределы dist: ${relativePath}`)
  }
  catch {
    errors.push(`обязательный asset отсутствует: ${relativePath}`)
  }
}

/**
 * @param {string} label
 * @param {string[]} actualPaths
 * @param {readonly string[]} expectedPaths
 */
function compareInventory(label, actualPaths, expectedPaths) {
  const actual = new Set(actualPaths)
  const expected = new Set(expectedPaths)
  const missing = expectedPaths.filter(path => !actual.has(path))
  const unexpected = actualPaths.filter(path => !expected.has(path))

  if (missing.length > 0)
    errors.push(`${label} не содержит: ${missing.join(', ')}`)

  if (unexpected.length > 0)
    errors.push(`${label} содержит неожиданные файлы: ${unexpected.join(', ')}`)
}

let files = []
let distRealPath = ''

try {
  const distStat = await lstat(DIST_DIR)

  if (distStat.isSymbolicLink())
    errors.push('dist не должен быть symlink')
  else if (!distStat.isDirectory())
    errors.push('dist должен быть директорией')
  else {
    distRealPath = await realpath(DIST_DIR)
    files = await listFiles(DIST_DIR, distRealPath)
  }
}
catch {
  errors.push('dist отсутствует: сначала запустите npm run test:build')
}

if (distRealPath) {
  const expectedAssets = EXPECTED_THEME_ASSETS.map(path => `theme/${path}`)
  await Promise.all(expectedAssets.map(path => validateRequiredAsset(path, distRealPath)))
}

const relativeFiles = files.map(file => file.relativePath)
const relativeFileSet = new Set(relativeFiles)
const expectedPhotoFiles = EXPECTED_THEME_PHOTOS.map(path => `theme/${path}`)
const expectedDecorFiles = EXPECTED_THEME_DECORS.map(path => `theme/${path}`)
const actualPhotoFiles = relativeFiles.filter(path => path.startsWith('theme/photos/'))
const actualDecorFiles = relativeFiles.filter(path => path.startsWith('theme/decor/'))
const {
  filesWithContent,
  overLimit,
  totalBytes,
} = await readArtifactContentsWithinLimit(
  files,
  MAX_BUILD_SIZE,
  async file => await readFile(file.path),
)

if (overLimit) {
  errors.push(`dist ${totalBytes} байт превышает лимит ${MAX_BUILD_SIZE} байт`)
  for (const error of errors)
    console.error(`- ${error}`)
  process.exit(1)
}

compareInventory('dist/theme/photos', actualPhotoFiles, expectedPhotoFiles)
compareInventory('dist/theme/decor', actualDecorFiles, expectedDecorFiles)

for (let number = 1; number <= 30; number++) {
  for (const path of [
    `photos/photo-${number}.png`,
    `theme/photos/photo-${number}.png`,
  ]) {
    if (relativeFileSet.has(path))
      errors.push(`dist не должен содержать ${path}`)
  }
}

try {
  await lstat(join(DIST_DIR, 'photos'))
  errors.push('dist/photos не должен существовать')
}
catch {
  // Ожидаем отсутствие deck-level photos.
}

const duplicatePaths = relativeFiles
  .filter(path => path.startsWith('theme/'))
  .map(path => path.slice('theme/'.length))
  .filter(path => relativeFileSet.has(path))

if (duplicatePaths.length > 0)
  errors.push(`dist содержит дубли theme assets: ${duplicatePaths.join(', ')}`)

const expectedThemeAssetPaths = new Set(EXPECTED_THEME_ASSETS.map(path => `theme/${path}`))
const themeAssetsWithContent = filesWithContent.filter(file =>
  expectedThemeAssetPaths.has(file.relativePath),
)

for (const { assetPath, occurrences } of findThemeAssetOccurrences(
  themeAssetsWithContent,
  filesWithContent,
)) {
  if (occurrences.length !== 1) {
    errors.push(
      `${assetPath} должен встречаться в dist по содержимому ровно один раз; `
      + `найдено ${occurrences.length}: ${occurrences.join(', ')}`,
    )
  }
}

const htmlContents = filesWithContent
  .filter(file => file.relativePath.endsWith('.html'))
  .map(file => ({
    path: file.relativePath,
    content: file.content.toString(),
  }))
const rootFaviconReferences = htmlContents
  .filter(file => /(?:href|src)=["']\/favicon\.svg(?:[?#][^"']*)?["']/.test(file.content))
  .map(file => file.path)

if (rootFaviconReferences.length > 0)
  errors.push(`HTML ссылается на /favicon.svg: ${rootFaviconReferences.join(', ')}`)

if (!htmlContents.some(file => file.content.includes('/theme/favicon.svg')))
  errors.push('HTML не содержит ссылку на /theme/favicon.svg')

if (errors.length > 0) {
  for (const error of errors)
    console.error(`- ${error}`)

  process.exit(1)
}

console.log(
  `Артефакт сборки: ${totalBytes} байт, ${files.length} файлов, `
  + `фото=${actualPhotoFiles.length}, декоров=${actualDecorFiles.length}`,
)
