import { expect, it } from 'vitest'
import { renderMessageMarkdown, userFacingContent } from '../../src/workspace/message-markdown.js'
it('renders tables and links while treating executable markup as text', () => {
  expect(renderMessageMarkdown('| A | B |\n|---|---|\n| 1 | 2 |')).toContain('<table>')
  expect(renderMessageMarkdown('[source](https://example.com)')).toContain('rel="noopener noreferrer"')
  expect(renderMessageMarkdown('<img src=x onerror=alert(1)>')).not.toContain('<img')
  expect(renderMessageMarkdown('[run](javascript:alert(1))')).not.toContain('href="javascript:')
  expect(renderMessageMarkdown('![track](https://example.com/track)')).not.toContain('<img')
})
it('hides injected instructions from user-facing conversation text', () => {
  expect(userFacingContent('<fastppt-resource-guidance>internal</fastppt-resource-guidance>\n\n<fastppt-session-brief>theme</fastppt-session-brief>\n\n请修改第2页')).toBe('请修改第2页')
  expect(userFacingContent('ordinary content')).toBe('ordinary content')
})
