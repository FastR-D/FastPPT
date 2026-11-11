import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(
  await readFile(new URL('../font-integrity.json', import.meta.url), 'utf8'),
)
for (const [file, expected] of Object.entries(manifest.sha256)) {
  const bytes = await readFile(
    new URL(`../assets/fonts/${file}`, import.meta.url),
  )
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error(`Font integrity mismatch: ${file}`)
  }
}
console.log(`Verified ${Object.keys(manifest.sha256).length} bundled fonts`)
