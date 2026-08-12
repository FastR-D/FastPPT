import { Text as NativeText, cloneVNode, h, isVNode, withCtx, type Component, type VNode } from 'vue'
import { extractMarkdownHeading, extractMarkdownQuote, normalizeInlineText } from './layout-markdown.mjs'
import type { ThemeLayoutRole } from './layout-recipes'
import { isBlankTextVNode, isNamedComponentVNode, readVNodeProp, readVNodeTypeName } from './layout-vnode'
import type { ThemeTextSizeInput } from './text-fit-runtime'

export type LayoutShorthandComponents = {
  Image: Component
  Person: Component
  Slot: Component
  Text: Component
  Timeline: Component
}

export type LayoutShorthandContext = {
  variant: string
  readFrontmatterValue: (key: string) => unknown
  readFrontmatterText: (key: string) => string
  readFrontmatterArray: (key: string) => unknown[]
  readFrontmatterObject: (key: string) => Record<string, unknown> | null
  frontmatterDecor: Record<string, unknown> | null
  agendaDecor: Record<string, unknown> | null
  components: LayoutShorthandComponents
}

type LayoutShorthandBuilder = (children: VNode[], context: LayoutShorthandContext) => VNode[]

export type SlideMarkdownContractError = Error & {
  name: 'SlideMarkdownContractError'
  hint?: string
}

function failMarkdownContract(label: string, message: string, hint?: string): never {
  const error = new Error(`[Slide] ${label} ${message}`) as SlideMarkdownContractError
  error.name = 'SlideMarkdownContractError'
  if (hint)
    error.hint = hint
  throw error
}

function isHeadingNode(node: VNode) {
  return typeof node.type === 'string' && /^h[1-6]$/.test(node.type)
}

function isTextNode(node: VNode) {
  return node.type === NativeText
}

function isListNode(node: VNode) {
  return node.type === 'ul' || node.type === 'ol'
}

function isParagraphNode(node: VNode) {
  return node.type === 'p'
}

function isBlockquoteNode(node: VNode) {
  return node.type === 'blockquote'
}

function readTextNode(node: VNode) {
  return typeof node.children === 'string' ? node.children : ''
}

function readInlineText(node: VNode): string {
  if (node.type === NativeText)
    return normalizeInlineText(readTextNode(node))

  if (typeof node.children === 'string')
    return normalizeInlineText(node.children)

  if (Array.isArray(node.children))
    return normalizeInlineText(node.children.filter(isVNode).map(readInlineText).join(' '))

  return ''
}

function isBlankTextNode(node: VNode) {
  return isBlankTextVNode(node)
}

function ensureOnlySupportedChildren(label: string, children: VNode[], allow: (node: VNode) => boolean) {
  const unsupportedNodes = children.filter(node => !allow(node))
  if (!unsupportedNodes.length)
    return

  const unsupportedLabels = unsupportedNodes.map(readVNodeTypeName).join(', ')
  const suggestion = label === 'message:centered'
    ? 'Оставьте только один markdown-заголовок `# …`. Подзаголовок перенесите в заметки автора или объедините с заголовком.'
    : label === 'message:closing'
      ? 'Оставьте один markdown-заголовок `# …` и не более одного markdown-абзаца под ним.'
      : undefined

  failMarkdownContract(
    label,
    `поддерживает только каноническую markdown-структуру. Неподдерживаемые children: ${unsupportedLabels}.`,
    suggestion,
  )
}

function readHeadingText(children: VNode[], label: string) {
  const heading = children.find(isHeadingNode)
  if (heading)
    return { node: heading, text: readInlineText(heading) }

  const headingTextNode = children.find((node) => {
    if (!isTextNode(node))
      return false

    return extractMarkdownHeading(readTextNode(node)) != null
  })
  const parsedHeading = headingTextNode ? extractMarkdownHeading(readTextNode(headingTextNode)) : null

  if (parsedHeading)
    return { node: headingTextNode, text: parsedHeading.text }

  failMarkdownContract(label, 'ожидает один markdown heading внутри default slot.')
}

function readParagraphText(children: VNode[]) {
  const paragraph = children.find(isParagraphNode)
  if (paragraph)
    return { node: paragraph, text: readInlineText(paragraph) }

  return null
}

