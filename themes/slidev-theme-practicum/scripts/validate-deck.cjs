#!/usr/bin/env node
const { resolve } = require('node:path')
const { formatDeckLayoutIssues, validateDeckLayouts } = require('../composables/validate-deck-layouts.cjs')

const deckPath = resolve(process.argv[2] ?? 'example.md')

validateDeckLayouts(deckPath).then((issues) => {
  if (!issues.length) {
    console.log(`OK: ${deckPath} — контракты layout/markdown соблюдены.`)
    process.exit(0)
  }

  console.error(formatDeckLayoutIssues(issues, deckPath))
  process.exit(1)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
