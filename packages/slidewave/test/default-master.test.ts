import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { writeEditablePptx } from '../src/server/index.js'
import { landingContentDeck } from './slidev/fixtures/landingContentSlide.js'

it.each([false, true])('exports editable content without unsolicited placeholders (named layouts: %s)', async (namedLayouts) => {
  const directory = await mkdtemp(join(tmpdir(), 'fastppt-default-master-'))
  try {
    const path = join(directory, 'deck.pptx')
    const snapshot = structuredClone(landingContentDeck)
    snapshot.slides.push({ ...structuredClone(snapshot.slides[0]!), id: 'second' })
    await writeEditablePptx(snapshot, path, {
      embedFonts: false,
      ...(namedLayouts ? { masterLayouts: ['Cover', 'Content'], slideLayouts: ['Cover', 'Content'] } : {}),
    })
    const zip = await JSZip.loadAsync(await readFile(path))
    const parts = Object.keys(zip.files).filter(name => /^ppt\/(?:slides\/slide|slideLayouts\/slideLayout|slideMasters\/slideMaster)\d+\.xml$/.test(name))
    for (const name of parts) {
      const xml = await zip.file(name)!.async('string')
      expect(xml, name).not.toMatch(/<p:ph\b/)
      if (/^ppt\/slides\//.test(name)) {
        expect(xml, name).toContain('<a:t>Research background</a:t>')
        expect(xml, name).toContain('<a:t>Editable text</a:t>')
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