function hText(
  context: LayoutShorthandContext,
  as: string,
  size: ThemeTextSizeInput,
  content: string,
  options: {
    muted?: boolean
    maxSize?: boolean
    priority?: 1 | 2 | 3
    align?: 'start' | 'middle' | 'end'
    className?: string
    typography?: 'compact'
  } = {},
) {
  const textProps: {
    as: string
    size: ThemeTextSizeInput
    muted?: boolean
    maxSize?: boolean
    priority?: 1 | 2 | 3
    align?: 'start' | 'middle' | 'end'
    class?: string
  } & {
    'data-typography'?: 'compact'
  } = {
    as,
    size,
  }

  if (options.muted !== undefined)
    textProps.muted = options.muted
  if (options.maxSize !== undefined)
    textProps.maxSize = options.maxSize
  if (options.priority !== undefined)
    textProps.priority = options.priority
  if (options.align !== undefined)
    textProps.align = options.align
  if (options.className)
    textProps.class = options.className
  if (options.typography)
    textProps['data-typography'] = options.typography

  return h(context.components.Text, {
    ...textProps,
  }, {
    default: withCtx(() => [content]),
  })
}

function hSlot(
  context: LayoutShorthandContext,
  role: ThemeLayoutRole,
  label: string,
  slotProps: Record<string, unknown>,
  children: VNode[],
) {
  return h(context.components.Slot, {
    role,
    label,
    ...slotProps,
  }, {
    default: withCtx(() => children),
  })
}

function readRecordText(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = record[key]

    if (typeof value === 'string' && value.trim())
      return value.trim()

    if (typeof value === 'number')
      return String(value)
  }

  return ''
}

function readRecordInput(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = record[key]

    if (typeof value === 'string' && value.trim())
      return value.trim()

    if (typeof value === 'number')
      return value
  }

  return undefined
}

function readListItemText(li: VNode) {
  if (typeof li.children === 'string')
    return normalizeInlineText(li.children)

  if (!Array.isArray(li.children))
    return ''

  const parts: string[] = []

  for (const child of li.children) {
    if (!isVNode(child)) {
      const text = String(child ?? '').trim()
      if (text)
        parts.push(text)
      continue
    }

    if (child.type === 'ul' || child.type === 'ol')
      continue

    const text = readInlineText(child).trim()
    if (text)
      parts.push(text)
  }

  return normalizeInlineText(parts.join(' '))
}

function readListItems(list: VNode, label: string) {
  if (!Array.isArray(list.children))
    failMarkdownContract(label, 'ожидает list items с текстом.')

  return list.children
    .filter(isVNode)
    .filter(node => node.type === 'li')
    .map(readListItemText)
    .filter(Boolean)
}

function readListItemNodes(list: VNode, label: string) {
  if (!Array.isArray(list.children))
    failMarkdownContract(label, 'ожидает list items с текстом.')

  return list.children
    .filter(isVNode)
    .filter(node => node.type === 'li')
}

function hasListItemContent(li: VNode) {
  if (typeof li.children === 'string')
    return Boolean(normalizeInlineText(li.children))

  if (!Array.isArray(li.children))
    return false

  return li.children.some((child) => {
    if (!isVNode(child))
      return Boolean(String(child).trim())

    if (child.type === 'ul' || child.type === 'ol')
      return Array.isArray(child.children) && child.children.some(node => isVNode(node) && node.type === 'li')

    return Boolean(readInlineText(child))
  })
}

function readListItemContent(li: VNode): VNode[] {
  if (typeof li.children === 'string')
    return normalizeInlineText(li.children) ? [h('p', li.children)] : []

  if (!Array.isArray(li.children))
    return []

  return li.children.flatMap((child) => {
    if (!isVNode(child)) {
      const text = String(child).trim()
      return text ? [h('p', text)] : []
    }

    return [cloneVNode(child)]
  })
}

type NestedListItem = { value: string, label: string }

function readNestedListItems(list: VNode, label: string): NestedListItem[] {
  if (!Array.isArray(list.children))
    failMarkdownContract(label, 'ожидает list items с текстом.')

  return list.children
    .filter(isVNode)
    .filter(node => node.type === 'li')
    .map((li) => {
      if (!Array.isArray(li.children)) {
        const text = typeof li.children === 'string' ? normalizeInlineText(li.children) : ''
        return { value: text, label: '' }
      }

      const valueParts: string[] = []
      let nestedList: VNode | undefined

      for (const child of li.children) {
        if (!isVNode(child)) {
          const text = String(child ?? '').trim()
          if (text)
            valueParts.push(text)
          continue
        }

        if (child.type === 'ul' || child.type === 'ol') {
          nestedList = child
          continue
        }

        const text = readInlineText(child).trim()
        if (text)
          valueParts.push(text)
      }

      const value = normalizeInlineText(valueParts.join(' '))

      let label = ''
      if (nestedList && Array.isArray(nestedList.children)) {
        const firstNestedLi = nestedList.children
          .filter(isVNode)
          .find(node => node.type === 'li')

        if (firstNestedLi)
          label = readListItemText(firstNestedLi)
      }

      return { value, label }
    })
    .filter(item => item.value)
}

