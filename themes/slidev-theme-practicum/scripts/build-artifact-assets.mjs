import { createHash } from 'node:crypto'

function contentHash(content) {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * @template {{ relativePath: string, size: number }} T
 * @param {T[]} files
 * @param {number} maxBytes
 * @param {(file: T) => Promise<string | NodeJS.ArrayBufferView>} readContent
 */
export async function readArtifactContentsWithinLimit(files, maxBytes, readContent) {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)

  if (totalBytes > maxBytes) {
    return {
      filesWithContent: [],
      overLimit: true,
      totalBytes,
    }
  }

  const filesWithContent = await Promise.all(files.map(async file => ({
    relativePath: file.relativePath,
    content: await readContent(file),
  })))

  return {
    filesWithContent,
    overLimit: false,
    totalBytes,
  }
}

/**
 * @param {Array<{ relativePath: string, content: string | NodeJS.ArrayBufferView }>} themeAssets
 * @param {Array<{ relativePath: string, content: string | NodeJS.ArrayBufferView }>} distFiles
 */
export function findThemeAssetOccurrences(themeAssets, distFiles) {
  const pathsByHash = new Map()

  for (const file of distFiles) {
    const hash = contentHash(file.content)
    const paths = pathsByHash.get(hash) ?? []

    paths.push(file.relativePath)
    pathsByHash.set(hash, paths)
  }

  return themeAssets.map(asset => ({
    assetPath: asset.relativePath,
    occurrences: [...(pathsByHash.get(contentHash(asset.content)) ?? [])].sort(),
  }))
}
