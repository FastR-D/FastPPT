import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseCliArguments } from '../src/arguments.js'

describe('FastPPT CLI arguments', () => {
  it('uses the current directory by default', () => {
    expect(parseCliArguments([], '/workspace')).toMatchObject({
      command: 'start',
      workspaceRoot: resolve('/workspace'),
      port: 4317,
      open: false,
      json: false,
    })
  })

  it('accepts commands and operational options', () => {
    expect(
      parseCliArguments(
        ['status', '--dir', './deck', '--port=4320', '--json'],
        '/workspace',
      ),
    ).toMatchObject({
      command: 'status',
      workspaceRoot: resolve('/workspace/deck'),
      port: 4320,
      json: true,
    })
    expect(
      parseCliArguments(['start', '--open', '-p', '4400'], '/workspace'),
    ).toMatchObject({ command: 'start', open: true, port: 4400 })
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
    expect(() => parseCliArguments(['--port', '0'], '/workspace')).toThrow(
      'between 1 and 65535',
    )
    expect(() => parseCliArguments(['--dir'], '/workspace')).toThrow(
      'requires a directory path',
    )
    expect(() => parseCliArguments(['launch'], '/workspace')).toThrow(
      'Unknown command',
    )
  })
})
