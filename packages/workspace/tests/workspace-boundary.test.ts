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
import { afterEach, expect, it } from 'vitest'
import { WorkspaceService } from '../src/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})
function directory() {
  const root = mkdtempSync(join(tmpdir(), 'workspace-boundary-'))
  roots.push(root)
  return root
}
function directoryLink(target: string, path: string) {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

for (const target of ['.ssh', 'dist', 'private']) {
  it(`enforces canonical secret/ignore policy behind an alias to ${target}`, async () => {
    const root = directory()
    mkdirSync(join(root, target))
    writeFileSync(join(root, target, 'notes.md'), 'protected content')
    writeFileSync(join(root, target, 'image.png'), png)
    directoryLink(join(root, target), join(root, 'alias'))
    const workspace = await WorkspaceService.create(root, {
      ignorePatterns: ['private', 'private/**'],
    })
    await expect(
      workspace.readTextFile('alias/notes.md'),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
    await expect(
      workspace.assertFileAvailable('alias/notes.md'),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
    await expect(
      workspace.resolveImageAttachment('alias/image.png'),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
    await expect(
      workspace.writeTextFile({ path: 'alias/notes.md', content: 'overwrite' }),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
    await expect(
      workspace.writeImageAsset({
        name: 'new.png',
        mediaType: 'image/png',
        bytes: png,
        destinationPath: 'alias/new.png',
      }),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
    expect(readFileSync(join(root, target, 'notes.md'), 'utf8')).toBe(
      'protected content',
    )
    expect(readdirSync(join(root, target)).sort()).toEqual([
      'image.png',
      'notes.md',
    ])
  })
}

it('rejects escaped text/image parents before creating any outside directory', async () => {
  const root = directory(),
    outside = directory()
  directoryLink(outside, join(root, 'escape'))
  const workspace = await WorkspaceService.create(root)
  await expect(
    workspace.writeTextFile({
      path: 'escape/new/deck.md',
      content: 'ordinary text',
    }),
  ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
  expect(readdirSync(outside)).toEqual([])
  await expect(
    workspace.writeImageAsset({
      name: 'new.png',
      mediaType: 'image/png',
      bytes: png,
      destinationPath: 'escape/images/new.png',
    }),
  ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
  expect(readdirSync(outside)).toEqual([])
})

it('allows an ordinary in-workspace alias and safe new parent directories', async () => {
  const root = directory()
  mkdirSync(join(root, 'real'))
  writeFileSync(join(root, 'real', 'deck.md'), '# Before\n')
  directoryLink(join(root, 'real'), join(root, 'alias'))
  const workspace = await WorkspaceService.create(root)
  const before = await workspace.readTextFile('alias/deck.md')
  const saved = await workspace.writeTextFile({
    path: 'alias/deck.md',
    content: '# After\n',
    expectedRevision: before.revision,
  })
  expect(saved.content).toBe('# After\n')
  expect(readFileSync(join(root, 'real', 'deck.md'), 'utf8')).toBe('# After\n')
  await workspace.writeTextFile({
    path: 'alias/new/deck.md',
    content: '# New\n',
  })
  expect(readFileSync(join(root, 'real', 'new', 'deck.md'), 'utf8')).toBe(
    '# New\n',
  )
})

it('commits one writer per expected revision across independent service instances', async () => {
  const root = directory()
  writeFileSync(join(root, 'deck.md'), '# Before\n')
  const first = await WorkspaceService.create(root),
    second = await WorkspaceService.create(root)
  const before = await first.readTextFile('deck.md')
  const attempts = await Promise.allSettled(
    Array.from({ length: 16 }, (_, index) =>
      (index % 2 ? first : second).writeTextFile({
        path: 'deck.md',
        content: `# Writer ${index}\n`,
        expectedRevision: before.revision,
      }),
    ),
  )
  const winners = attempts.filter(
    (
      item,
    ): item is PromiseFulfilledResult<
      Awaited<ReturnType<WorkspaceService['writeTextFile']>>
    > => item.status === 'fulfilled',
  )
  expect(winners).toHaveLength(1)
  for (const item of attempts)
    if (item.status === 'rejected')
      expect(item.reason).toMatchObject({ code: 'FILE_REVISION_CONFLICT' })
  expect((await first.readTextFile('deck.md')).content).toBe(
    winners[0]!.value.content,
  )
  expect(readdirSync(root)).toEqual(['deck.md'])
})
