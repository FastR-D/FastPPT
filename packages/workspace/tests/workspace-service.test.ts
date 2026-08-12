import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  WorkspaceError,
  WorkspaceService,
  createIgnoreMatcher,
  normalizeRelativePath,
} from '../src/index.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

describe('workspace path policy', () => {
  it('reports a stable error when the workspace root is missing', async () => {
    const root = join(tmpdir(), `fastppt-missing-${randomUUID()}`)
    await expect(WorkspaceService.create(root)).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_FOUND',
      statusCode: 404,
      details: { workspaceRoot: root },
    })
  })

  it('normalizes safe relative paths and rejects traversal', () => {
    expect(normalizeRelativePath('./deck/../slides.md')).toBe('slides.md')
    expect(() => normalizeRelativePath('../../secret')).toThrow(WorkspaceError)
    expect(() => normalizeRelativePath('/etc/passwd')).toThrow(WorkspaceError)
  })

  it('ignores generated directories at any workspace depth', () => {
    const ignores = createIgnoreMatcher()

    expect(ignores('dev/outputs')).toBe(true)
    expect(ignores('dev/outputs/result.json')).toBe(true)
    expect(ignores('packages/web/node_modules/vite/index.js')).toBe(true)
    expect(ignores('packages/web/dist/assets/index.js')).toBe(true)
    expect(ignores('services/api/.venv/bin/python')).toBe(true)
    expect(ignores('slides/outputs.md')).toBe(false)
  })

  it('blocks symlink escape and common secret files', async () => {
    const root = temporaryDirectory('fastppt-workspace-')
    const outside = temporaryDirectory('fastppt-outside-')
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    symlinkSync(outside, join(root, 'escape'))
    writeFileSync(join(root, '.env'), 'TOKEN=secret')
    const workspace = await WorkspaceService.create(root)
    await expect(
      workspace.readTextFile('escape/secret.txt'),
    ).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
    await expect(workspace.readTextFile('.env')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
  })
})

describe('workspace files', () => {
  it('reads, atomically writes and enforces revisions', async () => {
    const root = temporaryDirectory('fastppt-workspace-')
    mkdirSync(join(root, 'deck'))
    writeFileSync(join(root, 'deck', 'slides.md'), '# Before\n')
    const workspace = await WorkspaceService.create(root)
    const before = await workspace.readTextFile('deck/slides.md')
    const after = await workspace.writeTextFile({
      path: 'deck/slides.md',
      content: '# After\n',
      expectedRevision: before.revision,
    })
    expect(after.content).toBe('# After\n')
    expect(readFileSync(join(root, 'deck', 'slides.md'), 'utf8')).toBe(
      '# After\n',
    )
    await expect(
      workspace.writeTextFile({
        path: 'deck/slides.md',
        content: '# Stale\n',
        expectedRevision: before.revision,
      }),
    ).rejects.toMatchObject({ code: 'FILE_REVISION_CONFLICT', statusCode: 409 })
  })

  it('filters ignored output and rejects binary or oversized content', async () => {
    const root = temporaryDirectory('fastppt-workspace-')
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules', 'ignored.js'), 'ignored')
    mkdirSync(join(root, 'dev', 'outputs'), { recursive: true })
    writeFileSync(join(root, 'dev', 'outputs', 'result.json'), 'ignored')
    writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 1, 2]))
    writeFileSync(join(root, 'large.md'), 'too large')
    const workspace = await WorkspaceService.create(root, { maxReadBytes: 4 })
    expect(
      (await workspace.listFiles()).map((node) => node.name),
    ).not.toContain('node_modules')
    expect(
      (await workspace.listFiles()).find((node) => node.name === 'dev')
        ?.children,
    ).toEqual([])
    await expect(workspace.readTextFile('binary.bin')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    })
    await expect(workspace.readTextFile('large.md')).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    })
  })

  it('resolves only contained supported image attachments', async () => {
    const root = temporaryDirectory('fastppt-workspace-')
    const outside = temporaryDirectory('fastppt-outside-')
    mkdirSync(join(root, 'assets'))
    writeFileSync(
      join(root, 'assets', 'diagram.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
    writeFileSync(join(root, 'notes.txt'), 'not an image')
    writeFileSync(join(outside, 'secret.png'), Buffer.from([1, 2, 3]))
    symlinkSync(outside, join(root, 'escaped-assets'))
    const workspace = await WorkspaceService.create(root)
    await expect(
      workspace.resolveImageAttachment('assets/diagram.png'),
    ).resolves.toBe(join(root, 'assets', 'diagram.png'))
    await expect(
      workspace.resolveImageAttachment('notes.txt'),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(
      workspace.resolveImageAttachment('escaped-assets/secret.png'),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
  })

  it('writes image assets to exact safe destinations without overwriting', async () => {
    const root = temporaryDirectory('fastppt-workspace-')
    const workspace = await WorkspaceService.create(root)
    const bytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ])
    await expect(
      workspace.writeImageAsset({
        name: 'figure.png',
        mediaType: 'image/png',
        bytes,
        destinationPath: 'assets/generated/figure.png',
      }),
    ).resolves.toMatchObject({ path: 'assets/generated/figure.png' })
    await expect(
      workspace.writeImageAsset({
        name: 'figure.png',
        mediaType: 'image/png',
        bytes,
        destinationPath: 'assets/generated/figure.png',
      }),
    ).rejects.toMatchObject({ code: 'FILE_REVISION_CONFLICT' })
    await expect(
      workspace.writeImageAsset({
        name: 'figure.png',
        mediaType: 'image/png',
        bytes,
        destinationPath: '../figure.png',
      }),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
  })
})
