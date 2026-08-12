import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export const EXPECTED_THEME_PHOTOS = Object.freeze(
  Array.from({ length: 30 }, (_, index) => `photos/photo-${index + 1}.webp`),
)

export const EXPECTED_THEME_DECORS = Object.freeze([
  'decor/decor-1.svg',
  'decor/decor-2.png',
  'decor/decor-3.svg',
  'decor/decor-4.svg',
  'decor/decor-5.png',
  'decor/decor-6.png',
  'decor/decor-7.png',
  'decor/decor-8.svg',
  'decor/decor-9.svg',
  'decor/decor-10.svg',
  'decor/decor-11.svg',
  'decor/decor-12.svg',
  'decor/decor-13.svg',
  'decor/decor-14.svg',
  'decor/decor-15.svg',
  'decor/decor-16.svg',
  'decor/decor-17.png',
  'decor/decor-18.png',
  'decor/decor-19.svg',
])

export const EXPECTED_THEME_ASSETS = Object.freeze([
  'favicon.svg',
  ...EXPECTED_THEME_DECORS,
  ...EXPECTED_THEME_PHOTOS,
])

/**
 * @param {string} path
 */
export function toPosixPath(path) {
  return String(path).replaceAll('\\', '/')
}

/**
 * @param {string} directory
 * @param {readonly string[]} expectedNames
 */
export async function validateAssetDirectory(directory, expectedNames) {
  const directoryStat = await lstat(directory)

  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
    throw new Error(`source inventory должен быть обычной директорией: ${directory}`)

  const names = await readdir(directory)
  const actual = new Set(names)
  const expected = new Set(expectedNames)
  const errors = []

  if (expected.size !== expectedNames.length)
    errors.push('ожидаемый inventory содержит дубли')

  const missing = expectedNames.filter(name => !actual.has(name))
  const unexpected = names.filter(name => !expected.has(name))

  if (missing.length > 0)
    errors.push(`отсутствуют файлы: ${missing.join(', ')}`)

  if (unexpected.length > 0)
    errors.push(`неожиданные файлы: ${unexpected.join(', ')}`)

  await Promise.all(names.map(async (name) => {
    const fileStat = await lstat(join(directory, name))

    if (fileStat.isSymbolicLink())
      errors.push(`файл не должен быть symlink: ${name}`)
    else if (!fileStat.isFile())
      errors.push(`должен быть обычным файлом: ${name}`)
  }))

  if (errors.length > 0)
    throw new Error(`source inventory не прошёл проверку: ${errors.join('; ')}`)

  return names.sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
}
