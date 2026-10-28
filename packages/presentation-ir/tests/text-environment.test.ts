import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { DecimalTabSchema, DecimalTabDeclarationV1Schema, DecimalTabEvidenceV1Schema, DecimalTabSourceConventionSchema, ImportAnalysisV1Schema, NativeMasterLayoutSchema } from '../src/index.js'
import { decimalTabProfiles, validateDecimalTab, validateDecimalTabDeclaration } from '../../slidewave/src/primitives/text-tabs.mjs'

function fixture() {
  const source = '1'.repeat(64)
  const observation = { id: 'period', page: 1, sourceText: 'A\t12.34', sourceRuns: [{ text: 'A\t12.34', language: 'de-DE' }], importedText: 'A\t12.34', importedTabs: [{ positionHundredthMm: 5292, alignment: 'DECIMAL', decimalCharacter: '.' }], expected: [{ text: 'A', x: 40 }, { text: '12.34', x: 166, end: 226 }], known: [{ text: 'A', x: 40 }, { text: '12.34', x: 112 }], observed: [{ text: 'A', x: 40 }, { text: '12.34', x: 112, end: 172 }], status: 'known-difference' }
  return { version: 1, generatedAt: '2026-10-09T00:00:00Z', sourcePptxSha256: source, sourceConvention: { status: 'unknown', reason: 'drawingml-has-no-decimal-separator' }, comparisonBasis: 'target-application-probe', reproducers: [{ path: 'probe.ts', sha256: '2'.repeat(64) }], tolerancePoints: 0.25, targets: [{
    environment: { application: { name: 'LibreOffice', version: '7.3.7.2', commandVersion: 'LibreOffice 7.3.7.2 30(Build:2)' }, platform: { system: 'Linux', release: 'test', architecture: 'x86_64' }, locale: { requested: 'en-US', observed: 'en-US', ui: 'en-US', decimalSeparator: '.', decimalSeparatorAsLocale: true }, configurationSha256: '3'.repeat(64) },
    artifacts: [
      { stage: 'actual-native-export', pptxSha256: source, pdfSha256: '4'.repeat(64), pageCount: 1, cases: [structuredClone(observation)] },
      { stage: 'diagnostic-indent-removed', pptxSha256: '5'.repeat(64), pdfSha256: '6'.repeat(64), pageCount: 1, cases: [{ ...structuredClone(observation), observed: observation.expected, status: 'matched' }] },
    ],
  }] }
}

it('keeps unknown source conventions separate from observed renderer locales and diagnostic matches', () => {
  const input = fixture()
  const result = DecimalTabEvidenceV1Schema.parse(input)
  expect(result).toEqual(input)
  expect(result.sourceConvention.status).toBe('unknown')
  expect(result.targets[0]!.artifacts.map(artifact => artifact.cases[0]!.status)).toEqual(['known-difference', 'matched'])
  expect(DecimalTabSourceConventionSchema.parse({ status: 'declared', separator: ',', provenance: 'user-declared', reason: 'Source author confirms comma alignment' })).toMatchObject({ separator: ',' })
  expect(ImportAnalysisV1Schema.parse({ version: 1, sourceHash: input.sourcePptxSha256, extractedFeatures: {}, candidateLayouts: [], decimalTabConvention: input.sourceConvention }).decimalTabConvention).toEqual(input.sourceConvention)
  expect(DecimalTabSourceConventionSchema.safeParse({ ...input.sourceConvention, separator: '.' }).success).toBe(false)
})

it('rejects reused identities, missing pages, mismatched locale and fabricated match statuses', () => {
  const mutations: Array<(input: ReturnType<typeof fixture>) => void> = [
    input => { input.targets[0]!.artifacts[0]!.cases[0]!.status = 'matched' },
    input => { input.targets[0]!.artifacts[1]!.pptxSha256 = input.sourcePptxSha256 },
    input => { input.targets[0]!.artifacts[0]!.pptxSha256 = '7'.repeat(64) },
    input => { input.targets[0]!.artifacts[1]!.stage = 'actual-native-export' },
    input => { input.targets[0]!.artifacts[0]!.cases[0]!.page = 2 },
    input => { input.targets[0]!.artifacts[0]!.pageCount = 2 },
    input => { input.targets[0]!.environment.locale.observed = 'de-DE' },
    input => { input.targets[0]!.artifacts[1]!.cases[0]!.observed[1]!.end = 999 },
    input => { input.targets[0]!.artifacts[1]!.cases[0]!.importedText = 'Missing\t12.34' },
    input => { input.targets[0]!.artifacts[1]!.cases[0]!.sourceRuns[0]!.text = 'Changed' },
    input => { input.targets[0]!.artifacts[1]!.cases[0]!.id = 'Different source case' },
    input => { input.targets[0]!.environment.locale.decimalSeparator = '' },
    input => { input.tolerancePoints = 20 },
  ]
  for (const mutate of mutations) {
    const input = fixture()
    mutate(input)
    expect(DecimalTabEvidenceV1Schema.safeParse(input).success).toBe(false)
  }
})