const FACTS_VARIANT_COUNTS: Record<string, number> = {
  'facts-duo': 2,
  'facts-trio': 3,
  'facts-quartet': 4,
  'facts-stacked': 3,
  'facts-featured': 3,
}

export function shouldUseExplicitRoleChildren(
  children: VNode[],
  shorthandKey: string,
  readRole: (node: VNode) => string,
) {
  const roles = children
    .map(readRole)
    .filter(Boolean)

  if (!roles.length)
    return false

  return shorthandKey !== 'collection:agenda' || roles.some(role => role !== 'media')
}

function buildAgendaChildren(children: VNode[], context: LayoutShorthandContext) {
  const title = children.find(isHeadingNode)
  const headingTextNode = title
    ? null
    : children.find((node) => {
        if (!isTextNode(node))
          return false

        return extractMarkdownHeading(readTextNode(node)) != null
      })
  const list = children.find(isListNode)
  const mediaOverrides = children.filter(node => contextReadRole(context, node) === 'media')

  const parsedHeading = headingTextNode ? extractMarkdownHeading(readTextNode(headingTextNode)) : null
  const renderedTitle = title ?? (parsedHeading ? h(`h${parsedHeading.level}`, parsedHeading.text) : null)

  if (!renderedTitle)
    failMarkdownContract('collection:agenda', 'ожидает один markdown heading внутри default slot.')

  if (!list)
    failMarkdownContract('collection:agenda', 'ожидает один markdown list (`*`, `-` или `1.`) внутри default slot.')

  if (mediaOverrides.length > 1)
    failMarkdownContract('collection:agenda', 'поддерживает не больше одного override для `role="media"`.')

  const mediaOverride = mediaOverrides[0]

  ensureOnlySupportedChildren('collection:agenda', children, node =>
    node === title
    || node === headingTextNode
    || node === list
    || node === mediaOverride
    || isBlankTextNode(node),
  )

  return [
    h(context.components.Slot, {
      role: 'primary',
      label: `slide-collection-${context.variant}-primary`,
    }, {
      default: withCtx(() => [
        h('div', { class: 'Slide-AgendaContent' }, [
          isVNode(renderedTitle)
            ? cloneVNode(renderedTitle, { class: 'Slide-AgendaTitle' })
            : renderedTitle,
          cloneVNode(list, { class: 'Slide-AgendaList' }),
        ]),
      ]),
    }),
    mediaOverride ?? h(context.components.Slot, {
      role: 'media',
      label: `slide-collection-${context.variant}-media`,
      decor: context.agendaDecor,
    }),
  ]
}

function contextReadRole(context: LayoutShorthandContext, node: VNode) {
  if (!isNamedComponentVNode(node, 'Slot', context.components.Slot))
    return ''

  const role = readVNodeProp<string>(node, 'role')
  return typeof role === 'string' ? role.trim() : ''
}

function normalizeQuotePersonProps(context: LayoutShorthandContext) {
  const person = context.readFrontmatterObject('person')
  if (!person)
    failMarkdownContract('message:quote', 'ожидает frontmatter person.')

  const name = readRecordText(person, ['name'])
  if (!name)
    failMarkdownContract('message:quote', 'ожидает person.name во frontmatter.')

  const personProps: Record<string, string | number> = { name }
  const textProps = [
    ['title', ['title']],
    ['avatar', ['avatar']],
    ['avatarFit', ['avatarFit', 'avatar-fit']],
    ['avatarPosition', ['avatarPosition', 'avatar-position']],
    ['avatarAnchor', ['avatarAnchor', 'avatar-anchor']],
  ] as const

  for (const [prop, keys] of textProps) {
    const value = readRecordText(person, keys)
    if (value)
      personProps[prop] = value
  }

  const numericInputProps = [
    ['avatarX', ['avatarX', 'avatar-x']],
    ['avatarY', ['avatarY', 'avatar-y']],
    ['avatarZoom', ['avatarZoom', 'avatar-zoom']],
  ] as const

  for (const [prop, keys] of numericInputProps) {
    const value = readRecordInput(person, keys)
    if (value !== undefined)
      personProps[prop] = value
  }

  return personProps
}

