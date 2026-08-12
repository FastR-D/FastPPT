import { Comment, Fragment, Text as NativeText, isVNode } from 'vue'
import { dedentMarkdownSource } from './layout-markdown.mjs'
import { markdownToVnodes } from './markdown-to-vnodes.mjs'

const PASS_THROUGH_BLOCK_TAGS = new Set([
  'ul',
  'ol',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
])

const MARKDOWN_INLINE_PATTERN = /\*\*|__|`|!\[|\[[^\]]+\]\(/

/**
 * @param {import('vue').VNode | null | undefined} node
 * @param {string} [separator]
 * @returns {string}
 */
function readVnodePlainText(node, separator = '') {
  if (!node)
    return ''

  if (node.type === NativeText)
    return String(node.children ?? '')

  if (typeof node.children === 'string')
    return node.children

  if (Array.isArray(node.children)) {
    return node.children
      .map(child => isVNode(child) ? readVnodePlainText(child, separator) : String(child ?? ''))
      .join(separator)
  }

  return ''
}

/** @param {import('vue').VNode | null | undefined} node */
function readPreLikePlainText(node) {
  return readVnodePlainText(node, '\n')
}

/** @param {import('vue').VNode | null | undefined} node */
function isBlankTextNode(node) {
  return node?.type === NativeText
    && typeof node.children === 'string'
    && !node.children.trim()
}

/** @param {string} source */
function countOrderedListMarkers(source) {
  return source.match(/\d+\.\s+/g)?.length ?? 0
}

/**
 * @param {string} source
 */
function expandInlineOrderedListLines(source) {
  if (countOrderedListMarkers(source) < 2)
    return source

  if (source.split(/\r?\n/).filter(line => /^\s*\d+\.\s/.test(line)).length >= 2)
    return source

  return source.replace(/\s+(?=\d+\.\s+)/g, '\n')
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function splitContentLines(source) {
  return source.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

/**
 * @param {string} source
 */
function looksLikeMarkdown(source) {
  const trimmed = source.trim()

  if (!trimmed)
    return false

  if (MARKDOWN_INLINE_PATTERN.test(trimmed))
    return true

  const lines = splitContentLines(source)
  const firstLine = lines[0] ?? ''

  if (/^#{1,6}\s/.test(firstLine) || /^>\s/.test(firstLine))
    return true

  const bulletLines = lines.filter(line => /^[-*+]\s/.test(line))
  const orderedLines = lines.filter(line => /^\d+\.\s/.test(line))

  if (orderedLines.length >= 2)
    return true

  if (countOrderedListMarkers(trimmed) >= 2)
    return true

  if (bulletLines.length >= 2)
    return true

  if (bulletLines.length === 1 && lines.length === 1)
    return true

  if (/\n\s*\n/.test(trimmed) && trimmed.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean).length >= 2)
    return true

  return false
}

/**
 * @param {import('vue').VNode[]} nodes
 * @returns {string | null}
 */
function collectMarkdownSource(nodes) {
  const parts = []

  for (const node of nodes) {
    if (node.type === Comment || isBlankTextNode(node))
      continue

    if (node.type === NativeText) {
      parts.push(String(node.children ?? ''))
      continue
    }

    if (node.type === 'pre' || node.type === 'code') {
      const text = readPreLikePlainText(node)

      if (!text.trim())
        return null

      parts.push(text)
      continue
    }

    if (node.type === Fragment && Array.isArray(node.children)) {
      const inner = collectMarkdownSource(node.children.filter(isVNode))

      if (inner == null)
        return null

      parts.push(inner)
      continue
    }

    if (typeof node.type === 'string' && PASS_THROUGH_BLOCK_TAGS.has(node.type))
      return null

    if (node.type === 'p' || node.type === 'div') {
      const text = readVnodePlainText(node).trim()

      if (text)
        parts.push(text)

      continue
    }

    return null
  }

  const source = dedentMarkdownSource(expandInlineOrderedListLines(parts.join('\n').replace(/\r\n/g, '\n'))).trim()

  return source || null
}

/**
 * @param {import('vue').VNode[] | undefined} nodes
 * @returns {import('vue').VNode[] | null}
 */
export function resolveTextSlotMarkdown(nodes) {
  if (!nodes?.length)
    return null

  const source = collectMarkdownSource(nodes)

  if (source == null || !looksLikeMarkdown(source))
    return null

  const parsed = markdownToVnodes(source)

  return parsed.length ? parsed : null
}
