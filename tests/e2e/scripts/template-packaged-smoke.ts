/** Exercises shipped extractor/writer/MCP using a verified retained golden run. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { readPptxRuleEvidence } from '@fastppt/pptx-import'
import {
  MasterSnapshotV1Schema,
  NativeMasterLayoutSchema,
} from '@fastppt/presentation-ir'
import { HtmlDeckSnapshotSchema } from '@fastppt/slidewave/snapshot'
import { type writeEditablePptx } from '@fastppt/slidewave/server'
import {
  loadThemeRegistry,
  themeRulesDigest,
  ThemeRulesDocumentSchema,
} from '@fastppt/theme-registry'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { verifyTemplateGolden } from './lib/template-golden-evidence.js'

const input = resolve(process.argv[2] ?? process.env.FASTPPT_GOLDEN_RUN ?? '')
assert.ok(
  process.argv[2] || process.env.FASTPPT_GOLDEN_RUN,
  'Supply the retained golden run directory.',
)
const verified = await verifyTemplateGolden(input)
const repository = fileURLToPath(new URL('../../..', import.meta.url))
const distribution = join(repository, 'apps/cli/dist')
const directory = await mkdtemp(join(input, 'packaged-'))
const themeRoot = join(directory, 'themes')
const workspaceRoot = join(directory, 'workspace')
await mkdir(themeRoot)
await mkdir(workspaceRoot)
const run = promisify(execFile)
await run(
  process.execPath,
  [
    join(distribution, 'scripts/extract-theme.mjs'),
    join(input, 'source.pptx'),
    '--name',
    'golden-single-master',
    '--out',
    themeRoot,
    '--analysis',
    join(input, 'analysis.json'),
  ],
  { timeout: 60_000 },
)
const theme = join(themeRoot, 'slidev-theme-golden-single-master')
const definitions = NativeMasterLayoutSchema.array().parse(
  JSON.parse(await readFile(join(theme, 'agent/native-layouts.json'), 'utf8')),
)
const lock = MasterSnapshotV1Schema.parse(
  JSON.parse(await readFile(join(input, 'theme-lock.json'), 'utf8')),
)
assert.deepEqual(
  definitions,
  lock.layoutDefinitions,
  'Packaged extraction differs from the source pipeline.',
)
const snapshot = HtmlDeckSnapshotSchema.parse(
  JSON.parse(await readFile(join(input, 'snapshot.json'), 'utf8')),
)
const shipped = (await import(
  pathToFileURL(
    join(distribution, 'node_modules/@fastppt/slidewave/dist/server/index.js'),
  ).href
)) as {
  writeEditablePptx: typeof writeEditablePptx
}
const output = join(directory, 'exported.pptx')
const result = await shipped.writeEditablePptx(snapshot, output, {
  embedFonts: false,
  policy: 'strict-editable',
  masterLayoutDefinitions: definitions,
  slideLayouts: snapshot.slides.map(() => definitions[0]!.name),
  placeholderBindings: snapshot.slides.flatMap((_, index) =>
    ['title', 'body'].map((target, slot) => ({
      slide: index + 1,
      target,
      index: slot,
      geometry: 'layout' as const,
      textStyle: 'layout' as const,
      textBody: 'layout' as const,
    })),
  ),
})
assert.equal(result.qa.ok, true)
const actual = await readPptxRuleEvidence(await readFile(output))
const original = await readPptxRuleEvidence(
  await readFile(join(input, 'exported.pptx')),
)
assert.deepEqual(
  actual.slides,
  original.slides,
  'Packaged output structure differs from golden readback.',
)

const client = new Client({ name: 'fastppt-packaged-smoke', version: '1.0.0' })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    join(distribution, 'runtime/mcp-server.js'),
    '--workspace',
    workspaceRoot,
    '--themes-root',
    themeRoot,
    '--common-skill-root',
    join(distribution, 'fastppt-skill'),
  ],
  stderr: 'pipe',
})
let stderr = ''
transport.stderr?.on('data', (data: Buffer) => {
  stderr += data.toString()
})
let machine: Record<string, unknown>
try {
  await client.connect(transport)
  const response = await client.callTool(
    { name: 'get_theme_rules', arguments: { themeId: lock.themeId } },
    undefined,
    { timeout: 15_000 },
  )
  assert.ok(!response.isError, JSON.stringify(response))
  machine = response.structuredContent as Record<string, unknown>
  const registered = (await loadThemeRegistry(themeRoot)).resolve(lock.themeId)
  const rules = ThemeRulesDocumentSchema.parse(machine.machineRules)
  assert.equal(machine.machineRulesStatus, 'available')
  assert.equal(machine.machineRulesDigest, themeRulesDigest(rules))
  assert.equal(machine.contentDigest, registered.contentDigest)
  assert.equal(machine.machineRulesSource, 'agent/theme-rules.json')
  assert.equal(
    (machine.evidenceRequirements as unknown[]).length,
    rules.rules.length,
  )
  assert.ok(typeof machine.rules === 'string' && machine.rules.length > 0)
} catch (error) {
  throw new Error(`Packaged MCP failed: ${stderr}`, { cause: error })
} finally {
  await client.close()
  await transport.close()
}
const report = {
  version: 1,
  status: 'passed',
  input,
  sourceRun: verified,
  outputSha256: actual.sha256,
  packagedEntries: await Promise.all(
    [
      'scripts/extract-theme.mjs',
      'runtime/mcp-server.js',
      'node_modules/@fastppt/slidewave/dist/server/index.js',
    ].map(async (path) => ({
      path,
      sha256: createHash('sha256')
        .update(await readFile(join(distribution, path)))
        .digest('hex'),
    })),
  ),
  checks: [
    'packaged layout definitions',
    'strict editable output and actual readback',
    'bundled MCP stdio machine rules',
  ],
  limitations: [
    'This does not render packaged output or verify PowerPoint/WPS/Keynote editing.',
  ],
}
for (const [name, value] of [
  ['export-report.json', result],
  ['read-back.json', actual],
  ['mcp-rules.json', machine],
  ['report.json', report],
] as const)
  await writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n')
process.stdout.write(JSON.stringify({ directory, ...report }, null, 2) + '\n')