function buildQuoteChildren(children: VNode[], context: LayoutShorthandContext) {
  const quote = children.find(isBlockquoteNode)
  const quoteTextNode = quote
    ? null
    : children.find((node) => {
        if (!isTextNode(node))
          return false

        return extractMarkdownQuote(readTextNode(node)) != null
      })
  const personProps = normalizeQuotePersonProps(context)

  const parsedQuote = quoteTextNode ? extractMarkdownQuote(readTextNode(quoteTextNode)) : null
  const renderedQuote = quote ?? (parsedQuote
    ? h('blockquote', [h('p', parsedQuote)])
    : null)

  if (!renderedQuote)
    failMarkdownContract('message:quote', 'ожидает один blockquote (`> ...`) внутри default slot.')

  ensureOnlySupportedChildren('message:quote', children, node =>
    node === quote
    || node === quoteTextNode
    || isBlankTextNode(node),
  )

  return [
    h(context.components.Slot, {
      role: 'primary',
      label: `slide-message-${context.variant}-primary`,
    }, {
      default: withCtx(() => [
        isVNode(renderedQuote)
          ? cloneVNode(renderedQuote, { class: 'Slide-Quote' })
          : renderedQuote,
      ]),
    }),
    h(context.components.Slot, {
      role: 'support',
      label: `slide-message-${context.variant}-support`,
    }, {
      default: withCtx(() => [
        h(context.components.Person, {
          ...personProps,
          align: 'end',
        }),
      ]),
    }),
  ]
}

function buildCenteredChildren(children: VNode[], context: LayoutShorthandContext) {
  const title = readHeadingText(children, 'message:centered')

  ensureOnlySupportedChildren('message:centered', children, node =>
    node === title.node
    || isBlankTextNode(node),
  )

  return [
    hSlot(context, 'primary', 'slide-message-centered-primary', { centered: true }, [
      hText(context, 'h1', '7', title.text, { align: 'middle' }),
    ]),
  ]
}

function buildClosingChildren(children: VNode[], context: LayoutShorthandContext) {
  const title = readHeadingText(children, 'message:closing')
  const paragraph = readParagraphText(children)

  ensureOnlySupportedChildren('message:closing', children, node =>
    node === title.node
    || node === paragraph?.node
    || isBlankTextNode(node),
  )

  return [
    hSlot(context, 'primary', 'slide-message-closing-primary', { centered: true }, [
      hText(context, 'h1', '7', title.text, { align: 'middle' }),
      ...(paragraph
        ? [hText(context, 'p', '3', paragraph.text, { muted: true })]
        : []),
    ]),
  ]
}

function buildDefinitionChildren(children: VNode[], context: LayoutShorthandContext) {
  const title = readHeadingText(children, 'explainer:definition')
  const paragraph = readParagraphText(children)
  const body = context.readFrontmatterText('body') || paragraph?.text || ''
  const label = context.readFrontmatterText('label')

  if (!body)
    failMarkdownContract('explainer:definition', 'ожидает markdown paragraph или frontmatter body.')

  ensureOnlySupportedChildren('explainer:definition', children, node =>
    node === title.node
    || node === paragraph?.node
    || isBlankTextNode(node),
  )

  return [
    hSlot(context, 'primary', 'slide-explainer-definition-primary', {}, [
      ...(label ? [hText(context, 'div', '3', label, { muted: true, className: 'Slide-DefinitionLabel' })] : []),
      hText(context, 'h1', '6', title.text, { priority: 1 }),
      hText(context, 'div', '6', body, { muted: true, priority: 1 }),
    ]),
  ]
}

function isRichTextBodyNode(node: VNode) {
  return isParagraphNode(node) || isListNode(node) || isBlockquoteNode(node)
}

