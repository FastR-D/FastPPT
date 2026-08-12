import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const packageRoot = resolve(process.argv[2] ?? '.')
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
const manifest = JSON.parse(
  await readFile(join(packageRoot, 'agent/theme-manifest.json'), 'utf8'),
)
const skill = await readFile(join(packageRoot, manifest.skill.sourceDir, 'SKILL.md'), 'utf8')

if (packageJson.name !== manifest.packageName || packageJson.version !== manifest.skill.version)
  throw new Error('Theme package identity/version does not match its manifest')
if (!skill.startsWith('---\n') || !skill.includes(`name: ${manifest.skill.id}`))
  throw new Error('Theme Skill frontmatter does not match its manifest')

for (const sourceDirectory of ['components', 'layouts']) {
  const files = (await readdir(join(packageRoot, sourceDirectory))).filter((file) =>
    file.endsWith('.vue'),
  )
  for (const file of files) {
    const source = await readFile(join(packageRoot, sourceDirectory, file), 'utf8')
    if (!/<(?:template|script)(?:\s|>)/.test(source))
      throw new Error(`${sourceDirectory}/${file} is not a valid non-empty Vue SFC`)
  }
}

for (const layout of manifest.layouts) {
  await readFile(join(packageRoot, 'layouts', `${layout.id}.vue`), 'utf8')
}

const defaultLayout = await readFile(join(packageRoot, 'layouts/default.vue'), 'utf8')
if (!defaultLayout.includes('<slot'))
  throw new Error('The default layout must render slide Markdown through a slot')

console.log(`theme smoke passed: ${manifest.id} -> ${manifest.skill.id}`)
