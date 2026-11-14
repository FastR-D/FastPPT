import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
  it('rejects NUL overwrites without changing bytes, revision or directory entries', async () => {
    const root = temporaryDirectory('fastppt-workspace-')
    const original = Buffer.from('# 原文 🌍\n')
    writeFileSync(join(root, 'slides.md'), original)
    const workspace = await WorkspaceService.create(root)
    const before = await workspace.readTextFile('slides.md')

    await expect(
      workspace.writeTextFile({
        path: 'slides.md',
        content: 'bad\0text',
        expectedRevision: before.revision,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', statusCode: 400 })

    expect(readFileSync(join(root, 'slides.md'))).toEqual(original)
    expect(await workspace.readTextFile('slides.md')).toEqual(before)
    expect(readdirSync(root)).toEqual(['slides.md'])
  })

  it('rejects NUL before creating parents and still round-trips Unicode text', async () => {
    const root = temporaryDirectory('fastppt-workspace-')
    const workspace = await WorkspaceService.create(root)
    await expect(
      workspace.writeTextFile({ path: 'new/deck/slides.md', content: '\0' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', statusCode: 400 })
    expect(readdirSync(root)).toEqual([])

    const content = '# 你好 🌍\n'
    const saved = await workspace.writeTextFile({
      path: 'new/deck/slides.md',
      content,
    })
    expect(readFileSync(join(root, 'new/deck/slides.md'), 'utf8')).toBe(content)
    expect(await workspace.readTextFile(saved.path)).toEqual(saved)
  })

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

  it('honors root and nested gitignore files before counting tree entries', async () => {
    const root = temporaryDirectory('fastppt-gitignore-workspace-')
    execFileSync('git', ['init', '-q'], { cwd: root })
    writeFileSync(join(root, '.gitignore'), 'generated/\n')
    mkdirSync(join(root, 'generated', 'nested'), { recursive: true })
    writeFileSync(join(root, 'generated', 'large.json'), '{}')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', '.gitignore'), '*.tmp\ncache/\n')
    writeFileSync(join(root, 'src', 'notes.tmp'), 'ignored')
    mkdirSync(join(root, 'src', 'cache'))
    writeFileSync(join(root, 'src', 'cache', 'index.json'), '{}')
    writeFileSync(join(root, 'src', 'slides.md'), '# Visible\n')

    const workspace = await WorkspaceService.create(root, {
      maxTreeEntries: 4,
    })
    const files = await workspace.listFiles()
    expect(files.map((node) => node.name)).toEqual(['.gitignore', 'src'])
    expect(files.find((node) => node.name === 'src')?.children).toEqual([
      expect.objectContaining({ name: '.gitignore' }),
      expect.objectContaining({ name: 'slides.md' }),
    ])
  })

  it('ignores an enclosing repository rule that hides a nested workspace', async () => {
    const repository = temporaryDirectory('fastppt-enclosing-repo-')
    execFileSync('git', ['init', '-q'], { cwd: repository })
    writeFileSync(join(repository, '.gitignore'), 'examples/\n')
    const root = join(repository, 'examples', 'demo-deck')
    mkdirSync(join(root, 'assets'), { recursive: true })
    writeFileSync(join(root, 'slides.md'), '# Visible\n')
    writeFileSync(join(root, 'assets', 'logo.png'), 'image')

    const workspace = await WorkspaceService.create(root)
    expect((await workspace.listFiles()).map((node) => node.name)).toEqual([
      'assets',
      'slides.md',
    ])
    expect(
      (await workspace.listFiles()).find((node) => node.name === 'assets')
        ?.children,
    ).toEqual([expect.objectContaining({ name: 'logo.png' })])
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