function buildTitleRichSideChildren(
  children: VNode[],
  context: LayoutShorthandContext,
  contract: 'explainer:title-body' | 'explainer:title-supports',
  options: { muted?: boolean } = {},
) {
  const title = readHeadingText(children, contract)
  const bodyNodes = children.filter(node =>
    node !== title.node
    && !isBlankTextNode(node),
  )

  if (!bodyNodes.length)
    failMarkdownContract(contract, 'ожидает markdown paragraph, list или blockquote под heading.')

  ensureOnlySupportedChildren(contract, children, node =>
    node === title.node
    || isRichTextBodyNode(node)
    || isBlankTextNode(node),
  )

  const slotPrefix = contract === 'explainer:title-body' ? 'title-body' : 'title-supports'
  const bodyClass = options.muted ? 'Slide-TitleBody Slide-TitleBody_muted' : 'Slide-TitleBody'

  return [
    hSlot(context, 'primary', `slide-explainer-${slotPrefix}-primary`, {}, [
      hText(context, 'h1', '6', title.text),
    ]),
    hSlot(context, 'secondary', `slide-explainer-${slotPrefix}-secondary`, {}, [
      h('div', { class: bodyClass }, bodyNodes.map(node => cloneVNode(node))),
    ]),
  ]
}

function buildTitleSupportsChildren(
  children: VNode[],
  context: LayoutShorthandContext,
  options: { placement?: 'side' | 'bottom', muted?: boolean, supportSize?: ThemeTextSizeInput } = {},
) {
  const placement = options.placement ?? 'side'

  if (placement === 'side')
    return buildTitleRichSideChildren(children, context, 'explainer:title-supports', { muted: true })

  const title = readHeadingText(children, 'explainer:title-supports')
  const list = children.find(isListNode)
  const muted = options.muted ?? true
  const supportSize = options.supportSize ?? '4'

  if (!list)
    failMarkdownContract('explainer:title-supports', 'ожидает ненумерованный markdown list под heading.')

  if (list.type !== 'ul')
    failMarkdownContract('explainer:title-supports', 'ожидает ненумерованный markdown list (`-` или `*`).')

  const items = readListItemNodes(list, 'explainer:title-supports')
  if (!items.length || !items.every(hasListItemContent))
    failMarkdownContract('explainer:title-supports', 'ожидает list items с текстом.')

  if (items.length !== 2) {
    failMarkdownContract(
      'explainer:title-supports',
      'ожидает ровно два list items для нижнего 50/50 layout.',
      'Нужны ровно 2 пункта `-` верхнего уровня под заголовком. Сожмите список или смените variant на title-supports / title-body.',
    )
  }

  ensureOnlySupportedChildren('explainer:title-supports', children, node =>
    node === title.node
    || node === list
    || isBlankTextNode(node),
  )

  const bodyClass = muted ? 'Slide-TitleBody Slide-TitleBody_muted' : 'Slide-TitleBody'

  return [
    hSlot(context, 'primary', 'slide-explainer-title-supports-bottom-primary', {}, [
      hText(context, 'h1', '6', title.text),
    ]),
    ...items.map((item, index) =>
      hSlot(context, 'support', `slide-explainer-title-supports-bottom-support-${index + 1}`, {}, [
        h(context.components.Text, {
          as: 'div',
          size: supportSize,
          muted,
        }, {
          default: withCtx(() => [
            h('div', { class: bodyClass }, readListItemContent(item)),
          ]),
        }),
      ]),
    ),
  ]
}

function buildTitleBodyChildren(children: VNode[], context: LayoutShorthandContext) {
  return buildTitleRichSideChildren(children, context, 'explainer:title-body')
}

function buildPointsChildren(children: VNode[], context: LayoutShorthandContext) {
  const title = readHeadingText(children, 'collection:points')
  const list = children.find(isListNode)

  if (!list)
    failMarkdownContract('collection:points', 'ожидает markdown list с тремя пунктами.')

  const items = readListItems(list, 'collection:points')
  if (items.length !== 3)
    failMarkdownContract('collection:points', 'ожидает ровно три пункта для arrangement: trio.')

  ensureOnlySupportedChildren('collection:points', children, node =>
    node === title.node
    || node === list
    || isBlankTextNode(node),
  )

  return [
    hSlot(context, 'primary', 'slide-collection-points-primary', {
      ...(context.frontmatterDecor ? { decor: context.frontmatterDecor } : {}),
    }, [
      hText(context, 'h1', '7', title.text, { className: 'Slide-PointsTitle' }),
    ]),
    ...items.map((item, index) =>
      hSlot(context, 'support', `slide-collection-points-support-${index + 1}`, {}, [
        hText(context, 'div', '4', String(index + 1)),
        hText(context, 'div', '5', item, { align: 'end' }),
      ]),
    ),
  ]
}

