import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { findDisallowedRawSourceReads } from './test-architecture-policy.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const testsDirectory = join(projectRoot, 'tests')
const testFiles = readdirSync(testsDirectory)
  .filter(file => file.endsWith('.test.cjs'))
  .sort()

function listHelperFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name)

      if (entry.isDirectory())
        return listHelperFiles(path)
      return entry.isFile() && entry.name.endsWith('.cjs') ? [path] : []
    })
}

const helperFiles = listHelperFiles(join(testsDirectory, 'helpers')).sort()

function parseTestFile(relativeFile, source) {
  return ts.createSourceFile(
    relativeFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
}

function countRegexLiterals(sourceFile) {
  let count = 0

  function visit(node) {
    if (ts.isRegularExpressionLiteral(node))
      count += 1
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return count
}

function analyseReferences(sourceFile) {
  const calledMethods = new Set()
  const identifiers = new Set()
  const imports = new Set()

  function visit(node) {
    if (ts.isIdentifier(node))
      identifiers.add(node.text)

    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'require'
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      imports.add(node.arguments[0].text)
    }

    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
    ) {
      calledMethods.add(node.expression.name.text)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { calledMethods, identifiers, imports }
}

const measurements = testFiles.map((file) => {
  const absoluteFile = join(testsDirectory, file)
  const source = readFileSync(absoluteFile, 'utf8')
  const sourceFile = parseTestFile(relative(projectRoot, absoluteFile), source)

  return {
    ...analyseReferences(sourceFile),
    file,
    lines: source.split('\n').length,
    regexLiterals: countRegexLiterals(sourceFile),
    disallowedRawReads: file === 'text-fit-contract.test.cjs'
      ? findDisallowedRawSourceReads(source, file)
      : [],
  }
})
const helperMeasurements = helperFiles.map((absoluteFile) => {
  const source = readFileSync(absoluteFile, 'utf8')

  return {
    file: relative(testsDirectory, absoluteFile),
    lines: source.split('\n').length,
  }
})
const lineMeasurements = [...measurements, ...helperMeasurements]
const totalRegexLiterals = measurements.reduce((total, measurement) => total + measurement.regexLiterals, 0)
const foundationRegexLiterals = measurements
  .filter(({ file }) => file.startsWith('foundation-') || file === 'layout-public-api.test.cjs')
  .reduce((total, measurement) => total + measurement.regexLiterals, 0)
const longest = lineMeasurements.reduce(
  (current, measurement) => measurement.lines > current.lines ? measurement : current,
  { file: '', lines: 0 },
)
const failures = []

for (const measurement of lineMeasurements) {
  if (measurement.lines > 500)
    failures.push(`${measurement.file}: ${measurement.lines} строк (максимум 500)`)
}
for (const measurement of measurements) {
  for (const rawRead of measurement.disallowedRawReads)
    failures.push(`${measurement.file}: запрещено читать исходник .vue/.ts как обычный текст (${rawRead})`)
}
if (totalRegexLiterals > 250)
  failures.push(`tests/*.test.cjs: ${totalRegexLiterals} литералов регулярных выражений (максимум 250)`)
if (foundationRegexLiterals > 70)
  failures.push(`foundation/layout: ${foundationRegexLiterals} литералов регулярных выражений (максимум 70)`)

const textFitFixtureImport = './helpers/text-fit-runtime-fixtures.cjs'
const textFitResponsibilitySuites = measurements.filter(measurement =>
  measurement.imports.has(textFitFixtureImport),
)

if (!textFitResponsibilitySuites.length)
  failures.push(`наборы тестов ответственности text-fit должны импортировать ${textFitFixtureImport}`)

const coveredEntrypoints = new Set()
for (const suite of textFitResponsibilitySuites) {
  const callsElement = suite.calledMethods.has('useElement')
  const callsGroup = suite.calledMethods.has('useGroup')
  const elementOnlySuite = /-element(?:[.-])/.test(suite.file)
  const groupOnlySuite = /-group(?:[.-])/.test(suite.file)
  const browserSuite = /-browser(?:[.-])/.test(suite.file)

  if (callsElement)
    coveredEntrypoints.add('useElement')
  if (callsGroup)
    coveredEntrypoints.add('useGroup')
  if (elementOnlySuite && (callsGroup || suite.identifiers.has('handleType')))
    failures.push(`${suite.file} смешивает тесты useElement с координацией групп`)
  if (groupOnlySuite && (callsElement || suite.identifiers.has('handleType')))
    failures.push(`${suite.file} смешивает тесты useGroup с жизненным циклом элемента`)
  if (callsElement && callsGroup && !browserSuite)
    failures.push(`${suite.file} смешивает useElement/useGroup вне браузерной ответственности`)
}

for (const entrypoint of ['useElement', 'useGroup']) {
  if (!coveredEntrypoints.has(entrypoint))
    failures.push(`наборы тестов ответственности text-fit не покрывают ${entrypoint}`)
}

console.log(
  `Архитектура тестов: ${measurements.length} тестовых файлов и `
  + `${helperMeasurements.length} вспомогательных файлов; максимум ${longest.lines} строк (${longest.file}).`,
)
console.log(
  `Регулярные выражения: ${totalRegexLiterals}/250 всего; `
  + `${foundationRegexLiterals}/70 в foundation/layout.`,
)

if (failures.length) {
  console.error('Нарушения архитектуры тестов:')
  for (const failure of failures)
    console.error(`- ${failure}`)
  process.exitCode = 1
}
