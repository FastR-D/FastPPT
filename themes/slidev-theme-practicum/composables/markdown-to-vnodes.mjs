import MarkdownIt from 'markdown-it'
import { h } from 'vue'
import { dedentMarkdownSource } from './layout-markdown.mjs'

/** @typedef {import('markdown-it/lib/token.mjs').default} MarkdownToken */
/** @typedef {import('vue').VNode} VNode */
/** @typedef {Extract<import('vue').VNodeChild, VNode | string>} InlineVNodeChild */

const md = new MarkdownIt({ html: false, linkify: false })

/** @type {Partial<Record<string, readonly [string, string]>>} */
const INLINE_TAGS = {
  strong_open: ['strong_close', 'strong'],
  em_open: ['em_close', 'em'],
  s_open: ['s_close', 's'],
  link_open: ['link_close', 'a'],
}

/**
 * @param {MarkdownToken[]} [tokens]
 * @param {number} [start]
 * @param {string} [closeType]
 * @returns {[InlineVNodeChild[], number]}
 */
function renderInlineTokens(tokens = [], start = 0, closeType = '') {
  /** @type {InlineVNodeChild[]} */
  const children = []
  let index = start

  while (index < tokens.length) {
    const token = tokens[index]
    if (closeType && token.type === closeType)
      return [children, index + 1]

    if (token.type === 'text' || token.type === 'code_inline') {
      children.push(token.type === 'code_inline' ? h('code', token.content) : token.content)
      index += 1
      continue
    }

    if (token.type === 'softbreak' || token.type === 'hardbreak') {
      children.push(token.type === 'hardbreak' ? h('br') : ' ')
      index += 1
      continue
    }

    const entry = INLINE_TAGS[token.type]
    if (entry) {
      const [nested, next] = renderInlineTokens(tokens, index + 1, entry[0])
      const props = token.type === 'link_open'
        ? Object.fromEntries((token.attrs ?? []).filter(([key]) => key === 'href' || key === 'title'))
        : null
      children.push(h(entry[1], props, nested))
      index = next
      continue
    }

    index += 1
  }

  return [children, index]
}

/**
 * @param {MarkdownToken[]} tokens
 * @param {number} index
 * @returns {InlineVNodeChild[]}
 */
function inlineChildren(tokens, index) {
  const token = tokens[index]
  if (!token || token.type !== 'inline')
    return []

  return renderInlineTokens(/** @type {MarkdownToken[]} */ (token.children))[0]
}

/**
 * @param {InlineVNodeChild[]} children
 * @returns {InlineVNodeChild | InlineVNodeChild[]}
 */
function inlineBlockContent(children) {
  return children.length === 1 ? children[0] : children
}

/**
 * @param {MarkdownToken[]} tokens
 * @param {number} start
 * @returns {[VNode, number]}
 */
function parseListItem(tokens, start) {
  /** @type {InlineVNodeChild[]} */
  const childNodes = []
  let index = start + 1

  while (index < tokens.length) {
    const token = tokens[index]

    if (token.type === 'list_item_close')
      return [h('li', childNodes), index + 1]

    if (token.type === 'paragraph_open') {
      const children = inlineChildren(tokens, index + 1)
      if (children.length)
        childNodes.push(...children)
      index += 3
      continue
    }

    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const nestedTag = token.type === 'bullet_list_open' ? 'ul' : 'ol'
      const [nested, next] = parseList(tokens, index, nestedTag)
      childNodes.push(nested)
      index = next
      continue
    }

    index += 1
  }

  return [h('li', childNodes), index]
}

/**
 * @param {'ul' | 'ol'} tag
 * @returns {'bullet_list_close' | 'ordered_list_close'}
 */
function listCloseType(tag) {
  return tag === 'ol' ? 'ordered_list_close' : 'bullet_list_close'
}

/**
 * @param {MarkdownToken[]} tokens
 * @param {number} start
 * @param {'ul' | 'ol'} tag
 * @returns {[VNode, number]}
 */
function parseList(tokens, start, tag) {
  /** @type {VNode[]} */
  const items = []
  let index = start + 1
  const closeType = listCloseType(tag)

  while (index < tokens.length) {
    const token = tokens[index]

    if (token.type === closeType)
      return [h(tag, items), index + 1]

    if (token.type === 'list_item_open') {
      const [item, next] = parseListItem(tokens, index)
      items.push(item)
      index = next
      continue
    }

    index += 1
  }

  return [h(tag, items), index]
}

/**
 * @param {MarkdownToken[]} tokens
 * @param {number} start
 * @returns {[VNode, number]}
 */
function parseBlockquote(tokens, start) {
  /** @type {VNode[]} */
  const children = []
  let index = start + 1

  while (index < tokens.length && tokens[index].type !== 'blockquote_close') {
    const token = tokens[index]

    if (token.type === 'paragraph_open') {
      const inline = inlineChildren(tokens, index + 1)
      if (inline.length)
        children.push(h('p', inlineBlockContent(inline)))
      index += 3
      continue
    }

    index += 1
  }

  return [h('blockquote', children), index + 1]
}

/**
 * @param {unknown} [source]
 * @returns {VNode[]}
 */
export function markdownToVnodes(source = '') {
  const tokens = md.parse(dedentMarkdownSource(String(source ?? '')), {})
  /** @type {VNode[]} */
  const children = []
  let index = 0

  while (index < tokens.length) {
    const token = tokens[index]

    if (token.type === 'heading_open') {
      const inline = inlineChildren(tokens, index + 1)
      if (inline.length)
        children.push(h(token.tag, inlineBlockContent(inline)))
      index += 3
      continue
    }

    if (token.type === 'paragraph_open') {
      const inline = inlineChildren(tokens, index + 1)
      if (inline.length)
        children.push(h('p', inlineBlockContent(inline)))
      index += 3
      continue
    }

    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const tag = token.type === 'bullet_list_open' ? 'ul' : 'ol'
      const [list, next] = parseList(tokens, index, tag)
      children.push(list)
      index = next
      continue
    }

    if (token.type === 'blockquote_open') {
      const [quote, next] = parseBlockquote(tokens, index)
      children.push(quote)
      index = next
      continue
    }

    index += 1
  }

  return children
}
