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
import { spawn } from 'node:child_process'
import { basename, dirname, join, relative, sep } from 'node:path'
import lockfile from 'proper-lockfile'

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

async function isGitRepositoryRoot(root: string): Promise<boolean> {
  const toplevel = await new Promise<string | undefined>((resolve) => {
    const child = spawn('git', ['rev-parse', '--show-toplevel'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.once('error', () => resolve(undefined))
    child.once('close', (code) =>
      resolve(
        code === 0
          ? Buffer.concat(chunks).toString('utf8').trim() || undefined
          : undefined,
      ),
    )
  })
  if (!toplevel) return false
  try {
    return (await realpath(toplevel)) === root
  } catch {
    return false
  }
}

async function gitIgnoredPaths(
  root: string,
  paths: readonly string[],
): Promise<Set<string>> {
  if (!paths.length) return new Set()
  return await new Promise((resolve) => {
    const child = spawn(
      'git',
      ['check-ignore', '--no-index', '--stdin', '-z'],
      {
        cwd: root,
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    )
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.once('error', () => resolve(new Set()))
    child.once('close', (code) => {
      if (code !== 0 && code !== 1) {
        resolve(new Set())
        return
      }
      const output = Buffer.concat(chunks).toString('utf8')
      resolve(new Set(output.split('\0').filter(Boolean)))
    })
    child.stdin.end(`${paths.join('\0')}\0`)
  })
}

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
  private readonly gitIgnoreEnabled: boolean

  private constructor(
    root: string,
    options: WorkspaceServiceOptions,
    gitIgnoreEnabled: boolean,
  ) {
    this.root = root
    this.maxReadBytes = options.maxReadBytes ?? 2 * 1024 * 1024
    this.maxTreeDepth = options.maxTreeDepth ?? 12
    this.maxTreeEntries = options.maxTreeEntries ?? 10_000
    this.isIgnored = createIgnoreMatcher(options.ignorePatterns)
    this.gitIgnoreEnabled = gitIgnoreEnabled
  }

  static async create(
    workspaceRoot: string,
    options: WorkspaceServiceOptions = {},
  ): Promise<WorkspaceService> {
    try {
      const root = await realpath(workspaceRoot)
      return new WorkspaceService(
        root,
        options,
        await isGitRepositoryRoot(root),
      )
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

  private assertAllowedPath(relativePath: string): void {
    assertNonSecretPath(relativePath)
    if (this.isIgnored(relativePath))
      throw new WorkspaceError(
        'PATH_OUTSIDE_WORKSPACE',
        'The path is ignored.',
        403,
      )
  }

  private assertAllowedCanonicalPath(absolutePath: string): void {
    if (!isContained(this.root, absolutePath))
      throw new WorkspaceError(
        'PATH_OUTSIDE_WORKSPACE',
        'The resolved path escapes the workspace.',
        403,
      )
    this.assertAllowedPath(
      relative(this.root, absolutePath).split(sep).join('/'),
    )
  }

  private async resolveReadablePath(relativePath: string): Promise<string> {
    this.assertAllowedPath(relativePath)
    const absolutePath = await resolveExistingPath(this.root, relativePath)
    this.assertAllowedCanonicalPath(absolutePath)
    return absolutePath
  }

  private async prepareWriteTarget(relativePath: string): Promise<string> {
    const parents = relativePath.split('/').slice(0, -1)
    let parent = this.root
    for (let index = 0; index < parents.length; index++) {
      const candidate = join(parent, parents[index]!)
      try {
        parent = await realpath(candidate)
        this.assertAllowedCanonicalPath(parent)
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
        let exists = false
        try {
          await lstat(candidate)
          exists = true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        if (exists)
          throw new WorkspaceError(
            'PATH_OUTSIDE_WORKSPACE',
            'The destination link cannot be resolved safely.',
            403,
          )
        parent = join(parent, ...parents.slice(index))
        break
      }
    }
    this.assertAllowedCanonicalPath(join(parent, basename(relativePath)))
    await mkdir(parent, { recursive: true })
    parent = await realpath(parent)
    const target = join(parent, basename(relativePath))
    this.assertAllowedCanonicalPath(target)
    return target
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
      const candidates = entries
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => ({
          entry,
          absolutePath: join(directory, entry.name),
          relativePath: relative(this.root, join(directory, entry.name))
            .split(sep)
            .join('/'),
        }))
        .filter(({ relativePath }) => !this.isIgnored(relativePath))
      const ignored = this.gitIgnoreEnabled
        ? await gitIgnoredPaths(
            this.root,
            candidates.map(({ relativePath }) => relativePath),
          )
        : new Set<string>()
      for (const { entry, absolutePath, relativePath } of candidates) {
        if (ignored.has(relativePath)) continue
        if (++visited > this.maxTreeEntries) {
          throw new WorkspaceError(
            'FILE_TOO_LARGE',
            `Workspace tree exceeds ${this.maxTreeEntries} entries.`,
            413,
          )
        }
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
    const absolutePath = await this.resolveReadablePath(relativePath)
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
    const absolutePath = await this.resolveReadablePath(relativePath)
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
    if (!/\.(?:gif|jpe?g|png|webp)$/i.test(relativePath)) {
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'Only PNG, JPEG, GIF and WebP image attachments are supported.',
        400,
      )
    }
    const absolutePath = await this.resolveReadablePath(relativePath)
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
    this.assertAllowedPath(relativePath)
    if (!relativePath.toLowerCase().endsWith(extension)) {
      throw new WorkspaceError(
        'INVALID_REQUEST',
        `The destination extension must be ${extension}.`,
        400,
      )
    }
    const target = await this.prepareWriteTarget(relativePath)
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
    this.assertAllowedPath(relativePath)

    const bytes = Buffer.from(input.content, 'utf8')
    if (isBinaryContent(bytes)) {
      throw new WorkspaceError(
        'INVALID_REQUEST',
        'Binary content cannot be written as text.',
        400,
      )
    }
    if (bytes.byteLength > this.maxReadBytes) {
      throw new WorkspaceError(
        'FILE_TOO_LARGE',
        `File exceeds the ${this.maxReadBytes} byte write limit.`,
        413,
      )
    }

    const target = await this.prepareWriteTarget(relativePath)
    const realParent = dirname(target)
    let release: () => Promise<void>
    try {
      release = await lockfile.lock(target, {
        realpath: false,
        lockfilePath: join(
          realParent,
          `.${basename(target)}.fastppt-write-lock`,
        ),
      })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ELOCKED')
        throw new WorkspaceError(
          'FILE_REVISION_CONFLICT',
          'Another writer is updating this file.',
          409,
        )
      throw cause
    }
    try {
      let current: FileContent | undefined
      try {
        current = await this.readTextFile(relativePath)
      } catch (cause) {
        if (
          !(cause instanceof WorkspaceError) ||
          cause.code !== 'FILE_NOT_FOUND'
        )
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
      return await this.readTextFile(relativePath)
    } finally {
      await release()
    }
  }
}
