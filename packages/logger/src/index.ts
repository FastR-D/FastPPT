import pino, { type Logger, type LoggerOptions } from 'pino'

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.sec-websocket-protocol',
  '*.apiKey',
  '*.token',
]

const ANSI = {
  reset: '[0m',
  bold: '[1m',
  red: '[31m',
  yellow: '[33m',
  green: '[32m',
  cyan: '[36m',
}

/**
 * Renders one access-log line as colored text, e.g.
 *
 *   [GET 200] /api/v1/workspace/files (12.5ms)
 *
 * with the status code colored by outcome (2xx green, 4xx yellow, 5xx red).
 * The ANSI codes live in the `msg` itself so they survive pino's worker
 * transport (functions would not be clonable); pino-pretty only renders the
 * line.
 */
export function formatAccessLine(input: {
  method: string
  url: string
  statusCode: number
  durationMs: number
}): string {
  const color =
    input.statusCode >= 500
      ? ANSI.red
      : input.statusCode >= 400
        ? ANSI.yellow
        : ANSI.green
  return `${ANSI.bold}[${input.method} ${color}${input.statusCode}${ANSI.reset}${ANSI.bold}]${ANSI.reset} ${ANSI.cyan}${input.url}${ANSI.reset} (${input.durationMs.toFixed(1)}ms)`
}

export function isPrettyLoggingEnabled(): boolean {
  return process.env.FASTPPT_LOG_JSON !== '1' && process.env.NODE_ENV !== 'test'
}

const PRETTY_TRANSPORT = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:HH:MM:ss',
    singleLine: true,
    // Request fields are already rendered into the line itself; the trailing
    // JSON would only repeat them.
    ignore: 'reqId,pid,hostname,remoteAddress,method,url,statusCode,durationMs',
  },
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(
      /\b(authorization\s*[=:]\s*)(?:(?:Bearer|Basic)\s+)?[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /\b([A-Za-z0-9_-]*(?:api[_-]?key|secret|token|password)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [REDACTED]')
    .replace(
      /\b(?:sk-ant-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{20,})\b/g,
      '[REDACTED]',
    )
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino(createLoggerOptions(options))
}

export function createLoggerOptions(
  options: LoggerOptions = {},
): LoggerOptions {
  return {
    level: process.env.FASTPPT_LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(isPrettyLoggingEnabled() ? { transport: PRETTY_TRANSPORT } : {}),
    ...options,
  }
}
