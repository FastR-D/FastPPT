import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { basename, join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parseCoreArguments, TOOL_COMMANDS } from '../src/core-arguments.js'
import {
  coreParameters,
  coreResultFailed,
  runCoreCommand,
} from '../src/core.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})
async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'fastppt-core-'))
  roots.push(root)
  return root
}

describe('core arguments and outcomes', () => {
  it('parses named options, JSON files, workspace paths and generic calls', () => {
    expect(
      parseCoreArguments(
        [
          'deck',
          'quality',
          '--path',
          'deck.md',
          '--slide=2',
          '--json',
          '--dir',
          '../deck',
        ],
        '/work',
      ),
    ).toMatchObject({
      command: 'deck quality',
      workspaceRoot: '/deck',
      parameters: { path: 'deck.md', slide: 2 },
      json: true,
    })
    expect(
      parseCoreArguments(
        ['tools', 'call', 'read_slides', '--input', '{"path":"deck.md"}'],
        '/work',
      ),
    ).toMatchObject({ tool: 'read_slides' })
    for (const argv of [
      ['theme', 'missing'],
      ['deck', 'read', '--wat'],
      ['deck', 'quality', '--slide', '0'],
      ['tools', 'call'],
      ['deck', 'read', '--input', '{}', '--input-file', 'a.json'],
    ])
      expect(() => parseCoreArguments(argv, '/work')).toThrow()
  })
  it('loads content without shell interpolation and gives flags precedence', async () => {
    const root = await temporaryRoot()
    await writeFile(
      join(root, 'input.json'),
      '{"path":"old.md","expectedRevision":"abc"}',
    )
    await writeFile(join(root, 'draft.md'), '# Literal $HOME `text`\n')
    const parameters = await coreParameters(
      parseCoreArguments(
        [
          'deck',
          'write',
          '--input-file',
          'input.json',
          '--path',
          'new.md',
          '--content-file',
          'draft.md',
        ],
        root,
      ),
    )
    expect(parameters).toEqual({
      path: 'new.md',
      expectedRevision: 'abc',
      content: '# Literal $HOME `text`\n',
    })
    await expect(
      coreParameters(
        parseCoreArguments(['deck', 'read', '--input', '[]'], root),
      ),
    ).rejects.toThrow('JSON object')
  })
  it('marks failed validation, overflow, unavailable checks and Skill conflicts unsuccessful', () => {
    for (const value of [
      { valid: false },
      { overflow: true },
      { inspectionAvailable: false },
      { issues: [{ severity: 'error' }] },
      { statuses: [{ state: 'conflict' }] },
    ])
      expect(coreResultFailed(value)).toBe(true)
    expect(
      coreResultFailed({ valid: true, issues: [{ severity: 'warning' }] }),
    ).toBe(false)
  })
})

