import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { NodePresentation } from '../src/server/presentation.js'

describe('presentation package content types', () => {
  it.each([false, true])('declares only existing parts for multiple slides (master=%s)', async master => {
    const presentation = new NodePresentation({ layout: 'LAYOUT_WIDE', master })
    for (let i = 0; i < 3; i++) presentation.addSlide().addShape('rect', { x: 1, y: 1, w: 2, h: 1 })
    const directory = await mkdtemp(join(tmpdir(), 'fastppt-package-'))
    try {
      const path = join(directory, 'multi-slide.pptx')
      await presentation.save(path)
      for (const bytes of [await presentation.toArrayBuffer(), await readFile(path)]) {
        const zip = await JSZip.loadAsync(bytes)
        const types = await zip.file('[Content_Types].xml')!.async('string')
        const parts = [...types.matchAll(/<Override\b[^>]*PartName="\/([^"]+)"/g)].map(match => match[1]!)
        expect(parts.length).toBeGreaterThan(3)
        for (const part of parts) expect(zip.file(part), part).not.toBeNull()
        expect(parts.filter(part => part.startsWith('ppt/slideMasters/'))).toEqual(['ppt/slideMasters/slideMaster1.xml'])
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
