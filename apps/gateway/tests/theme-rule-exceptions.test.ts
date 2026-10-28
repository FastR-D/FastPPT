import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type {
  ThemeRuleExceptionBinding,
  ThemeRuleIssue,
} from '@fastppt/protocol'
import {
  applyRuleExceptions,
  authoredRuleDigest,
  blockingRuleIssue,
  ruleExceptionState,
  ruleIssueFingerprint,
  ruleOptionsDigest,
  ThemeRuleExceptionStore,
} from '../src/theme-rule-exceptions.js'

const binding: ThemeRuleExceptionBinding = {
  deckId: 'deck',
  revision: 'revision',
  themeId: 'theme',
  themeDigest: 'theme-v1',
  ruleDigest: 'rule-v1',
  masterDigest: 'master-v1',
  profileDigest: 'profile-v1',
  optionsDigest: ruleOptionsDigest(),
  authoredDigest: 'a'.repeat(64),
}
const issue: ThemeRuleIssue = {
  ruleId: 'logo',
  code: 'THEME_RULE_FIXED_OBJECT_MISSING',
  status: 'violation',
  severity: 'error',
  message: 'Logo is missing.',
  slide: 1,
  locator: { objectName: 'Logo' },
}
const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fastppt-exceptions-'))
  roots.push(root)
  return {
    root,
    store: new ThemeRuleExceptionStore((deckId) =>
      join(root, deckId, 'exceptions.json'),
    ),
  }
}

it('preserves the original finding and only grants its exact phase, location and context', async () => {
  const { store } = await fixture()
  const granted = await store.approve('deck', () =>
    Promise.resolve({
      binding,
      phase: 'export',
      issue,
      reason: 'Approved for this internal draft.',
    }),
  )
  const applied = applyRuleExceptions([issue], [granted], binding, 'export')
  expect(applied[0]).toMatchObject({
    ...issue,
    exception: { id: granted.id, reason: granted.reason },
  })
  expect(applied.some(blockingRuleIssue)).toBe(false)
  expect(issue.exception).toBeUndefined()
  expect(
    applyRuleExceptions(applied, [granted], binding, 'readback').some(
      blockingRuleIssue,
    ),
  ).toBe(true)
  for (const changed of [
    { ...issue, slide: 2 },
    { ...issue, status: 'unverified' as const },
    { ...issue, message: 'A different measurement.' },
    { ...issue, locator: { objectName: 'Footer' } },
  ]) {
    expect(
      applyRuleExceptions([changed], [granted], binding, 'export').some(
        blockingRuleIssue,
      ),
    ).toBe(true)
  }
  for (const key of Object.keys(binding) as Array<
    keyof ThemeRuleExceptionBinding
  >) {
    const changed = { ...binding, [key]: `${binding[key]}changed` }
    expect(ruleExceptionState(granted, changed), key).toBe('expired')
    expect(
      applyRuleExceptions(applied, [granted], changed, 'export').some(
        blockingRuleIssue,
      ),
      key,
    ).toBe(true)
  }
  expect(
    applyRuleExceptions(applied, [], binding, 'export')[0]?.exception,
  ).toBeUndefined()
})

it('serializes concurrent approvals, persists revocation, and retains history on reapproval', async () => {
  const { root, store } = await fixture()
  const grant = (finding: ThemeRuleIssue) =>
    store.approve('deck', () =>
      Promise.resolve({
        binding,
        phase: 'export',
        issue: finding,
        reason: 'Manual review',
      }),
    )
  const [first, duplicate, second] = await Promise.all([
    grant(issue),
    grant(issue),
    grant({ ...issue, slide: 2 }),
  ])
  expect(duplicate.id).toBe(first.id)
  expect(second.id).not.toBe(first.id)
  expect(await store.list('deck')).toHaveLength(2)
  await store.revoke('deck', first.id)
  const restored = new ThemeRuleExceptionStore((deckId) =>
    join(root, deckId, 'exceptions.json'),
  )
  const entries = await restored.list('deck')
  expect(ruleExceptionState(entries[0]!, binding)).toBe('revoked')
  expect(
    applyRuleExceptions([issue], entries, binding, 'export').some(
      blockingRuleIssue,
    ),
  ).toBe(true)
  const next = await grant(issue)
  expect(next.id).not.toBe(first.id)
  expect(await restored.list('deck')).toHaveLength(3)
  expect(ruleIssueFingerprint(next.issue)).toBe(next.issueFingerprint)
})

it('binds actual export options and sidecar data while excluding the exception audit itself', async () => {
  const { root } = await fixture()
  expect(ruleOptionsDigest()).toBe(ruleOptionsDigest({ policy: 'editable' }))
  for (const option of ['master', 'notes', 'animations', 'diagrams', 'review'])
    expect(ruleOptionsDigest({ [option]: false })).not.toBe(ruleOptionsDigest())
  expect(ruleOptionsDigest({ policy: 'strict-editable' })).not.toBe(
    ruleOptionsDigest(),
  )
  const before = await authoredRuleDigest(root)
  await writeFile(join(root, 'theme-rule-exceptions.json'), '{}')
  expect(await authoredRuleDigest(root)).toBe(before)
  await writeFile(join(root, 'animations.json'), '{}')
  const animated = await authoredRuleDigest(root)
  expect(animated).not.toBe(before)
  await mkdir(join(root, 'diagrams'))
  await writeFile(join(root, 'diagrams', 'one.json'), '{}')
  expect(await authoredRuleDigest(root)).not.toBe(animated)
})
