import { parseSlide, parseSync } from '@slidev/parser'

// Keep this entry separate from the formatter so browser consumers do not
// bundle Prettier. Navigation and compilation use the pinned Slidev grammar.
export function parseSlidevDocument(source: string): ReturnType<typeof parseSync>['slides'] {
  return parseSync(source, '').slides
}

export function parseSlidevPage(source: string): ReturnType<typeof parseSlide> {
  return parseSlide(source.replace(/\r\n/g, '\n'))
}
