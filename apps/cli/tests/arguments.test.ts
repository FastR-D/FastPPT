import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseCliArguments } from '../src/arguments.js'

describe('FastPPT CLI arguments', () => {
  it('uses the current directory by default', () => {
    expect(parseCliArguments([], '/workspace').workspaceRoot).toBe(
      resolve('/workspace'),
    )
  })

  it('accepts dir and workspace aliases', () => {
    expect(
      parseCliArguments(['--dir', './deck'], '/workspace').workspaceRoot,
    ).toBe(resolve('/workspace/deck'))
    expect(
      parseCliArguments(['--workspace=../deck'], '/workspace').workspaceRoot,
    ).toBe(resolve('/deck'))
  })

  it('rejects unknown or incomplete options', () => {
    expect(() => parseCliArguments(['--port', '99'], '/workspace')).toThrow(
      'Unknown option',
    )
    expect(() => parseCliArguments(['--dir'], '/workspace')).toThrow(
      'requires a directory path',
    )
  })
})