function normalizeTimelineItems(context: LayoutShorthandContext) {
  const items = context.readFrontmatterArray('items')

  if (!items.length)
    failMarkdownContract('collection:timeline', 'ожидает frontmatter items.')

  return items.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      failMarkdownContract('collection:timeline', `ожидает object item в items[${index}].`)

    const record = item as Record<string, unknown>
    const year = readRecordText(record, ['year', 'label'])
    const label = readRecordText(record, ['body', 'label', 'title'])

    if (!year || !label)
      failMarkdownContract('collection:timeline', `ожидает year и body/label в items[${index}].`)

    return {
      year,
      label,
      active: record.active === true,
    }
  })
}

function buildTimelineChildren(children: VNode[], context: LayoutShorthandContext) {
  const title = readHeadingText(children, 'collection:timeline')
  const paragraph = readParagraphText(children)
  const body = context.readFrontmatterText('body') || paragraph?.text || ''

  ensureOnlySupportedChildren('collection:timeline', children, node =>
    node === title.node
    || node === paragraph?.node
    || isBlankTextNode(node),
  )

  return [
    hSlot(context, 'primary', 'slide-collection-timeline-primary', {}, [
      hText(context, 'h1', '6', title.text),
    ]),
    ...(body
      ? [
          hSlot(context, 'secondary', 'slide-collection-timeline-secondary', {}, [
            hText(context, 'div', '3', body, { muted: true }),
          ]),
        ]
      : []),
    hSlot(context, 'support', 'slide-collection-timeline-support', {}, [
      h(context.components.Timeline, { items: normalizeTimelineItems(context) }),
    ]),
  ]
}

function normalizeMetricItems(context: LayoutShorthandContext) {
  const items = context.readFrontmatterArray('metrics')

  if (items.length < 3)
    failMarkdownContract('collection:metrics', 'ожидает минимум три элемента во frontmatter metrics.')

  return items.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      failMarkdownContract('collection:metrics', `ожидает object item в metrics[${index}].`)

    const record = item as Record<string, unknown>
    const value = readRecordText(record, ['value'])
    const label = readRecordText(record, ['body', 'label', 'title'])

    if (!value || !label)
      failMarkdownContract('collection:metrics', `ожидает value и body/label в metrics[${index}].`)

    return {
      value,
      label,
      featured: record.featured === true,
    }
  })
}

function normalizeMetricItemsFromList(list: VNode) {
  const entries = readNestedListItems(list, 'collection:metrics')

  if (entries.length < 3)
    failMarkdownContract('collection:metrics', 'ожидает минимум три пункта в markdown-списке.')

  return entries.map((entry, index) => {
    if (!entry.label)
      failMarkdownContract('collection:metrics', `ожидает вложенный пункт с подписью у metric[${index}].`)

    return {
      value: entry.value,
      label: entry.label,
      featured: index === 0,
    }
  })
}

function normalizeMediaItems(context: LayoutShorthandContext) {
  const value = context.readFrontmatterValue('media')

  if (typeof value === 'object' && value !== null && !Array.isArray(value))
    return [value as Record<string, unknown>]

  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item))
        failMarkdownContract('collection:metrics', `ожидает object item в media[${index}].`)

      return item as Record<string, unknown>
    })
  }

  return []
}

