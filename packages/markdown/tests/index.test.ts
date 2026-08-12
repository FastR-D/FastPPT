import { describe, expect, it } from 'vitest'

import {
  SlidevFormatError,
  formatSlidevMarkdown,
  validateSlidevMarkdown,
} from '../src/index.js'

describe('formatSlidevMarkdown', () => {
  it('preserves Slidev frontmatter and slide boundaries idempotently', async () => {
    const source = `---\ntheme: slidev-theme-academy\ntitle: Test\n---\n\n#  Title\n\n- a\n- b\n\n---\nlayout: split\n---\n\n# Next\n`
    const formatted = await formatSlidevMarkdown(source)
    expect(formatted).toContain('theme: slidev-theme-academy')
    expect(formatted).toContain('layout: split')
    expect(formatted.match(/^---$/gm)).toHaveLength(4)
    expect(await formatSlidevMarkdown(formatted)).toBe(formatted)
  })

  it('reports a one-based source location for invalid frontmatter', async () => {
    const failure = await formatSlidevMarkdown(
      '---\ntheme: [\n---\n# Broken\n',
    ).catch((cause: unknown) => cause)
    expect(failure).toBeInstanceOf(SlidevFormatError)
    expect(failure).toMatchObject({ location: { line: 2, column: 1 } })
  })

  it('removes blank lines inside Slidev frontmatter delimiters', async () => {
    const formatted = await formatSlidevMarkdown(
      '---\n\nlayout: content-flex\nchapter: 01 初识\nsection: 什么是 Claude Code\n\n---\n\n# Intro\n',
    )
    expect(formatted).toContain(
      '---\nlayout: content-flex\nchapter: 01 初识\nsection: 什么是 Claude Code\n---',
    )
    expect(formatted).not.toContain('---\n\nlayout:')
    expect(formatted).not.toContain('Code\n\n---')
  })

  it('merges adjacent leading frontmatter instead of creating an empty first slide', async () => {
    const formatted = await formatSlidevMarkdown(
      '---\ntheme: slidev-theme-landing\ninfo: Demo\n---\n\n---\nlayout: cover\n---\n\nDeck title\n',
    )
    expect(
      formatted.startsWith(
        '---\ntheme: slidev-theme-landing\ninfo: Demo\nlayout: cover\n---\n\nDeck title',
      ),
    ).toBe(true)
    expect(formatted.match(/^---$/gm)).toHaveLength(2)
    expect(await formatSlidevMarkdown(formatted)).toBe(formatted)
  })

  it('exposes the same basic Slidev syntax validation independently', async () => {
    await expect(
      validateSlidevMarkdown('---\ntheme: ok\n---\n\n# Valid\n'),
    ).resolves.toBeUndefined()
    await expect(
      validateSlidevMarkdown('---\ntheme: [\n---\n# Broken\n'),
    ).rejects.toMatchObject({ location: { line: 2, column: 1 } })
  })
})
