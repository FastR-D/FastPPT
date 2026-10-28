import { verifyTemplateGolden } from './lib/template-golden-evidence.js'

if (!process.argv[2])
  throw new Error(
    'Usage: tsx scripts/verify-template-golden.ts <run-directory>',
  )
console.log(JSON.stringify(await verifyTemplateGolden(process.argv[2])))
