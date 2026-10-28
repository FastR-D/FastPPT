import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  CreateExportRequestSchema,
  ThemeRuleExceptionDocumentSchema,
  type ThemeRuleException,
  type ThemeRuleExceptionBinding,
  type ThemeRuleIssue,
} from '@fastppt/protocol'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export const ruleStateDigest = (value: unknown): string =>
  createHash('sha256').update(canonical(value)).digest('hex')
export function ruleOptionsDigest(options?: unknown): string {
  const parsed = CreateExportRequestSchema.shape.options.parse(options)
  return ruleStateDigest({ ...parsed, policy: parsed.policy ?? 'editable' })
}
export async function authoredRuleDigest(root: string): Promise<string> {
  const readOptional = (path: string) =>
    readFile(path, 'utf8').catch((cause: unknown) => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw cause
    })
  const names = await readdir(join(root, 'diagrams')).catch(
    (cause: unknown) => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw cause
    },
  )
  const paths = [
    'animations.json',
    'notes.json',
    ...names
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => `diagrams/${name}`),
  ]
  return ruleStateDigest(
    await Promise.all(
      paths.map(async (path) => [path, await readOptional(join(root, path))]),
    ),
  )
}
export const sameRuleBinding = (
  a: ThemeRuleExceptionBinding,
  b: ThemeRuleExceptionBinding,
): boolean => canonical(a) === canonical(b)
export function ruleIssueFingerprint(issue: ThemeRuleIssue): string {
  return ruleStateDigest({
    ruleId: issue.ruleId,
    code: issue.code,
    status: issue.status,
    slide: issue.slide,
    locator: issue.locator,
    message: issue.message,
    source: issue.source,
  })
}
export function ruleExceptionState(
  entry: ThemeRuleException,
  binding: ThemeRuleExceptionBinding,
): 'active' | 'expired' | 'revoked' {
  return entry.revokedAt
    ? 'revoked'
    : sameRuleBinding(entry.binding, binding)
      ? 'active'
      : 'expired'
}
export function applyRuleExceptions(
  issues: readonly ThemeRuleIssue[],
  entries: readonly ThemeRuleException[],
  binding: ThemeRuleExceptionBinding,
  phase: ThemeRuleException['phase'],
): ThemeRuleIssue[] {
  return issues.map(({ exception: _previous, ...issue }) => {
    void _previous
    const fingerprint = ruleIssueFingerprint(issue)
    const match = entries.find(
      (entry) =>
        ruleExceptionState(entry, binding) === 'active' &&
        entry.phase === phase &&
        entry.issueFingerprint === fingerprint &&
        ruleIssueFingerprint(entry.issue) === fingerprint,
    )
    return match
      ? {
          ...issue,
          exception: {
            id: match.id,
            reason: match.reason,
            approvedAt: match.approvedAt,
          },
        }
      : issue
  })
}
export const blockingRuleIssue = (issue: ThemeRuleIssue): boolean =>
  issue.severity === 'error' && !issue.exception

/** Append/revoke under a per-deck lock. Rename makes each saved audit atomic;
 * the checker runs inside the lock so simultaneous grants cannot lose records. */
export class ThemeRuleExceptionStore {
  readonly #pending = new Map<string, Promise<unknown>>()
  constructor(readonly pathFor: (deckId: string) => string) {}
  async list(deckId: string): Promise<ThemeRuleException[]> {
    try {
      return ThemeRuleExceptionDocumentSchema.parse(
        JSON.parse(await readFile(this.pathFor(deckId), 'utf8')),
      ).entries
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw cause
    }
  }
  async #update<T>(
    deckId: string,
    mutate: (entries: ThemeRuleException[]) => Promise<T>,
  ): Promise<T> {
    const pending = (this.#pending.get(deckId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const entries = await this.list(deckId)
        const result = await mutate(entries)
        const path = this.pathFor(deckId),
          temporary = `${path}.${randomUUID()}.tmp`
        await mkdir(dirname(path), { recursive: true })
        try {
          await writeFile(
            temporary,
            JSON.stringify(
              ThemeRuleExceptionDocumentSchema.parse({ version: 1, entries }),
              null,
              2,
            ),
          )
          await rename(temporary, path)
        } finally {
          await rm(temporary, { force: true })
        }
        return result
      })
    this.#pending.set(deckId, pending)
    try {
      return await pending
    } finally {
      if (this.#pending.get(deckId) === pending) this.#pending.delete(deckId)
    }
  }
  approve(
    deckId: string,
    check: () => Promise<{
      binding: ThemeRuleExceptionBinding
      phase: ThemeRuleException['phase']
      issue: ThemeRuleIssue
      reason: string
    }>,
  ): Promise<ThemeRuleException> {
    return this.#update(deckId, async (entries) => {
      const input = await check()
      if (
        input.binding.deckId !== deckId ||
        !input.issue.code.startsWith('THEME_RULE_')
      )
        throw new Error('Invalid rule exception scope')
      const { exception: _previous, ...issue } = input.issue
      void _previous
      const fingerprint = ruleIssueFingerprint(issue)
      const existing = entries.find(
        (entry) =>
          ruleExceptionState(entry, input.binding) === 'active' &&
          entry.phase === input.phase &&
          entry.issueFingerprint === fingerprint,
      )
      if (existing) return existing
      const entry: ThemeRuleException = {
        id: randomUUID(),
        binding: input.binding,
        phase: input.phase,
        issueFingerprint: fingerprint,
        issue,
        reason: input.reason,
        actor: 'user',
        approvedAt: new Date().toISOString(),
      }
      entries.push(entry)
      return entry
    })
  }
  revoke(deckId: string, id: string): Promise<ThemeRuleException> {
    return this.#update(deckId, (entries) => {
      const entry = entries.find((item) => item.id === id)
      if (!entry) throw new Error('Rule exception not found')
      entry.revokedAt ??= new Date().toISOString()
      return Promise.resolve(entry)
    })
  }
}
