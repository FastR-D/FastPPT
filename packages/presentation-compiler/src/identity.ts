import { parseSlidevDocument } from '@fastppt/markdown/parser'

/** Persist identity in source so moving a page or editing its text keeps bindings.
 * Legacy positional IDs are assigned once. Later pages get fresh opaque IDs.
 */
export function persistSlideIds(
  source: string,
  createId: () => string,
): string {
  const pages = parseSlidevDocument(source)
  const ids = new Set<string>()
  for (const page of pages) {
    const id = page.frontmatter.fastpptId
    if (id === undefined) continue
    if (typeof id !== 'string' || !id.trim())
      throw new Error('fastpptId must be a non-empty string')
    if (ids.has(id)) throw new Error(`Duplicate slide identity: ${id}`)
    ids.add(id)
  }
  const legacy = ids.size === 0
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r?\n/)
  const edits: Array<{ line: number; content: string[] }> = []
  pages.forEach((page, index) => {
    if (page.frontmatter.fastpptId !== undefined) return
    const id = legacy ? `slide-${index + 1}` : createId()
    if (!id || ids.has(id)) throw new Error(`Duplicate slide identity: ${id}`)
    ids.add(id)
    const field = `fastpptId: ${JSON.stringify(id)}`
    if (lines[page.start]?.trim() === '---')
      edits.push({
        line: page.start + 1,
        content:
          page.frontmatterStyle === 'frontmatter' ? [field] : [field, '---'],
      })
    else
      edits.push({
        line: page.start,
        content: [...(index === 0 ? ['---'] : []), field, '---'],
      })
  })
  for (const edit of edits.reverse())
    lines.splice(edit.line, 0, ...edit.content)
  return lines.join(eol)
}
