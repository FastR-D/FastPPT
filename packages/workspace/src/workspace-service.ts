import { randomUUID } from 'node:crypto'
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'

import type {
  FileContent,
  FileNode,
  WorkspaceImageAsset,
  WriteFileRequest,
} from '@fastppt/protocol'

import { WorkspaceError } from './errors.js'
import {
  assertNonSecretPath,
  createIgnoreMatcher,
  isContained,
  normalizeRelativePath,
  resolveExistingPath,
} from './path-policy.js'
import { createRevision, isBinaryContent } from './revision.js'

export interface WorkspaceServiceOptions {
  maxReadBytes?: number
  ignorePatterns?: readonly string[]
  maxTreeDepth?: number
  maxTreeEntries?: number
}

export class WorkspaceService {
  readonly root: string
  private readonly maxReadBytes: number
  private readonly maxTreeDepth: number
  private readonly maxTreeEntries: number
  private readonly isIgnored: (path: string) => boolean

  private constructor(root: string, options: WorkspaceServiceOptions) {
    this.root = root
    this.maxReadBytes = options.maxReadBytes ?? 2 * 1024 * 1024
    this.maxTreeDepth = options.maxTreeDepth ?? 12
    this.maxTreeEntries = options.maxTreeEntries ?? 10_000
    this.isIgnored = createIgnoreMatcher(options.ignorePatterns)
  }

