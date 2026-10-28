import { expect, it } from 'vitest'
import { compileDeck } from '../src/index.js'
it('compiles transition and stable anchors', () => {
  const [s] = compileDeck('---\ntransition: fade\n---\n<div id="hero">Hi</div>')
  expect(s?.animation.transition.kind).toBe('fade')
  expect(s?.anchors).toEqual(['hero'])
})
it('compiles clicks and speaker notes into sidecar IR', () => {
  const [s] = compileDeck(
    '---\nclicks: 1\n---\n<!-- notes: Explain this -->\n<div id="hero" v-click>Hi</div>',
  )
  expect(s?.animation.groups[0]?.effects[0]?.trigger).toBe('on-click')
  expect(s?.notes.spokenText).toBe('Explain this')
})
it('derives deterministic content anchors when ids are absent', () => {
  const a = compileDeck('<div>Alpha</div>')[0]?.anchors[0]
  const b = compileDeck('<div>Alpha</div>')[0]?.anchors[0]
  const c = compileDeck('<div>Beta</div>')[0]?.anchors[0]
  expect(a).toBe(b)
  expect(a).not.toBe(c)
  expect(a).toMatch(/^g-[0-9a-f]{10}$/)
})
it('binds v-click to its own node anchor', () => {
  const [slide] = compileDeck(
    '<div>Static</div><div id="animated" v-click>Reveal</div>',
  )
  expect(
    slide?.animation.groups.find((group) => group.id === 'animated')?.effects[0]
      ?.target,
  ).toBe('animated')
})

it('compiles ordinary pages without treating delimiters as null frontmatter', () => {
  const slides = compileDeck(
    '---\ntheme: test\n---\n# A\n\n---\n\n# B\n\n---\n\n# C',
  )
  expect(slides.map((slide) => slide.markdown)).toEqual(['# A', '# B', '# C'])
})

it('uses Slidev parsing for CRLF, per-page frontmatter, code fences and notes', () => {
  const source = [
    '---',
    'theme: test',
    '---',
    '# A',
    '```md',
    '---',
    '# not a page',
    '```',
    '',
    '---',
    'layout: center',
    'transition: fade',
    '---',
    '# B',
    '<!--',
    'speaker notes',
    '---',
    'still notes',
    '-->',
  ].join('\r\n')
  const slides = compileDeck(source)
  expect(slides).toHaveLength(2)
  expect(slides[0]?.markdown).toContain('# not a page')
  expect(slides[1]?.animation.transition.kind).toBe('fade')
  expect(slides[1]?.notes.spokenText).toBe('speaker notes\n---\nstill notes')
})

import { persistSlideIds } from '../src/index.js'
it('persists legacy identities once and retains them through reordering and wording edits', () => {
  const original =
    '---\ntheme: test\n---\n# First\n\n---\n\n# Second\n\n---\nlayout: center\n---\n# Third\n'
  const persisted = persistSlideIds(original, () => 'new-page')
  expect(compileDeck(persisted).map((s) => s.slideId)).toEqual([
    'slide-1',
    'slide-2',
    'slide-3',
  ])
  expect(persistSlideIds(persisted, () => 'unused')).toBe(persisted)
  const reordered =
    '---\nfastpptId: slide-3\n---\n# Edited third\n\n---\nfastpptId: slide-1\n---\n# First\n'
  expect(
    compileDeck(persistSlideIds(reordered, () => 'unused')).map(
      (s) => s.slideId,
    ),
  ).toEqual(['slide-3', 'slide-1'])
  const inserted = persistSlideIds(
    persisted + '\n---\n\n# New\n',
    () => 'new-page',
  )
  expect(compileDeck(inserted).at(-1)?.slideId).toBe('new-page')
})
it('preserves CRLF and refuses duplicate page identities', () => {
  const result = persistSlideIds(
    '# First\r\n\r\n---\r\n\r\n# Second',
    () => 'new',
  )
  expect(result.replace(/\r\n/g, '')).not.toContain('\n')
  expect(compileDeck(result)).toHaveLength(2)
  expect(() =>
    persistSlideIds(
      '---\nfastpptId: same\n---\n# A\n\n---\nfastpptId: same\n---\n# B',
      () => 'new',
    ),
  ).toThrow('Duplicate')
})

