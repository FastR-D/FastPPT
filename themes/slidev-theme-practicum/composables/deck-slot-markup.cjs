const MarkdownIt = require('markdown-it')
const { parse } = require('vue/compiler-sfc')

/** @typedef {import('@vue/compiler-core').TemplateChildNode} TemplateChildNode */
/** @typedef {{ role: string, hasCoordinates: boolean, label: string }} ExplicitSlotIntent */
/**
 * @typedef {(
 *   | { kind: 'comment' }
 *   | { kind: 'text', content: string }
 *   | { kind: 'element', tag: string, props: Record<string, unknown>, children: DeckLiveNode[] }
 * )} DeckLiveNode
 */
/** @typedef {{ children: DeckLiveNode[], intents: ExplicitSlotIntent[] }} DeckLiveStructure */

const SLOT_CONTRACT_PROPS = new Set(['role', 'area', 'col', 'row'])
const SLOT_CONTROL_FLOW_DIRECTIVES = new Set(['if', 'else-if', 'else', 'for'])
const markdown = new MarkdownIt({ html: true })

/** @param {unknown} error */
function formatCompilerError(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * @param {import('@vue/compiler-core').DirectiveNode} prop
 * @returns {unknown}
 */
function readLiteralBinding(prop) {
  const ast = prop.exp?.ast
  if (!ast)
    return undefined

  if (ast.type === 'StringLiteral'
    || ast.type === 'NumericLiteral'
    || ast.type === 'BooleanLiteral') {
    return ast.value
  }

  if (ast.type === 'NullLiteral')
    return null

  if (ast.type === 'TemplateLiteral' && ast.expressions.length === 0)
    return ast.quasis[0]?.value?.cooked ?? ''

  return undefined
}

/** @param {string} directive */
function failSlotControlFlow(directive) {
  const error = /** @type {Error & { hint: string }} */ (
    new Error(
      `[DeckValidator] Slot не поддерживает v-${directive} `
      + 'на самом компоненте или его предке.',
    )
  )
  error.hint = 'Разверните конечное количество Slot явно, чтобы validator мог проверить role и capacity.'
  throw error
}

/** @param {import('@vue/compiler-core').ElementNode} node */
function controlFlowDirective(node) {
  return node.props.find(prop =>
    prop.type === 7
    && SLOT_CONTROL_FLOW_DIRECTIVES.has(prop.name),
  )?.name ?? ''
}

/** @param {TemplateChildNode} node */
function containsSlot(node) {
  if (node.type !== 1)
    return false

  return node.tag === 'Slot' || node.children.some(containsSlot)
}

/**
 * @param {import('@vue/compiler-core').ElementNode} node
 * @returns {Record<string, unknown>}
 */
function elementProps(node) {
  /** @type {Record<string, unknown>} */
  const props = {}

  for (const prop of node.props) {
    if (prop.type === 6) {
      props[prop.name] = prop.value?.content ?? ''
      continue
    }

    if (prop.name !== 'bind')
      continue

    const key = prop.arg?.type === 4 && prop.arg.isStatic
      ? prop.arg.content
      : ''

    if (node.tag !== 'Slot'
      || (!SLOT_CONTRACT_PROPS.has(key) && key !== 'label' && key)) {
      continue
    }

    if (!key) {
      throw new Error(
        '[DeckValidator] Slot не поддерживает динамический v-bind без статического имени prop.',
      )
    }

    const value = readLiteralBinding(prop)
    if (key === 'label' && value === undefined)
      continue

    if (value === undefined) {
      throw new Error(
        `[DeckValidator] Slot не поддерживает динамический v-bind:${key}; укажите литеральное значение.`,
      )
    }

    props[key] = value
  }

  return props
}

/**
 * @param {TemplateChildNode} node
 * @returns {DeckLiveNode | null}
 */
function liveNode(node) {
  if (node.type === 1) {
    const directive = controlFlowDirective(node)
    if (directive && containsSlot(node))
      failSlotControlFlow(directive)

    return {
      kind: 'element',
      tag: node.tag,
      props: elementProps(node),
      children: node.children
        .map(liveNode)
        .filter(isLiveNode),
    }
  }

  if (node.type === 2)
    return { kind: 'text', content: node.content }

  if (node.type === 3)
    return { kind: 'comment' }

  if (node.type === 5)
    return { kind: 'text', content: `{{ ${node.content.loc.source} }}` }

  return null
}

/**
 * @param {DeckLiveNode | null} node
 * @returns {node is DeckLiveNode}
 */
function isLiveNode(node) {
  return node !== null
}

/**
 * @param {DeckLiveNode} node
 * @returns {ExplicitSlotIntent[]}
 */
function collectSlotIntents(node) {
  const nested = node.kind === 'element'
    ? node.children.flatMap(collectSlotIntents)
    : []

  if (node.kind !== 'element' || node.tag !== 'Slot')
    return nested

  const role = String(node.props.role ?? '').trim()
  const label = String(node.props.label ?? '').trim()
  const hasCoordinates = ['area', 'col', 'row']
    .some(key => Boolean(String(node.props[key] ?? '').trim()))

  return [{ role, hasCoordinates, label }, ...nested]
}

/**
 * MarkdownIt оборачивает одиночные inline HTML components в `<p>`. Slidev
 * поднимает component-only параграф обратно в default slot, поэтому validator
 * нормализует ту же границу.
 *
 * @param {DeckLiveNode} node
 * @returns {DeckLiveNode[]}
 */
function normalizeTopLevelNode(node) {
  if (node.kind !== 'element' || node.tag !== 'p')
    return [node]

  const meaningful = node.children.filter(child =>
    child.kind !== 'comment'
    && !(child.kind === 'text' && !child.content.trim()),
  )

  if (meaningful.length > 0
    && meaningful.every(child => child.kind === 'element' && child.tag === 'Slot')) {
    return meaningful
  }

  return [node]
}

/**
 * Компилирует ровно ту top-level структуру, которую Slidev передаст layout-компоненту:
 * Markdown уже превращён в HTML, а live Vue-компоненты сохранены как элементы.
 *
 * @param {string} content
 * @returns {DeckLiveStructure}
 */
function extractDeckLiveStructure(content) {
  const rendered = markdown.render(String(content))
  const source = `<template>${rendered}</template>`
  const { descriptor, errors } = parse(source, { filename: 'deck-slide.vue' })

  if (errors.length) {
    throw new Error(
      `[DeckValidator] Не удалось разобрать live markup слайда: ${errors.map(formatCompilerError).join('; ')}`,
    )
  }

  const children = (descriptor.template?.ast?.children ?? [])
    .map(liveNode)
    .filter(isLiveNode)
    .flatMap(normalizeTopLevelNode)

  return {
    children,
    intents: children.flatMap(collectSlotIntents),
  }
}

/**
 * @param {string} content
 * @returns {ExplicitSlotIntent[]}
 */
function extractExplicitSlotIntents(content) {
  return extractDeckLiveStructure(content).intents
}

module.exports = {
  extractDeckLiveStructure,
  extractExplicitSlotIntents,
}
