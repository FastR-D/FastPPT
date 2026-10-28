/** Browser observations only. Automatic lines are never inserted as native
 * hard breaks; the target application remains responsible for native wrapping. */
export interface TextTabLayout {
  version: 1
  text: string
  lines: Array<{
    start: number
    end: number
    breakBefore: 'paragraph' | 'soft' | 'automatic'
    /** Relative to the paragraph; absent for an empty authored line. */
    box?: { x: number; y: number; width: number; height: number } | undefined
    tabs: number[]
  }>
}

export function validateTextTabLayout(value: TextTabLayout, text: string): void {
  if (value.version !== 1 || value.text !== text || !value.lines.length) throw new Error('Tab line observations do not match the source text.')
  let end = 0
  for (const [index, line] of value.lines.entries()) {
    if (!Number.isSafeInteger(line.start) || !Number.isSafeInteger(line.end) || line.start !== end || line.end < line.start || line.end > text.length) throw new Error('Tab line ranges must cover the source in order.')
    if (line.breakBefore !== (index === 0 ? 'paragraph' : text[end - 1] === '\n' ? 'soft' : 'automatic')) throw new Error('Tab line break kind does not match the source text.')
    const part = text.slice(line.start, line.end)
    if (!part && (index !== value.lines.length - 1 || (text && !text.endsWith('\n')))) throw new Error('Only a final empty authored line may have no source characters.')
    if (part.includes('\n') && part.indexOf('\n') !== part.length - 1) throw new Error('A tab line cannot contain an interior soft break.')
    if (line.tabs.join(',') !== [...part.matchAll(/\t/g)].map(match => line.start + match.index).join(',')) throw new Error('Tab line positions do not match the source characters.')
    if (part.replace(/\n$/, '') && !line.box) throw new Error('A nonempty tab line needs measured bounds.')
    if (line.box && (Object.values(line.box).some(number => !Number.isFinite(number)) || line.box.width < 0 || line.box.height <= 0)) throw new Error('Tab line bounds must be finite with positive height.')
    end = line.end
  }
  if (end !== text.length) throw new Error('Tab line observations omit source text.')
}