import { persistDeckIdentities } from '../src/index.js'
it('materializes anonymous object anchors and retains binding after wording changes', () => {
  const original = '# Page\r\n<div v-click>Before</div>\r\n<img src="x" />'
  const before = compileDeck(original)[0]!.anchors
  const persisted = persistDeckIdentities(original, () => 'id')
  expect(persisted).toContain('data-fastppt-group=')
  expect(compileDeck(persisted.replace('Before', 'After'))[0]!.anchors).toEqual(
    before,
  )
  expect(persistDeckIdentities(persisted, () => 'id')).toBe(persisted)
  expect(persisted).toContain(' />')
})
it('does not identify or rewrite HTML examples in code fences and comments', () => {
  const source =
    '# A\n```html\n<div v-click>Example</div>\n```\n<!-- <div>Comment</div> -->\n<div id="real">Content</div>'
  const persisted = persistDeckIdentities(source, () => 'id')
  expect(compileDeck(persisted)[0]?.anchors).toEqual(['real'])
  expect(persisted).toContain('```html\n<div v-click>Example</div>\n```')
  expect(persisted).toContain('<!-- <div>Comment</div> -->')
})
it('assigns a fresh identity when an identical anonymous node is inserted before a persisted node', () => {
  const original = persistDeckIdentities('<div>Same</div>', () => 'unused')
  const oldAnchor = compileDeck(original)[0]!.anchors[0]
  const inserted = original.replace('<div data-', '<div>Same</div>\n<div data-')
  let sequence = 0
  const stable = persistDeckIdentities(inserted, () => `new-${++sequence}`)
  const anchors = compileDeck(stable)[0]!.anchors
  expect(anchors[1]).toBe(oldAnchor)
  expect(anchors[0]).not.toBe(oldAnchor)
})

it('migrates legacy formatter output with no blank after a page separator', () => {
  const source = '---\ntheme: test\n---\n# A\n\n---\n# B\n'
  const persisted = persistDeckIdentities(source, () => 'fresh')
  expect(
    compileDeck(persisted).map((page) => [page.slideId, page.markdown]),
  ).toEqual([
    ['slide-1', '# A'],
    ['slide-2', '# B'],
  ])
  expect(persistDeckIdentities(persisted, () => 'unused')).toBe(persisted)
})

it('retains per-page layout selection without reading layout-like body content', () => {
  const slides = compileDeck('---\nlayout: cover\n---\n# A\n\n---\nlayout: " body "\n---\n# B\n\n---\n\n# C\n\n```yaml\nlayout: fake\n```')
  expect(slides.map(slide => slide.layout)).toEqual(['cover', 'body', 'default'])
})

it('compiles explicit placeholder bindings and rejects missing or duplicate targets', () => {
  const source = '---\nfastpptPlaceholders:\n  title: 0\n---\n<h1 id="title">Hello</h1>'
  expect(compileDeck(source)[0]?.placeholderBindings).toEqual([{ target: 'title', index: 0 }])
  expect(() => compileDeck(source.replace('title: 0', 'missing: 0'))).toThrow('unique object anchor')
  expect(() => compileDeck(source.replace('title: 0', 'title: -1'))).toThrow('Invalid placeholder index')
  expect(() => compileDeck(source + '<h1 id="title">Duplicate</h1>')).toThrow('unique object anchor')
})

it('keeps a bound anonymous object identity when persisting an initialized page', () => {
  const body = '<h1>Bound title</h1>'
  const target = compileDeck(body)[0]!.anchors[0]!
  const source = `---\nfastpptId: existing\nfastpptPlaceholders:\n  ${target}: 0\n---\n${body}`
  const persisted = persistDeckIdentities(source, () => 'fresh')
  expect(persisted).toContain(`data-fastppt-group="${target}"`)
  expect(compileDeck(persisted)[0]!.placeholderBindings).toEqual([{ target, index: 0 }])
  expect(compileDeck(persisted.replace('Bound title', 'Edited title'))[0]!.anchors).toEqual([target])
  expect(persistDeckIdentities(persisted, () => 'another')).toBe(persisted)
})
it('accepts explicit geometry inheritance while retaining numeric binding shorthand', () => {
  const source = '---\nfastpptPlaceholders:\n  title: { index: 0, geometry: layout, textStyle: layout, textBody: layout }\n---\n<h1 id="title">Title</h1>'
  expect(compileDeck(source)[0]?.placeholderBindings).toEqual([{ target: 'title', index: 0, geometry: 'layout', textStyle: 'layout', textBody: 'layout' }])
  expect(() => compileDeck(source.replace('textBody: layout', 'textBody: unknown'))).toThrow('text body policy')
  expect(() => compileDeck(source.replace('geometry: layout', 'geometry: unknown'))).toThrow('geometry policy')
  expect(() => compileDeck(source.replace('geometry: layout', 'typo: layout'))).toThrow('Unknown placeholder')
})

it('exposes semantic animation targets without guessing decorative elements are content', () => {
  const slide = compileDeck('<h1 id="title">Title</h1>\n<div id="body" data-fastppt-role="content">Body</div>\n<img id="logo" data-fastppt-role="logo" src="logo.png">\n<div id="unknown">Unknown</div>\n<div id="static" data-fastppt-role="content" data-fastppt-static>Static</div>')[0]!
  expect(slide.animationTargets).toEqual([
    { anchor: 'title', role: 'title', static: false },
    { anchor: 'body', role: 'content', static: false },
    { anchor: 'logo', role: 'logo', static: false },
    { anchor: 'unknown', role: 'unknown', static: false },
    { anchor: 'static', role: 'content', static: true },
  ])
})