it('validates the replayed locale report and binds it to the checked-in reproducers', async () => {
  const root = new URL('../../../', import.meta.url)
  const report = DecimalTabEvidenceV1Schema.parse(JSON.parse(await readFile(new URL('docs/validation/decimal-libreoffice-7.3.7.2.json', root), 'utf8')))
  expect(report.targets.map(target => [target.environment.locale.observed, target.environment.locale.decimalSeparator])).toEqual([['en-US', '.'], ['de-DE', ','], ['fr-FR', ',']])
  expect(report.targets.every(target => target.artifacts.every(artifact => artifact.cases.every(entry => entry.status !== 'unexpected')))).toBe(true)
  expect(report.targets.flatMap(target => target.artifacts.filter(artifact => artifact.stage === 'actual-native-export')).every(artifact => artifact.cases.some(entry => entry.status === 'known-difference'))).toBe(true)
  for (const reproducer of report.reproducers) expect(createHash('sha256').update(await readFile(new URL(reproducer.path, root))).digest('hex')).toBe(reproducer.sha256)
})

it('pins browser profiles to diagnostic observations while retaining actual known differences', async () => {
  const root = new URL('../../../', import.meta.url)
  for (const profile of Object.values(decimalTabProfiles)) {
    const bytes = await readFile(new URL(profile.evidencePath, root))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(profile.evidenceSha256)
    const report = DecimalTabEvidenceV1Schema.parse(JSON.parse(bytes.toString()))
    const target = report.targets.find(target => target.environment.locale.observed === profile.locale)!
    expect(target.environment.locale.decimalSeparator).toBe(profile.separator)
    expect(target.environment.application.commandVersion).toBe(profile.application)
    expect(`${target.environment.platform.system} ${target.environment.platform.architecture}`).toBe(profile.platform)
    expect(target.artifacts.find(artifact => artifact.stage === profile.measurementBasis)!.cases.every(entry => entry.status === 'matched')).toBe(true)
    expect(target.artifacts.find(artifact => artifact.stage === 'actual-native-export')!.cases.every(entry => entry.status === profile.compatibility)).toBe(true)
  }
})

it('accepts the same explicit declarations in IR and the portable browser/native validator', () => {
  const declaration = { separator: '.', provenance: 'user-declared', reason: ' Source author confirms this convention ', targetProfile: 'libreoffice-7.3.7.2-linux-en-US' }
  const values: unknown[] = [declaration, ...Object.entries(decimalTabProfiles).map(([targetProfile, profile]) => ({ ...declaration, targetProfile, separator: profile.separator })), undefined, null, {}, { ...declaration, separator: ',' }, { ...declaration, separator: '\t' }, { ...declaration, targetProfile: '__proto__' }, { ...declaration, reason: ' ' }, { ...declaration, provenance: 'extracted' }, { ...declaration, evidenceSha256: '0'.repeat(64) }]
  for (const [index, value] of values.entries()) {
    const valid = DecimalTabSchema.safeParse(value)
    expect(valid.success).toBe(index < 4)
    if (valid.success) { validateDecimalTab(value); expect(valid.data).toEqual(value) }
    else expect(() => validateDecimalTab(value)).toThrow()
  }
  const manifest = { version: 1, sourcePptxSha256: 'a'.repeat(64), decimalTab: declaration }
  expect(DecimalTabDeclarationV1Schema.parse(manifest)).toEqual(manifest)
  expect(() => validateDecimalTabDeclaration(manifest, manifest.sourcePptxSha256)).not.toThrow()
  const layout = NativeMasterLayoutSchema.parse({ name: 'decimal', placeholders: [{ index: 0, type: 'body', x: 0, y: 0, width: 100000, height: 100000, textStyle: { paragraph: { decimalTab: declaration }, levels: [{ level: 2, paragraph: { decimalTab: null } }] } }] })
  expect(layout.placeholders[0]!.textStyle!.paragraph!.decimalTab).toEqual(declaration)
  expect(layout.placeholders[0]!.textStyle!.levels![0]!.paragraph!.decimalTab).toBeNull()
})
