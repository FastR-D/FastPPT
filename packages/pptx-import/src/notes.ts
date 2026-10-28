import { parseXml } from '@fastppt/slidewave/xml'
import {
  DRAWING_NS,
  PRESENTATION_NS,
  matchesNamespace,
} from './relationships.js'

type Element = ReturnType<typeof parseXml>

export interface ExtractedNotesText {
  part: string
  paragraphs: string[]
  text: string
  provenance: 'extracted'
}

function textContent(node: Element, xml: string): string {
  return xml
    .slice(node.openEnd, node.closeStart)
    .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
      const predefined: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
      }
      if (predefined[entity]) return predefined[entity]
      return String.fromCodePoint(
        parseInt(
          entity.slice(entity.startsWith('&#x') ? 3 : 2, -1),
          entity.startsWith('&#x') ? 16 : 10,
        ),
      )
    })
}

function paragraphText(node: Element, xml: string): string {
  return node.children
    .filter((child) => matchesNamespace(child.namespace, DRAWING_NS))
    .flatMap((child) => {
      if (child.local === 't') return [textContent(child, xml)]
      if (child.local === 'br') return ['\n']
      return child.children
        .filter(
          (grandchild) =>
            matchesNamespace(grandchild.namespace, DRAWING_NS) &&
            grandchild.local === 't',
        )
        .map((grandchild) => textContent(grandchild, xml))
    })
    .join('')
}

function collectParagraphs(node: Element, xml: string): string[] {
  const output: string[] = []
  if (
    matchesNamespace(node.namespace, PRESENTATION_NS) &&
    node.local === 'sp'
  ) {
    const placeholder = node.children
      .find(
        (child) =>
          matchesNamespace(child.namespace, PRESENTATION_NS) &&
          child.local === 'nvSpPr',
      )
      ?.children.find(
        (child) =>
          matchesNamespace(child.namespace, PRESENTATION_NS) &&
          child.local === 'nvPr',
      )
      ?.children.find(
        (child) =>
          matchesNamespace(child.namespace, PRESENTATION_NS) &&
          child.local === 'ph',
      )
    const type = placeholder?.attributes.type
    if (!type || ['body', 'obj', 'subTitle'].includes(type)) {
      const body = node.children.find(
        (child) =>
          matchesNamespace(child.namespace, PRESENTATION_NS) &&
          child.local === 'txBody',
      )
      for (const paragraph of body?.children.filter(
        (child) =>
          matchesNamespace(child.namespace, DRAWING_NS) && child.local === 'p',
      ) ?? [])
        output.push(paragraphText(paragraph, xml))
    }
  }
  for (const child of node.children)
    output.push(...collectParagraphs(child, xml))
  return output
}

/** Extract visible notes text while retaining the source part identity. */
export function extractNotesText(
  xml: string,
  part: string,
): ExtractedNotesText {
  if (!xml.trim())
    return { part, paragraphs: [], text: '', provenance: 'extracted' }
  const root = parseXml(xml)
  const paragraphs = collectParagraphs(root, xml)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  return {
    part,
    paragraphs,
    text: paragraphs.join('\n'),
    provenance: 'extracted',
  }
}