function buildMetricsChildren(children: VNode[], context: LayoutShorthandContext) {
  const list = children.find(isListNode)

  ensureOnlySupportedChildren('collection:metrics', children, node =>
    node === list
    || isBlankTextNode(node),
  )

  const isFeaturedCopy = context.variant === 'metrics-featured-copy' || context.variant === 'metrics-featured-copy-split-media'
  const isSplitMedia = context.variant === 'metrics-featured-copy-split-media'
  const mediaItems = normalizeMediaItems(context)

  if (!mediaItems.length)
    failMarkdownContract('collection:metrics', 'ожидает frontmatter media.')

  if (isSplitMedia && mediaItems.length < 2)
    failMarkdownContract('collection:metrics', 'ожидает два frontmatter media item для arrangement: featured-copy-split-media.')

  const metrics = list
    ? normalizeMetricItemsFromList(list)
    : normalizeMetricItems(context)
  const featuredIndex = metrics.findIndex(metric => metric.featured)
  const featured = metrics[featuredIndex >= 0 ? featuredIndex : 0]
  const supportMetrics = metrics.filter(metric => metric !== featured).slice(0, 2)
  const supportMetricsFitGroup = `collection-${context.variant}-support-metrics`

  if (supportMetrics.length < 2)
    failMarkdownContract('collection:metrics', 'ожидает два вторичных metric item.')

  const primaryChildren = isFeaturedCopy
    ? [
        h('div', { class: 'Slide-MetricsFeaturedCopy' }, [
          h('div', { class: 'Slide-MetricsFeaturedCopyValue' }, [
            hText(context, 'div', '7-12', featured.value, { priority: 1, align: 'middle' }),
          ]),
          h('div', { class: 'Slide-MetricsFeaturedCopyLabel' }, [
            hText(context, 'div', '5-7', featured.label, { priority: 1, align: 'middle', muted: true }),
          ]),
        ]),
      ]
    : [
        hText(context, 'div', '7-12', featured.value, { priority: 1, className: 'Slide-MetricsFeaturedText' }),
        hText(context, 'div', '2-7', featured.label, { priority: 2, muted: true, className: 'Slide-MetricsFeaturedText' }),
      ]
  const mediaCount = isSplitMedia ? 2 : 1

  return [
    hSlot(context, 'primary', 'slide-collection-metrics-primary', {
      ...(!isFeaturedCopy && context.frontmatterDecor ? { decor: context.frontmatterDecor } : {}),
      gap: '3',
    }, primaryChildren),
    ...mediaItems.slice(0, mediaCount).map((media, index) =>
      hSlot(context, 'media', index === 0 ? 'slide-collection-metrics-media' : `slide-collection-metrics-media-${index + 1}`, {}, [
        h(context.components.Image, media),
      ]),
    ),
    ...supportMetrics.map((metric, index) =>
      hSlot(context, 'support', `slide-collection-metrics-support-${index + 1}`, {
        fitGroup: supportMetricsFitGroup,
        gap: '2',
      }, [
        hText(context, 'div', '7', metric.value, { priority: 1 }),
        hText(context, 'div', '2-6', metric.label, { priority: 2, muted: true, typography: 'compact' }),
      ]),
    ),
  ]
}

function buildFactsChildren(children: VNode[], context: LayoutShorthandContext) {
  const heading = children.find(isHeadingNode)
  const list = children.find(isListNode)
  const paragraphs = children.filter(isParagraphNode)

  if (!heading)
    failMarkdownContract('collection:facts', 'ожидает один markdown heading внутри default slot.')

  if (!list)
    failMarkdownContract('collection:facts', 'ожидает один markdown список с фактами внутри default slot.')

  const headingIndex = children.indexOf(heading)
  const listIndex = children.indexOf(list)
  const description = paragraphs.find((node) => {
    const index = children.indexOf(node)
    return index > headingIndex && index < listIndex
  })
  const footnote = paragraphs.find((node) => {
    const index = children.indexOf(node)
    return index > listIndex
  })

  ensureOnlySupportedChildren('collection:facts', children, node =>
    node === heading
    || node === list
    || node === description
    || node === footnote
    || isBlankTextNode(node),
  )

  const facts = readNestedListItems(list, 'collection:facts')
  const expectedFactCount = FACTS_VARIANT_COUNTS[context.variant] ?? 3

  if (facts.length !== expectedFactCount) {
    failMarkdownContract(
      'collection:facts',
      `${context.variant} ожидает ровно ${expectedFactCount} факта в markdown-списке.`,
      `Для ${context.variant} нужно ровно ${expectedFactCount} пункта верхнего уровня, у каждого — вложенная подпись.`,
    )
  }

  facts.forEach((fact, index) => {
    if (!fact.label) {
      failMarkdownContract(
        'collection:facts',
        `ожидает вложенный пункт с подписью у facts[${index}].`,
        'Каждый факт: `- значение` и на следующей строке `  - подпись`. Не пишите `- роль: текст` одной строкой.',
      )
    }
  })

  const [featured, ...supportFacts] = facts
  const isFeatured = context.variant === 'facts-featured'
  const isStacked = context.variant === 'facts-stacked'
  const isDuo = context.variant === 'facts-duo'
  const isQuartet = context.variant === 'facts-quartet'
  const shouldCoordinateFactSizes = isStacked || isDuo || context.variant === 'facts-trio' || isQuartet
  const factFitGroup = shouldCoordinateFactSizes ? `collection-${context.variant}-facts` : ''
  const supportFactFitGroup = isFeatured ? `collection-${context.variant}-support-facts` : factFitGroup
  const headingText = readInlineText(heading)
  const descriptionText = description ? readInlineText(description) : ''
  const footnoteText = footnote ? readInlineText(footnote) : ''
  const rowFactSize: ThemeTextSizeInput = isQuartet ? '5-8' : isDuo ? '5-10' : '5-9'
  const stackedFactSize: ThemeTextSizeInput = '5-9'
  const stackedLabelSize: ThemeTextSizeInput = '3-5'
  const rowLabelSize: ThemeTextSizeInput = '2-4'
  const featuredFactSize: ThemeTextSizeInput = isFeatured ? '9-12' : isStacked ? stackedFactSize : rowFactSize
  const supportFactSize: ThemeTextSizeInput = isFeatured ? '5-7' : isStacked ? stackedFactSize : rowFactSize
  const featuredLabelSize: ThemeTextSizeInput = isFeatured ? '4-6' : isStacked ? stackedLabelSize : rowLabelSize
  const supportLabelSize: ThemeTextSizeInput = isFeatured ? '2-4' : isStacked ? stackedLabelSize : rowLabelSize

  const primaryChildren: VNode[] = [
    hText(context, 'h2', isFeatured ? '5-7' : '6-8', headingText, { priority: 1 }),
  ]

  if (descriptionText)
    primaryChildren.push(hText(context, 'p', isStacked ? '4-5' : '3-4', descriptionText, { priority: 2, muted: true }))

  if (footnoteText && factFitGroup)
    primaryChildren.push(hText(context, 'div', '2-3', footnoteText, { priority: 3, muted: true }))

  const featuredChildren: VNode[] = [
    hText(context, 'div', featuredFactSize, featured.value, { priority: 1 }),
    hText(context, 'div', featuredLabelSize, featured.label, { priority: 2, muted: true }),
  ]

  if (footnoteText && !factFitGroup)
    featuredChildren.push(hText(context, 'div', '2-3', footnoteText, { priority: 3, muted: true }))

  return [
    hSlot(context, 'primary', `slide-collection-${context.variant}-primary`, { gap: '3' }, primaryChildren),
    hSlot(context, 'support', `slide-collection-${context.variant}-support-1`, {
      gap: '2',
      centered: false,
      ...(factFitGroup ? { fitGroup: factFitGroup } : {}),
    }, featuredChildren),
    ...supportFacts.map((fact, index) =>
      hSlot(context, 'support', `slide-collection-${context.variant}-support-${index + 2}`, {
        gap: '2',
        ...(supportFactFitGroup ? { fitGroup: supportFactFitGroup } : {}),
      }, [
        hText(context, 'div', supportFactSize, fact.value, { priority: 1 }),
        hText(context, 'div', supportLabelSize, fact.label, { priority: 2, muted: true }),
      ]),
    ),
  ]
}

