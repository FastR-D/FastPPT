import { realpath } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, sep, win32 } from 'node:path'

import picomatch from 'picomatch'

import { WorkspaceError } from './errors.js'

const DEFAULT_IGNORED_DIRECTORIES = [
  '.git',
  '.agents',
  '.claude',
  '.codex',
  'node_modules',
  '.pnpm-store',
  '.fastppt',
  'dist',
  'build',
  'coverage',
  'outputs',
  'out',
  '.cache',
  '.pytest_cache',
  '__pycache__',
  '.venv',
  'venv',
  'target',
] as const

const DEFAULT_IGNORES = [
  ...DEFAULT_IGNORED_DIRECTORIES.flatMap((directory) => [
    directory,
    `${directory}/**`,
    `**/${directory}`,
    `**/${directory}/**`,
  ]),
  '.mcp.json',
  '.mcp.json.fastppt-backup-*',
]

const SECRET_NAMES = new Set([
  '.env',
  '.env.local',
  '.npmrc',
  '.netrc',
  'id_rsa',
  'id_ed25519',
  'credentials',
])

export function normalizeRelativePath(input: string): string {
  if (input.includes('\0') || isAbsolute(input) || win32.isAbsolute(input)) {
    throw new WorkspaceError(
      'PATH_OUTSIDE_WORKSPACE',
      'Only relative workspace paths are allowed.',
      403,
    )
  }
  const normalized = posix
    .normalize(input.replaceAll('\\', '/'))
    .replace(/^\.\//, '')
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new WorkspaceError(
      'PATH_OUTSIDE_WORKSPACE',
      'Path traversal outside the workspace is not allowed.',
      403,
    )
  }
  return normalized === '.' ? '' : normalized
}

export function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== '..' &&
      !isAbsolute(pathFromRoot))
  )
}

export async function resolveExistingPath(
  root: string,
  requestedPath: string,
): Promise<string> {
  const normalized = normalizeRelativePath(requestedPath)
  let candidate: string
  try {
    candidate = await realpath(join(root, normalized))
  } catch (cause) {
    throw new WorkspaceError(
      'FILE_NOT_FOUND',
      `File not found: ${normalized}`,
      404,
      {
        cause: cause instanceof Error ? cause.message : undefined,
      },
    )
  }
  if (!isContained(root, candidate)) {
    throw new WorkspaceError(
      'PATH_OUTSIDE_WORKSPACE',
      'The resolved path escapes the workspace.',
      403,
    )
  }
  return candidate
}

export function createIgnoreMatcher(customPatterns: readonly string[] = []) {
  const matcher = picomatch([...DEFAULT_IGNORES, ...customPatterns], {
    dot: true,
  })
  return (relativePath: string): boolean =>
    matcher(normalizeRelativePath(relativePath))
}

export function assertNonSecretPath(relativePath: string): void {
  const normalized = normalizeRelativePath(relativePath).toLowerCase()
  const segments = normalized.split('/')
  const basename = segments.at(-1) ?? ''
  const secretDirectory =
    segments.some((segment) => ['.ssh', '.aws', '.gnupg'].includes(segment)) ||
    normalized === '.config/gcloud' ||
    normalized.startsWith('.config/gcloud/')
  if (
    secretDirectory ||
    SECRET_NAMES.has(basename) ||
    basename.startsWith('.env.') ||
    basename.endsWith('.pem') ||
    basename.endsWith('.key')
  ) {
    throw new WorkspaceError(
      'PATH_OUTSIDE_WORKSPACE',
      'Access to common secret files requires an explicit trusted operation.',
      403,
    )
  }
}
