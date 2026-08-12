import { Fragment, Text as NativeText, isVNode, type VNode } from 'vue'
import { resolveAgendaDecor } from './decor-config.mjs'
import {
  buildLayoutShorthandChildren,
  hasLayoutShorthand,
  shouldUseExplicitRoleChildren,
  type LayoutShorthandComponents,
  type LayoutShorthandContext,
} from './layout-shorthands'
import {
  resolveLayoutSpec,
  resolveLayoutVariant,
  resolveLayoutRecipe,
  resolveLayoutSlotProps,
  THEME_LAYOUT_ROLES,
  type ThemeLayout,
  type ThemeLayoutHeader,
  type ThemeLayoutRole,
  type ThemeLayoutRecipe,
  type ThemeLayoutSpec,
  type ThemeLayoutSlotSpec,
} from './layout-recipes'
import { isBlankTextVNode, isCommentVNode } from './layout-vnode'
import { createSlotRules, type SlotRules } from './slot-rules'
import {
  isContrastSlideMode,
  resolveSlideMode,
  resolveThemeMode,
  type ResolvedThemeMode,
  type ThemeSlideMode,
  type ThemeTone,
} from './theme-foundation'

export type SlideLayoutProps = {
  layout?: ThemeLayout | ''
  variant?: string
  arrangement?: string
  mode?: ThemeSlideMode
  tone?: ThemeTone | ''
  header?: ThemeLayoutHeader
}

export type LayoutAuthoringInput = {
  props: SlideLayoutProps
  frontmatter: Record<string, unknown>
  children?: readonly VNode[]
  components: LayoutShorthandComponents
  defaultTone: ThemeTone
  debugGrid?: boolean
  slotPlanState?: LayoutSlotPlanState
}

export type LayoutSlotPlanState = Map<string, { role: ThemeLayoutRole, index: number }>

export type ResolvedLayoutSlot = ThemeLayoutSlotSpec & {
  role: ThemeLayoutRole
  index: number
}

export type LayoutSlotPlan = {
  recipe: ThemeLayoutRecipe
  resolveRoleSlot(input: {
    id: string
    role: ThemeLayoutRole
    overrides: Partial<ThemeLayoutSlotSpec>
    label: string
  }): ResolvedLayoutSlot
  unregisterRoleSlot(id: string): void
}

export type CompiledLayoutAuthoring = {
  mode: 'manual' | 'layout'
  layout: ThemeLayout | ''
  variant: string
  header: Exclude<ThemeLayoutHeader, 'auto'>
  slideMode: ThemeSlideMode
  theme: ResolvedThemeMode
  contrast: boolean
  showDebugGrid: boolean
  children: VNode[]
  slotPlan: LayoutSlotPlan | null
}

const THEME_LAYOUTS = new Set<ThemeLayout>(['cover', 'message', 'explainer', 'collection'])

export function createLayoutSlotPlanState(): LayoutSlotPlanState {
  return new Map()
}

function readFrontmatterValue(frontmatter: Record<string, unknown>, key: string) {
  return frontmatter[key]
}

function readFrontmatterString(frontmatter: Record<string, unknown>, key: string) {
  const value = readFrontmatterValue(frontmatter, key)
  return typeof value === 'string' ? value.trim() : ''
}

function readFrontmatterText(frontmatter: Record<string, unknown>, key: string) {
  const value = readFrontmatterValue(frontmatter, key)

  if (typeof value === 'string')
    return value.trim()

  if (typeof value === 'number')
    return String(value)

  return ''
}

function readFrontmatterBoolean(frontmatter: Record<string, unknown>, key: string) {
  const value = readFrontmatterValue(frontmatter, key)
  if (typeof value === 'boolean')
    return value

  return undefined
}

function readFrontmatterArray(frontmatter: Record<string, unknown>, key: string) {
  const value = readFrontmatterValue(frontmatter, key)
  return Array.isArray(value) ? value : []
}

