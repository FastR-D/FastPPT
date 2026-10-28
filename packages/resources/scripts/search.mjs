#!/usr/bin/env node
// Node 22.6+ supports --experimental-strip-types; no model or API key required.
import { ResourceLibrary } from '../src/index.ts'
const args = process.argv.slice(2)
const option = (key) => { const index = args.indexOf(key); return index >= 0 ? args[index + 1] : undefined }
const library = new ResourceLibrary()
const id = option('--id')
const result = id ? await library.read(id) : await library.search({
  query: option('--query') ?? '', kind: option('--kind'), density: option('--density'),
  limit: Number(option('--limit') ?? 6), offset: Number(option('--offset') ?? 0),
})
process.stdout.write(`${JSON.stringify(result ?? { error: 'Resource not found' }, null, 2)}\n`)
