import { describe, expect, it } from 'vitest'

import { resolveCliRuntimePaths } from '../src/paths.js'

describe('FastPPT CLI runtime paths', () => {
  it('resolves packaged resources beside the CLI entry', () => {
    expect(
      resolveCliRuntimePaths('file:///package/dist/runtime/cli.js'),
    ).toEqual({
      packageRoot: '/package/dist',
      themesRoot: '/package/dist/themes',
      commonSkillRoot: '/package/dist/fastppt-skill',
      mcpServerEntry: '/package/dist/runtime/mcp-server.js',
      slidevRunnerPath: '/package/dist/runner.mjs',
    })
  })
})
