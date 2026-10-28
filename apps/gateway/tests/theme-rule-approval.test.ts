import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ThemeRuleApprovalReportSchema } from '@fastppt/protocol'
import { evaluateImportRuleApproval } from '../src/theme-rule-approval.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})
async function fixture(
  rules: unknown[],
  layoutIds = ['end', 'body', 'cover'],
) {
  const root = await mkdtemp(join(tmpdir(), 'fastppt-rule-approval-'))
  roots.push(root)
  await mkdir(join(root, 'agent'))
  const manifest = {
    id: 'slidev-theme-review',
    packageName: 'slidev-theme-review',
    displayName: 'Review',
    version: '1.0.0',
    description: 'Approval fixture',
    repositoryUrl: 'https://example.com/review',
    rootDir: '.',
    rulesFile: 'agent/theme-rules.md',
    machineRulesFile: 'agent/theme-rules.json',
    skill: { id: 'fastppt-theme-review', sourceDir: 'agent', version: '1.0.0' },
    layouts: layoutIds.map((id) => ({ id, label: id })),
    supportedFeatures: [],
  }
  await writeFile(
    join(root, 'agent/theme-manifest.json'),
    JSON.stringify(manifest),
  )
  await writeFile(
    join(root, 'agent/theme-rules.json'),
    JSON.stringify({ version: 1, rules }),
  )
  await writeFile(
    join(root, 'agent/native-layouts.json'),
    JSON.stringify(
      manifest.layouts.map((layout) => ({
        name: layout.id,
        masterId: 'brand',
        placeholders: [],
      })),
    ),
  )
  return root
}

it('checks opening and closing availability without mistaking catalog order or size for an authored deck', async () => {
  const root = await fixture([
    { id: 'opening', kind: 'first-layout', layout: 'cover', severity: 'error' },
    { id: 'closing', kind: 'last-layout', layout: 'end', severity: 'error' },
    { id: 'pages', kind: 'max-slides', value: 1, severity: 'error' },
  ])
  const report = ThemeRuleApprovalReportSchema.parse(
    await evaluateImportRuleApproval(root),
  )
  expect(report).toMatchObject({
    valid: true,
    scope: 'theme-catalog',
    layouts: ['end', 'body', 'cover'],
    issues: [
      { ruleId: 'pages', status: 'unverified', severity: 'needs-human' },
    ],
  })
  expect(report.issues).toHaveLength(1)
})

it('blocks missing required native structures and binds review to the prepared catalog', async () => {
  const root = await fixture([
    {
      id: 'title',
      kind: 'required-placeholder',
      layout: 'cover',
      type: 'title',
      index: 0,
      severity: 'error',
    },
    {
      id: 'logo',
      kind: 'fixed-object',
      name: 'Logo',
      owner: 'master',
      severity: 'error',
    },
  ])
  const before = await evaluateImportRuleApproval(root)
  expect(before.valid).toBe(false)
  expect(before.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'title',
        status: 'violation',
        severity: 'error',
      }),
      expect.objectContaining({
        ruleId: 'logo',
        status: 'violation',
        severity: 'error',
      }),
    ]),
  )
  await writeFile(
    join(root, 'agent/native-layouts.json'),
    JSON.stringify(
      ['end', 'body', 'cover'].map((name) => ({
        name,
        masterId: 'brand',
        placeholders:
          name === 'cover'
            ? [{ index: 0, type: 'title', x: 0, y: 0, width: 100, height: 100 }]
            : [],
        masterObjects: {
          objects: [{ name: 'Logo', x: 0, y: 0, width: 10, height: 10 }],
        },
      })),
    ),
  )
  const after = await evaluateImportRuleApproval(root)
  expect(after).toMatchObject({
    valid: true,
    issues: [],
    digest: before.digest,
  })
  expect(after.catalogDigest).not.toBe(before.catalogDigest)
})

it('blocks a placeholder requirement whose layout was pruned from the catalog', async () => {
  const root = await fixture(
    [
      {
        id: 'slot.title',
        kind: 'required-placeholder',
        layout: 'cover',
        type: 'title',
        index: 0,
        severity: 'error',
      },
    ],
    ['body'],
  )
  const report = await evaluateImportRuleApproval(root)
  expect(report).toMatchObject({
    valid: false,
    layouts: ['body'],
    issues: [
      {
        ruleId: 'slot.title',
        code: 'THEME_RULE_PLACEHOLDER_LAYOUT_MISSING',
        status: 'violation',
        severity: 'error',
      },
    ],
  })
})

it('keeps future rendered evidence unverified during catalog approval', async () => {
  const root = await fixture([
    { id: 'lines', kind: 'max-text-lines', value: 10, severity: 'error' },
  ])
  const report = await evaluateImportRuleApproval(root)
  expect(report.valid).toBe(true)
  expect(report.issues).toHaveLength(3)
  expect(
    report.issues.every(
      (issue) =>
        issue.status === 'unverified' && issue.severity === 'needs-human',
    ),
  ).toBe(true)
})
