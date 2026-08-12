import { format } from 'prettier'
import slidevPlugin from 'prettier-plugin-slidev'

import type { ParserOptions } from 'prettier'

export interface FormatSlidevMarkdownOptions {
  printWidth?: number
}

export interface SlidevFormatLocation {
  line: number
  column: number
}

export class SlidevFormatError extends Error {
  readonly location: SlidevFormatLocation | undefined

  constructor(message: string, location?: SlidevFormatLocation) {
    super(message)
    this.name = 'SlidevFormatError'
    this.location = location
  }
}

function formatLocation(cause: unknown): SlidevFormatLocation | undefined {
  if (!cause || typeof cause !== 'object' || !('mark' in cause))
    return undefined
  const mark = cause.mark
  if (!mark || typeof mark !== 'object') return undefined
  const line = 'line' in mark ? mark.line : undefined
  const column = 'column' in mark ? mark.column : undefined
  return typeof line === 'number' && typeof column === 'number'
    ? { line: line + 1, column: column + 1 }
    : undefined
}

function normalizeFrontmatterSpacing(source: string): string {
  const lines = source.split(/\r?\n/)
  let inFrontmatter = false
  let justOpened = false
  const output: string[] = []
  for (const line of lines) {
    const delimiter = /^\s*---\s*$/.test(line)
    if (delimiter) {
      if (inFrontmatter) {
        while (output.length > 0 && output.at(-1)?.trim() === '') output.pop()
        output.push('---')
        inFrontmatter = false
        justOpened = false
      } else if (output.length === 0 || output.at(-1)?.trim() === '') {
        output.push('---')
        inFrontmatter = true
        justOpened = true
      } else {
        output.push('---')
        inFrontmatter = true
        justOpened = true
      }
      continue
    }
    if (inFrontmatter && justOpened && line.trim() === '') continue
    if (inFrontmatter) justOpened = false
    output.push(line)
  }
  return output.join('\n')
}

function mergeLeadingAdjacentFrontmatter(source: string): string {
  const match = source.match(
    /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)[\t ]*\r?\n[\t ]*---\r?\n([\s\S]*?)(\r?\n---)(?=\r?\n|$)/,
  )
  if (!match) return source
  const [, opening, globalFrontmatter, , slideFrontmatter, closing] = match
  if (
    opening === undefined ||
    globalFrontmatter === undefined ||
    slideFrontmatter === undefined ||
    closing === undefined
  )
    return source
  const merged = `${opening}${globalFrontmatter.trimEnd()}\n${slideFrontmatter.trim()}${closing}`
  return `${merged}${source.slice(match[0].length)}`
}

export async function validateSlidevMarkdown(source: string): Promise<void> {
  try {
    const parser = slidevPlugin.parsers?.slidev
    if (!parser) throw new Error('The Slidev Markdown parser is unavailable.')
    await parser.parse(source, {} as ParserOptions<unknown>)
  } catch (cause) {
    throw new SlidevFormatError(
      cause instanceof Error
        ? cause.message
        : 'Slidev Markdown validation failed.',
      formatLocation(cause),
    )
  }
}

export async function formatSlidevMarkdown(
  source: string,
  options: FormatSlidevMarkdownOptions = {},
): Promise<string> {
  try {
    await validateSlidevMarkdown(source)
    const formatted = mergeLeadingAdjacentFrontmatter(
      normalizeFrontmatterSpacing(
        await format(source, {
          parser: 'slidev',
          plugins: [slidevPlugin],
          printWidth: options.printWidth ?? 90,
          proseWrap: 'preserve',
          singleQuote: true,
        }),
      ),
    )
    await validateSlidevMarkdown(formatted)
    return formatted
  } catch (cause) {
    if (cause instanceof SlidevFormatError) throw cause
    throw new SlidevFormatError(
      cause instanceof Error ? cause.message : 'Slidev formatting failed.',
      formatLocation(cause),
    )
  }
}
