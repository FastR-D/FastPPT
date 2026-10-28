#!/usr/bin/env node
/** Render actual resource pages, repair source runs, compare and publish verified QA. */
import { spawn } from 'node:child_process'
import { access, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const directory = dirname(fileURLToPath(import.meta.url))
const output = join(directory, '../visual-comparison')
async function run(program, args) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', resolve)
  })
  if (code !== 0) process.exit(typeof code === 'number' ? code : 1)
}
const render = (...args) => run(process.execPath, ['--experimental-strip-types', join(directory, 'compare-visuals.mjs'), ...args])
if (!process.argv.includes('--save-screenshots')) {
  await render()
  const report = JSON.parse(await readFile(join(output, 'live-dom-audit.json'), 'utf8'))
  const results = report.records.map(({id,markdownSha256,textOverflow,textOutsidePage,missingImages,error}) => ({id,markdownSha256,textOverflow,textOutsidePage,missingImages,...(error?{error}:{})}))
  await writeFile(join(directory,'../render-audit.json'), JSON.stringify({version:1,sourceIndexSha256:report.sourceIndexSha256,pages:results.length,errors:results.filter(r=>r.error).length,mode:'live-dom-without-screenshots',results},null,2)+'\n')
  if (results.some(result => result.error)) process.exitCode = 1
} else {
await run('python3', [join(directory, 'clean-branding.py'), '--apply'])
await render('--repair', '--save-screenshots')
await run('python3', [join(directory, 'repair-source-runs.py')])
const ids = join(output, 'source-runs-repaired-ids.json')
if (JSON.parse(await readFile(ids, 'utf8')).length) {
  await render('--repair', '--save-screenshots', '--ids-file', ids)
  const reportPath = join(output, 'browser-comparison.json')
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  const repairs = JSON.parse(await readFile(join(output, 'repair-browser-comparison.json'), 'utf8'))
  const records = new Map(report.records.map(row => [row.id, row]))
  for (const row of repairs.records) records.set(row.id, row)
  report.records = [...records.values()].sort((a, b) => a.id.localeCompare(b.id))
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
}
await run('python3', [join(directory, 'compare-images.py')])
if (await access(join(output, 'source-fonts.json')).then(() => true, () => false))
  await run('python3', [join(directory, 'check-fonts.py')])
await run('python3', [join(directory, 'finalize-visuals.py')])

}
