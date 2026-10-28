import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { materializeMasterThemes } from '../src/server/master-themes.js'
it('rejects conflicting group themes before package mutation', async () => {
  const zip = new JSZip()
  await expect(materializeMasterThemes(zip, [
    { name: 'A', masterId: 'brand', placeholders: [], masterTheme: { fontFamily: 'Inter' } },
    { name: 'B', masterId: 'brand', placeholders: [], masterTheme: { fontFamily: 'Arial' } },
  ], new Map())).rejects.toThrow('Conflicting theme definitions')
  expect(Object.keys(zip.files)).toHaveLength(0)
})