  static async create(
    workspaceRoot: string,
    options: WorkspaceServiceOptions = {},
  ): Promise<WorkspaceService> {
    try {
      return new WorkspaceService(await realpath(workspaceRoot), options)
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new WorkspaceError(
          'WORKSPACE_NOT_FOUND',
          `Workspace does not exist: ${workspaceRoot}`,
          404,
          { workspaceRoot },
        )
      }
      throw cause
    }
  }

  ignores(relativePath: string): boolean {
    return this.isIgnored(relativePath)
  }

  async listFiles(): Promise<FileNode[]> {
    let visited = 0
    const visit = async (
      directory: string,
      depth: number,
    ): Promise<FileNode[]> => {
      if (depth > this.maxTreeDepth) return []
      const entries = await readdir(directory, { withFileTypes: true })
      const nodes: FileNode[] = []
      for (const entry of entries.sort((left, right) =>
        left.name.localeCompare(right.name),
      )) {
        if (++visited > this.maxTreeEntries) {
          throw new WorkspaceError(
            'FILE_TOO_LARGE',
            `Workspace tree exceeds ${this.maxTreeEntries} entries.`,
            413,
          )
        }
        const absolutePath = join(directory, entry.name)
        const relativePath = relative(this.root, absolutePath)
          .split(sep)
          .join('/')
        if (this.isIgnored(relativePath)) continue

        const metadata = await lstat(absolutePath)
        let resolved: string
        try {
          resolved = await realpath(absolutePath)
        } catch {
          continue
        }
        if (!isContained(this.root, resolved)) continue

        if (metadata.isDirectory()) {
          nodes.push({
            path: relativePath,
            name: entry.name,
            type: 'directory',
            modifiedAt: metadata.mtime.toISOString(),
            children: await visit(absolutePath, depth + 1),
          })
        } else if (metadata.isFile()) {
          nodes.push({
            path: relativePath,
            name: entry.name,
            type: 'file',
            size: metadata.size,
            modifiedAt: metadata.mtime.toISOString(),
          })
        }
      }
      return nodes
    }

    return visit(this.root, 0)
  }

  async readTextFile(requestedPath: string): Promise<FileContent> {
    const relativePath = normalizeRelativePath(requestedPath)
    assertNonSecretPath(relativePath)
    if (this.isIgnored(relativePath)) {
      throw new WorkspaceError(
        'PATH_OUTSIDE_WORKSPACE',
        'The path is ignored.',
        403,
      )
    }
    const absolutePath = await resolveExistingPath(this.root, relativePath)
    const metadata = await stat(absolutePath)
    if (!metadata.isFile()) {
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'The requested path is not a file.',
        400,
      )
    }
    if (metadata.size > this.maxReadBytes) {
      throw new WorkspaceError(
        'FILE_TOO_LARGE',
        `File exceeds the ${this.maxReadBytes} byte read limit.`,
        413,
      )
    }
    const buffer = await readFile(absolutePath)
    if (isBinaryContent(buffer)) {
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'Binary files cannot be read as text.',
        400,
      )
    }
    return {
      path: relativePath,
      content: buffer.toString('utf8'),
      revision: createRevision(buffer),
      size: buffer.byteLength,
      modifiedAt: metadata.mtime.toISOString(),
    }
  }

  async assertFileAvailable(requestedPath: string): Promise<void> {
    const relativePath = normalizeRelativePath(requestedPath)
    assertNonSecretPath(relativePath)
    if (this.isIgnored(relativePath)) {
      throw new WorkspaceError(
        'PATH_OUTSIDE_WORKSPACE',
        'The path is ignored.',
        403,
      )
    }
    const absolutePath = await resolveExistingPath(this.root, relativePath)
    const metadata = await stat(absolutePath)
    if (!metadata.isFile()) {
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'The requested path is not a file.',
        400,
      )
    }
  }

  async resolveImageAttachment(requestedPath: string): Promise<string> {
    const relativePath = normalizeRelativePath(requestedPath)
    assertNonSecretPath(relativePath)
    if (this.isIgnored(relativePath)) {
      throw new WorkspaceError(
        'PATH_OUTSIDE_WORKSPACE',
        'The attachment path is ignored.',
        403,
      )
    }
    if (!/\.(?:gif|jpe?g|png|webp)$/i.test(relativePath)) {
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'Only PNG, JPEG, GIF and WebP image attachments are supported.',
        400,
      )
    }
    const absolutePath = await resolveExistingPath(this.root, relativePath)
    const metadata = await stat(absolutePath)
    if (!metadata.isFile()) {
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'The attachment path is not a file.',
        400,
      )
    }
    if (metadata.size > 10 * 1024 * 1024) {
      throw new WorkspaceError(
        'FILE_TOO_LARGE',
        'Image attachments must not exceed 10 MiB.',
        413,
      )
    }
    return absolutePath
  }

  async writeImageAsset(input: {
    name: string
    mediaType: WorkspaceImageAsset['mediaType']
    bytes: Uint8Array
    destinationPath?: string
  }): Promise<WorkspaceImageAsset> {
    if (
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > 10 * 1024 * 1024
    )
      throw new WorkspaceError(
        'FILE_TOO_LARGE',
        'Image attachments must be between 1 byte and 10 MiB.',
        413,
      )
    const signatures: Record<WorkspaceImageAsset['mediaType'], number[][]> = {
      'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
      'image/jpeg': [[0xff, 0xd8, 0xff]],
      'image/gif': [
        [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
        [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
      ],
      'image/webp': [[0x52, 0x49, 0x46, 0x46]],
    }
    const matchesSignature = signatures[input.mediaType].some((signature) =>
      signature.every((byte, index) => input.bytes[index] === byte),
    )
    const matchesWebpContainer =
      input.mediaType !== 'image/webp' ||
      [0x57, 0x45, 0x42, 0x50].every(
        (byte, index) => input.bytes[index + 8] === byte,
      )
    if (!matchesSignature || !matchesWebpContainer)
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'The uploaded bytes do not match the declared image type.',
        400,
      )
    const extension = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
    }[input.mediaType]
    const stem = basename(input.name, extension)
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
    const relativePath = input.destinationPath
      ? normalizeRelativePath(input.destinationPath)
      : `assets/${stem || 'image'}-${randomUUID()}${extension}`
    if (!relativePath) {
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'An image destination path is required.',
        400,
      )
    }
    assertNonSecretPath(relativePath)
    if (this.isIgnored(relativePath)) {
      throw new WorkspaceError(
        'PATH_OUTSIDE_WORKSPACE',
        'The image destination path is ignored.',
        403,
      )
    }
    if (!relativePath.toLowerCase().endsWith(extension)) {
      throw new WorkspaceError(
        'INVALID_REQUEST',
        `The destination extension must be ${extension}.`,
        400,
      )
    }
    const unresolvedTarget = join(this.root, relativePath)
    await mkdir(dirname(unresolvedTarget), { recursive: true })
    const realParent = await realpath(dirname(unresolvedTarget))
    if (!isContained(this.root, realParent)) {
      throw new WorkspaceError(
        'PATH_OUTSIDE_WORKSPACE',
        'The image destination parent escapes the workspace.',
        403,
      )
    }
    const target = join(realParent, basename(unresolvedTarget))
    try {
      await lstat(target)
      throw new WorkspaceError(
        'FILE_REVISION_CONFLICT',
        'The image destination already exists.',
        409,
      )
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
    const temporary = `${target}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(input.bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await link(temporary, target)
    } catch (cause) {
      await unlink(temporary).catch(() => undefined)
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST')
        throw new WorkspaceError(
          'FILE_REVISION_CONFLICT',
          'The image destination already exists.',
          409,
        )
      throw cause
    }
    await unlink(temporary)
    return {
      path: relativePath,
      name: basename(relativePath),
      mediaType: input.mediaType,
      size: input.bytes.byteLength,
    }
  }

  async writeTextFile(input: WriteFileRequest): Promise<FileContent> {
    const relativePath = normalizeRelativePath(input.path)
    if (!relativePath) {
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'A file path is required.',
        400,
      )
    }
    assertNonSecretPath(relativePath)
    if (this.isIgnored(relativePath)) {
      throw new WorkspaceError(
        'PATH_OUTSIDE_WORKSPACE',
        'The path is ignored.',
        403,
      )
    }

    const bytes = Buffer.from(input.content, 'utf8')
    if (bytes.byteLength > this.maxReadBytes) {
      throw new WorkspaceError(
        'FILE_TOO_LARGE',
        `File exceeds the ${this.maxReadBytes} byte write limit.`,
        413,
      )
    }

    const unresolvedTarget = join(this.root, relativePath)
    await mkdir(dirname(unresolvedTarget), { recursive: true })
    const realParent = await realpath(dirname(unresolvedTarget))
    if (!isContained(this.root, realParent)) {
      throw new WorkspaceError(
        'PATH_OUTSIDE_WORKSPACE',
        'The target parent escapes the workspace.',
        403,
      )
    }
    const target = join(realParent, basename(unresolvedTarget))
    let current: FileContent | undefined
    try {
      current = await this.readTextFile(relativePath)
    } catch (cause) {
      if (!(cause instanceof WorkspaceError) || cause.code !== 'FILE_NOT_FOUND')
        throw cause
    }

    if (
      input.expectedRevision &&
      current?.revision !== input.expectedRevision
    ) {
      throw new WorkspaceError(
        'FILE_REVISION_CONFLICT',
        'The file changed since it was read.',
        409,
        { currentRevision: current?.revision },
      )
    }

    const temporary = join(
      realParent,
      `.${basename(target)}.${randomUUID()}.tmp`,
    )
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temporary, target)
    } catch (cause) {
      await unlink(temporary).catch(() => undefined)
      throw cause
    }
    return this.readTextFile(relativePath)
  }
}
