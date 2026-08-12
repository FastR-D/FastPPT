#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

const filename = process.argv[2]
if (!filename) {
  console.error('Usage: check-deck.mjs <slides.md>')
  process.exitCode = 2
} else {
  const source = await readFile(filename, 'utf8')
  const errors = []
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n'))
    errors.push('Deck must begin with global frontmatter')
  if (!/^theme:\s*\S+/m.test(source))
    errors.push('Global frontmatter must declare a theme')
  if (!/^#\s+\S+/m.test(source)) errors.push('Deck must contain a heading')
  if (source.includes('data:image/'))
    errors.push('Store images as files instead of base64 data URIs')
  if (errors.length) {
    for (const error of errors) console.error(error)
    process.exitCode = 1
  } else console.log('Basic FastPPT deck checks passed')
}