const LAYOUT_SHORTHANDS = {
  'collection:agenda': buildAgendaChildren,
  'collection:facts-stacked': buildFactsChildren,
  'collection:facts-duo': buildFactsChildren,
  'collection:facts-trio': buildFactsChildren,
  'collection:facts-quartet': buildFactsChildren,
  'collection:facts-featured': buildFactsChildren,
  'collection:points-trio': buildPointsChildren,
  'collection:timeline': buildTimelineChildren,
  'collection:metrics-featured-media': buildMetricsChildren,
  'collection:metrics-featured-copy': buildMetricsChildren,
  'collection:metrics-featured-copy-split-media': buildMetricsChildren,
  'message:centered': buildCenteredChildren,
  'message:quote': buildQuoteChildren,
  'message:closing': buildClosingChildren,
  'explainer:definition': buildDefinitionChildren,
  'explainer:title-supports': buildTitleSupportsChildren,
  'explainer:title-supports-bottom-muted': (children: VNode[], context: LayoutShorthandContext) =>
    buildTitleSupportsChildren(children, context, { placement: 'bottom', muted: true, supportSize: '5' }),
  'explainer:title-supports-bottom-plain': (children: VNode[], context: LayoutShorthandContext) =>
    buildTitleSupportsChildren(children, context, { placement: 'bottom', muted: false, supportSize: '3' }),
  'explainer:title-body': buildTitleBodyChildren,
} satisfies Record<string, LayoutShorthandBuilder>

type LayoutShorthandKey = keyof typeof LAYOUT_SHORTHANDS

function isLayoutShorthandKey(key: string): key is LayoutShorthandKey {
  return key in LAYOUT_SHORTHANDS
}

export function hasLayoutShorthand(key: string) {
  return isLayoutShorthandKey(key)
}

export function buildLayoutShorthandChildren(
  key: string,
  children: VNode[],
  context: LayoutShorthandContext,
) {
  return isLayoutShorthandKey(key)
    ? LAYOUT_SHORTHANDS[key](children, context)
    : null
}
