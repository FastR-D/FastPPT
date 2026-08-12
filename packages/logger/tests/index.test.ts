import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createLoggerOptions,
  formatAccessLine,
  isPrettyLoggingEnabled,
  redactSensitiveText,
} from '../src/index.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('redactSensitiveText', () => {
  it.each([
    ['Authorization: Bearer local-session-token', 'Authorization: [REDACTED]'],
    ['token=private-value', 'token=[REDACTED]'],
    [
      'ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnop',
      'ANTHROPIC_API_KEY=[REDACTED]',
    ],
    [
      'provider returned sk-abcdefghijklmnopqrstuvwxyz',
      'provider returned [REDACTED]',
    ],
  ])('redacts process output secrets', (input, expected) => {
    expect(redactSensitiveText(input)).toBe(expected)
  })

  it('preserves ordinary diagnostics', () => {
    expect(redactSensitiveText('Slidev ready on port 4319')).toBe(
      'Slidev ready on port 4319',
    )
  })
})

describe('isPrettyLoggingEnabled', () => {
  it('enables pretty output outside tests by default', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('FASTPPT_LOG_JSON', undefined)
    expect(isPrettyLoggingEnabled()).toBe(true)
  })

  it('keeps raw JSON when FASTPPT_LOG_JSON=1', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('FASTPPT_LOG_JSON', '1')
    expect(isPrettyLoggingEnabled()).toBe(false)
  })

  it('keeps raw JSON under test', () => {
    vi.stubEnv('NODE_ENV', 'test')
    expect(isPrettyLoggingEnabled()).toBe(false)
  })
})

describe('createLoggerOptions', () => {
  it('defaults to the FASTPPT_LOG_LEVEL env level', () => {
    vi.stubEnv('FASTPPT_LOG_LEVEL', 'debug')
    expect(createLoggerOptions().level).toBe('debug')
    vi.stubEnv('FASTPPT_LOG_LEVEL', undefined)
    expect(createLoggerOptions().level).toBe('info')
  })

  it('always applies secret redaction', () => {
    expect(JSON.stringify(createLoggerOptions().redact)).toContain(
      'req.headers.authorization',
    )
  })

  it('routes through the pino-pretty transport when pretty logging is on', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('FASTPPT_LOG_JSON', undefined)
    expect(createLoggerOptions().transport).toMatchObject({
      target: 'pino-pretty',
    })
  })

  it('omits the pretty transport when pretty logging is off', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('FASTPPT_LOG_JSON', '1')
    expect(createLoggerOptions().transport).toBeUndefined()
  })
})

describe('formatAccessLine', () => {
  it('renders one line with method, colored status, url and duration', () => {
    const line = formatAccessLine({
      method: 'GET',
      url: '/api/v1/workspace/files',
      statusCode: 200,
      durationMs: 12.5117,
    })
    expect(line).toContain('[GET')
    expect(line).toContain('/api/v1/workspace/files')
    expect(line).toContain('(12.5ms)')
    expect(line).toContain('[32m200[0m') // 2xx green
    expect(line).toContain('[1m') // bold bracket group
  })

  it('colors 4xx yellow and 5xx red', () => {
    const yellow = formatAccessLine({
      method: 'GET',
      url: '/api/v1/nope',
      statusCode: 401,
      durationMs: 0.4,
    })
    expect(yellow).toContain('[33m401[0m')

    const red = formatAccessLine({
      method: 'POST',
      url: '/api/v1/boom',
      statusCode: 500,
      durationMs: 3.2,
    })
    expect(red).toContain('[31m500[0m')
  })
})
