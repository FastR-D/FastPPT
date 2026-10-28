import { expect, it } from 'vitest'
import { extractNotesText } from '../src/notes.js'
import { DRAWING_NS, PRESENTATION_NS } from '../src/relationships.js'

it('extracts reachable notes paragraphs and decodes text entities', () => {
  const xml = `<p:notes xmlns:p="${PRESENTATION_NS}" xmlns:a="${DRAWING_NS}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Speak &amp; explain</a:t></a:r></a:p><a:p><a:r><a:t>第二页</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`
  expect(extractNotesText(xml, 'ppt/notesSlides/notes1.xml')).toEqual({
    part: 'ppt/notesSlides/notes1.xml',
    paragraphs: ['Speak & explain', '第二页'],
    text: 'Speak & explain\n第二页',
    provenance: 'extracted',
  })
})