function readFrontmatterObject(frontmatter: Record<string, unknown>, key: string) {
  const value = readFrontmatterValue(frontmatter, key)

  if (typeof value === 'object' && value !== null && !Array.isArray(value))
    return value as Record<string, unknown>

  return null
}

function readHeader(value: unknown): ThemeLayoutHeader | undefined {
  if (typeof value !== 'string')
    return undefined

  const normalized = value.trim()
  if (normalized === 'auto' || normalized === 'default' || normalized === 'cover' || normalized === 'none')
    return normalized

  return undefined
}

function isThemeLayout(value: string): value is ThemeLayout {
  return THEME_LAYOUTS.has(value as ThemeLayout)
}

function failMarkdownContract(label: string, message: string): never {
  throw new Error(`[Slide] ${label} ${message}`)
}

function flattenVNodes(children: readonly VNode[], preserveText = false): VNode[] {
  return children.flatMap((child) => {
    if (!isVNode(child))
      return []

    if (isCommentVNode(child))
      return []

    if (child.type === NativeText)
      return preserveText ? [child] : []

    if (child.type === Fragment && Array.isArray(child.children))
      return flattenVNodes(child.children.filter(isVNode), preserveText)

    return [child]
  })
}

function buildShorthandContext(input: {
  frontmatter: Record<string, unknown>
  variant: string
  frontmatterDecor: Record<string, unknown> | null
  agendaDecor: Record<string, unknown> | null
  components: LayoutShorthandComponents
}): LayoutShorthandContext {
  return {
    variant: input.variant,
    readFrontmatterValue: key => readFrontmatterValue(input.frontmatter, key),
    readFrontmatterText: key => readFrontmatterText(input.frontmatter, key),
    readFrontmatterArray: key => readFrontmatterArray(input.frontmatter, key),
    readFrontmatterObject: key => readFrontmatterObject(input.frontmatter, key),
    frontmatterDecor: input.frontmatterDecor,
    agendaDecor: input.agendaDecor,
    components: input.components,
  }
}

function buildSourceChildren(input: {
  rawChildren: readonly VNode[]
  layout: ThemeLayout
  variant: string
  layoutSpec: ThemeLayoutSpec | null
  context: LayoutShorthandContext
  slotRules: SlotRules
}) {
  const shorthandKey = `${input.layout}:${input.variant}`
  const preserveText = hasLayoutShorthand(shorthandKey)
  const children = flattenVNodes(input.rawChildren, preserveText)
  const readRole = (node: VNode) => input.slotRules.read(node)?.role ?? ''

  if (shouldUseExplicitRoleChildren(children, shorthandKey, readRole)) {
    input.slotRules.assertChildren(children, {
      label: `${input.layout}:${input.variant}`,
    })
    return children.filter(node => !isBlankTextVNode(node))
  }

  const shorthandChildren = buildLayoutShorthandChildren(shorthandKey, children, input.context)
  if (shorthandChildren)
    return shorthandChildren

  if (input.layoutSpec && children.some(node => !isBlankTextVNode(node))) {
    failMarkdownContract(
      `${input.layout}:${input.variant}`,
      `ожидает поддерживаемую markdown shorthand-структуру или Slot role="${THEME_LAYOUT_ROLES.join('|')}".`,
    )
  }

  return children
}

function validateLayoutChild(input: {
  node: VNode
  layout: ThemeLayout
  variant: string
  slotRules: SlotRules
}) {
  return input.slotRules.assertLayoutChild(input.node, {
    label: `${input.layout}:${input.variant}`,
  })
}

function resolveLayoutRoleIndex(state: LayoutSlotPlanState, id: string, role: ThemeLayoutRole) {
  const current = state.get(id)
  if (current?.role === role)
    return current.index

  const occupied = new Set(
    [...state.entries()]
      .filter(([entryId, entry]) => entryId !== id && entry.role === role)
      .map(([, entry]) => entry.index),
  )

  let index = 0
  while (occupied.has(index))
    index += 1

  state.set(id, { role, index })
  return index
}

