import { describe, expect, it } from 'vitest'

import { classifySlidevLogLine } from '../src/slidev-logs.js'

describe('classifySlidevLogLine', () => {
  it('classifies error-looking lines on either stream as error', () => {
    expect(
      classifySlidevLogLine('stderr', "Error: Cannot find module 'x'"),
    ).toBe('error')
    expect(classifySlidevLogLine('stdout', 'error during build')).toBe('error')
    expect(classifySlidevLogLine('stderr', 'failed to start server')).toBe(
      'error',
    )
    expect(classifySlidevLogLine('stdout', 'ERR_SOCKET_TIMEOUT')).toBe('error')
    expect(classifySlidevLogLine('stderr', 'FATAL: out of memory')).toBe(
      'error',
    )
    expect(classifySlidevLogLine('stdout', '✘ build failed')).toBe('error')
  })

  it('classifies warning-looking lines as warn', () => {
    expect(
      classifySlidevLogLine('stdout', 'Warning: experimental feature'),
    ).toBe('warn')
    expect(
      classifySlidevLogLine('stderr', 'plugin deprecated, use the new API'),
    ).toBe('warn')
    expect(classifySlidevLogLine('stdout', '⚠ missing styles')).toBe('warn')
  })

  it('defaults stderr lines to warn', () => {
    expect(classifySlidevLogLine('stderr', 'some unexpected output')).toBe(
      'warn',
    )
  })

  it('sinks plain stdout chatter to debug', () => {
    expect(
      classifySlidevLogLine(
        'stdout',
        '14:19:47 [vite] (client) page reload /home/x/src/main.ts',
      ),
    ).toBe('debug')
    expect(
      classifySlidevLogLine('stdout', '  Local: http://127.0.0.1:45217/'),
    ).toBe('debug')
    expect(classifySlidevLogLine('stdout', 'waiting for changes...')).toBe(
      'debug',
    )
  })

  it('is case-insensitive', () => {
    expect(classifySlidevLogLine('stdout', 'ERROR')).toBe('error')
    expect(classifySlidevLogLine('stderr', 'WARNING')).toBe('warn')
    expect(classifySlidevLogLine('stdout', 'Failed')).toBe('error')
  })
})