describe('CLI core service integration', () => {
  it('dispatches generation and queries the same session through the workspace Gateway', async () => {
    const root = await temporaryRoot()
    const received: Array<{ path: string; body: unknown }> = []
    const server = createServer((request, response) => {
      void (async () => {
        let body = ''
        for await (const chunk of request) body += String(chunk)
        received.push({
          path: request.url!,
          body: body ? JSON.parse(body) : null,
        })
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify(
            request.url === '/api/v1/sessions'
              ? { sessionId: 'session-1' }
              : { runId: 'run-1', status: 'running' },
          ),
        )
      })().catch((error: Error) => response.destroy(error))
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    try {
      const address = server.address() as { port: number }
      await mkdir(join(root, '.fastppt/runtime'), { recursive: true })
      await writeFile(
        join(root, '.fastppt/runtime/gateway.json'),
        JSON.stringify({ version: 1, url: `http://127.0.0.1:${address.port}` }),
      )
      const paths = {
        packageRoot: '',
        bundledThemesRoot: '',
        themesRoot: '',
        commonSkillRoot: '',
        mcpServerEntry: '',
        slidevRunnerPath: '',
      }
      const input = parseCoreArguments(
        [
          'deck',
          'generate',
          '--input',
          JSON.stringify({
            prompt: 'Create the deck',
            profile: { version: 1 },
          }),
        ],
        root,
      )
      expect(await runCoreCommand(input, paths)).toMatchObject({
        sessionId: 'session-1',
        status: 'started',
        run: { runId: 'run-1' },
      })
      expect(received[0]).toMatchObject({
        path: '/api/v1/sessions',
        body: { harness: 'codex', cwd: root },
      })
      expect(received[1]).toEqual({
        path: '/api/v1/sessions/codex/session-1/messages',
        body: { content: 'Create the deck' },
      })
      expect(
        await runCoreCommand(
          parseCoreArguments(
            ['session', 'status', '--session', 'session-1'],
            root,
          ),
          paths,
        ),
      ).toMatchObject({
        session: { status: 'running' },
        run: { runId: 'run-1' },
      })
      await writeFile(
        join(root, '.fastppt/runtime/gateway.json'),
        JSON.stringify({ version: 1, url: 'https://example.com' }),
      )
      await expect(runCoreCommand(input, paths)).rejects.toThrow(
        'Invalid workspace Gateway',
      )
    } finally {
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      )
    }
  })

  it('discovers shared schemas, edits safely, validates and installs capabilities without a Gateway', async () => {
    const root = await temporaryRoot()
    const workspaceRoot = join(root, 'workspace')
    const bundledThemesRoot = join(root, 'bundled')
    await mkdir(workspaceRoot)
    await cp(
      resolve('../../themes/slidev-theme-academy'),
      join(bundledThemesRoot, 'slidev-theme-academy'),
      {
        recursive: true,
        filter: (path) =>
          !['node_modules', '.theme-build', 'dist', '.turbo'].includes(
            basename(path),
          ),
      },
    )
    await writeFile(join(root, 'package.json'), '{"version":"test"}')
    const paths = {
      packageRoot: root,
      bundledThemesRoot,
      themesRoot: join(root, 'themes'),
      commonSkillRoot: resolve('../../packages/fastppt-skill'),
      mcpServerEntry: '',
      slidevRunnerPath: '',
    }
    const run = async (args: string[]) =>
      runCoreCommand(parseCoreArguments(args, workspaceRoot), paths)
    const tools = (await run(['tools', 'list'])) as {
      tools: Array<{ name: string; inputSchema: unknown }>
    }
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(Object.values(TOOL_COMMANDS)),
    )
    expect(
      tools.tools.find((tool) => tool.name === 'create_theme')?.inputSchema,
    ).toBeTruthy()
    const written = (await run([
      'deck',
      'write',
      '--input',
      JSON.stringify({
        content: '---\ntheme: slidev-theme-academy\n---\n\n# Hello\n',
      }),
    ])) as { revision: string }
    expect(await run(['deck', 'validate'])).toMatchObject({
      valid: true,
      slideCount: 1,
    })
    await expect(
      run([
        'deck',
        'write',
        '--input',
        JSON.stringify({ content: '# Lost edit', expectedRevision: 'wrong' }),
      ]),
    ).rejects.toThrow()
    await expect(
      run(['deck', 'read', '--path', '../package.json']),
    ).rejects.toThrow()
    await expect(run(['deck', 'quality', '--slide', '0'])).rejects.toThrow()
    expect(await run(['deck', 'read'])).toMatchObject({
      revision: written.revision,
    })
    const installed = (await run(['skills', 'install'])) as {
      statuses: Array<{ skillId: string; kind: string; state: string }>
    }
    expect(
      installed.statuses.filter(
        (item) =>
          item.skillId === 'fastppt-theme-create' ||
          item.skillId === 'fastppt-ppt-generate',
      ),
    ).toHaveLength(4)
    for (const item of installed.statuses) {
      expect(item, item.skillId).toMatchObject({
        state: item.kind === 'theme' ? 'on-demand' : 'installed',
      })
    }
    expect(
      await readFile(
        join(workspaceRoot, '.agents/skills/fastppt/references/cli.md'),
        'utf8',
      ),
    ).toContain('fastppt deck generate')
    await expect(
      run(['deck', 'generate', '--prompt', 'Create a deck']),
    ).rejects.toThrow('requires prompt, profile')
  }, 30_000)
})
