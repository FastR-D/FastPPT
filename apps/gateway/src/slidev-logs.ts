export type SlidevLogLevel = 'error' | 'warn' | 'debug'

const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bexception\b/i,
  /\bfatal\b/i,
  /\bcannot\b/i,
  /ERR_[A-Z0-9_]+/,
  /✘/,
]

const WARN_PATTERNS = [
  /\bwarn(?:ing)?\b/i,
  /\bdeprecated\b/i,
  /\bexperimental\b/i,
  /⚠/,
]

/**
 * Maps a Slidev child-process output line to a log level so the gateway log
 * stays readable at the default `info` level:
 *
 * - error-looking lines (on either stream) → `error`
 * - warning-looking lines → `warn`
 * - anything else on stderr → `warn` (stderr implies a problem)
 * - anything else on stdout → `debug` (usual vite/dev-server chatter, e.g.
 *   HMR reloads — visible with `FASTPPT_LOG_LEVEL=debug`)
 */
export function classifySlidevLogLine(
  stream: 'stdout' | 'stderr',
  message: string,
): SlidevLogLevel {
  const line = message.trim()
  if (ERROR_PATTERNS.some((pattern) => pattern.test(line))) return 'error'
  if (WARN_PATTERNS.some((pattern) => pattern.test(line))) return 'warn'
  return stream === 'stderr' ? 'warn' : 'debug'
}
