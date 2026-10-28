import MarkdownIt from 'markdown-it'
// Markdown-generated markup only: raw HTML and images are disabled. Links pass
// markdown-it's protocol validator and cannot gain access to window.opener.
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true })
markdown.disable('image')
const linkOpen = markdown.renderer.rules.link_open
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index]!.attrSet('target', '_blank')
  tokens[index]!.attrSet('rel', 'noopener noreferrer')
  return linkOpen ? linkOpen(tokens, index, options, env, self) : self.renderToken(tokens, index, options)
}
export function renderMessageMarkdown(content: string): string { return markdown.render(content) }
export function userFacingContent(content: string): string {
  return content.replace(/^\s*(?:<fastppt-(?:resource-guidance|session-brief|target-page)>[\s\S]*?<\/fastppt-(?:resource-guidance|session-brief|target-page)>\s*)+/, '')
}