function createLayoutSlotPlan(input: {
  recipe: ThemeLayoutRecipe
  themeTone: ThemeTone
  state: LayoutSlotPlanState
}): LayoutSlotPlan {
  return {
    recipe: input.recipe,
    resolveRoleSlot({ id, role, overrides }) {
      const index = resolveLayoutRoleIndex(input.state, id, role)
      const slot = resolveLayoutSlotProps({
        recipe: input.recipe,
        role,
        index,
        overrides,
        themeTone: input.themeTone,
      })

      return { ...slot, role, index }
    },
    unregisterRoleSlot(id) {
      input.state.delete(id)
    },
  }
}

function resolveHeader(input: {
  props: SlideLayoutProps
  frontmatter: Record<string, unknown>
  active: boolean
  layout: ThemeLayout | ''
  variant: string
}) {
  const requestedHeader = input.props.header
    ?? readHeader(readFrontmatterString(input.frontmatter, 'header'))
    ?? 'auto'

  if (requestedHeader !== 'auto')
    return requestedHeader

  if (!input.active)
    return 'none'

  if (input.layout === 'message' && input.variant === 'closing') {
    const closingLogo = readFrontmatterString(input.frontmatter, 'logo') || 'full'
    return closingLogo === 'none' ? 'none' : 'cover'
  }

  return input.layout === 'cover' ? 'cover' : 'default'
}

export function compileLayoutAuthoring(input: LayoutAuthoringInput): CompiledLayoutAuthoring {
  const props = input.props
  const frontmatter = input.frontmatter
  const explicitLayout = props.layout || readFrontmatterString(frontmatter, 'layout')
  const layout = isThemeLayout(explicitLayout) ? explicitLayout : ''
  const active = Boolean(layout)
  const slideMode = resolveSlideMode(props.mode ?? readFrontmatterString(frontmatter, 'mode'), 'Slide.mode', 'light')
  const variant = resolveLayoutVariant(
    layout,
    props.variant || readFrontmatterString(frontmatter, 'variant'),
    props.arrangement || readFrontmatterString(frontmatter, 'arrangement'),
  )
  const layoutSpec = active ? resolveLayoutSpec(layout as ThemeLayout, variant) : null
  const recipe = active ? resolveLayoutRecipe(layout as ThemeLayout, variant) : null
  const contrast = isContrastSlideMode(slideMode)
  const frontmatterDecor = readFrontmatterObject(frontmatter, 'decor')
  const agendaDecor = resolveAgendaDecor({
    decor: frontmatterDecor,
    tone: props.tone || readFrontmatterString(frontmatter, 'tone') || input.defaultTone,
    contrast,
  })
  const theme = resolveThemeMode({
    mode: slideMode,
    tone: props.tone || readFrontmatterString(frontmatter, 'tone'),
    defaultTone: input.defaultTone,
    label: 'Slide',
  })
  const context = buildShorthandContext({
    frontmatter,
    variant,
    frontmatterDecor,
    agendaDecor,
    components: input.components,
  })
  const rawChildren = input.children?.filter(isVNode) ?? []
  const shouldCompileChildren = input.children !== undefined
  const slotRules = createSlotRules({ Slot: input.components.Slot })
  const children = active && shouldCompileChildren
    ? buildSourceChildren({
        rawChildren,
        layout: layout as ThemeLayout,
        variant,
        layoutSpec,
        context,
        slotRules,
      }).map(node =>
        validateLayoutChild({
          node,
          layout: layout as ThemeLayout,
          variant,
          slotRules,
        }),
      )
    : rawChildren

  return {
    mode: active ? 'layout' : 'manual',
    layout,
    variant,
    header: resolveHeader({ props, frontmatter, active, layout, variant }),
    slideMode,
    theme,
    contrast,
    showDebugGrid: readFrontmatterBoolean(frontmatter, 'debug') ?? Boolean(input.debugGrid),
    children,
    slotPlan: recipe
      ? createLayoutSlotPlan({
          recipe,
          themeTone: theme.tone,
          state: input.slotPlanState ?? createLayoutSlotPlanState(),
        })
      : null,
  }
}
