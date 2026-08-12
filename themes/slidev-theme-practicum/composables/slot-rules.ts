import type { VNode } from 'vue'
import { isBlankTextVNode, isCommentVNode, isNamedComponentVNode, readVNodeProp, readVNodeTypeName } from './layout-vnode'
import { THEME_LAYOUT_ROLES, type ThemeLayoutRole, type ThemeLayoutSlotSpec } from './layout-recipes'
import type { SlotPlacementInput } from './slot-placement'

export type SlotNodeIntent = {
  role: string
  hasCoordinates: boolean
  label: string
}

export type SlotChildrenRuleInput = {
  label: string
}

export type SlotLayoutChildRuleInput = {
  label: string
}

export type SlotIntent =
  | { kind: 'manual', id: string, label: string, area: string, col: string, row: string }
  | { kind: 'layout', id: string, label: string, role: ThemeLayoutRole, overrides: Partial<ThemeLayoutSlotSpec> }

export type SlotRules = {
  read(node: VNode): SlotNodeIntent | null
  assertChildren(children: readonly VNode[], input: SlotChildrenRuleInput): VNode[]
  assertLayoutChild(node: VNode, input: SlotLayoutChildRuleInput): VNode
  normalize(input: SlotPlacementInput, context: { layoutActive: boolean }): SlotIntent
}

const THEME_LAYOUT_ROLE_SET = new Set<ThemeLayoutRole>(THEME_LAYOUT_ROLES)

export function isThemeLayoutRole(value: unknown): value is ThemeLayoutRole {
  return typeof value === 'string' && THEME_LAYOUT_ROLE_SET.has(value as ThemeLayoutRole)
}

function readStringProp(node: VNode, key: string) {
  const value = readVNodeProp<string>(node, key)
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeLabel(input: SlotPlacementInput) {
  return input.label?.trim() || input.id
}

function hasCoordinates(input: SlotPlacementInput | VNode) {
  if ('props' in input) {
    return Boolean(
      readVNodeProp<string>(input, 'area')
      || readVNodeProp<string>(input, 'col')
      || readVNodeProp<string>(input, 'row'),
    )
  }

  return Boolean(input.area || input.col || input.row)
}

export function createSlotRules(input: { Slot: unknown }): SlotRules {
  function read(node: VNode): SlotNodeIntent | null {
    if (!isNamedComponentVNode(node, 'Slot', input.Slot))
      return null

    return {
      role: readStringProp(node, 'role'),
      hasCoordinates: hasCoordinates(node),
      label: readStringProp(node, 'label'),
    }
  }

  return {
    read,
    assertChildren(children, options) {
      const unsupportedNodes = children.filter(node =>
        !isCommentVNode(node)
        && !isBlankTextVNode(node)
        && !read(node)?.role,
      )

      if (unsupportedNodes.length) {
        const unsupportedLabels = unsupportedNodes.map(readVNodeTypeName).join(', ')
        throw new Error(
          `[Slide] ${options.label} ожидает только Slot role="${THEME_LAYOUT_ROLES.join('|')}" children в explicit layout mode. Неподдерживаемые children: ${unsupportedLabels}.`,
        )
      }

      return [...children]
    },
    assertLayoutChild(node, options) {
      const intent = read(node)

      if (!intent?.role)
        return node

      const { role } = intent

      if (!isThemeLayoutRole(role)) {
        throw new Error(
          `[Slide] ${options.label} получил неизвестную Slot role "${role}". Разрешены только: ${THEME_LAYOUT_ROLES.join(', ')}.`,
        )
      }

      if (intent.hasCoordinates) {
        throw new Error('[Slide] Slot внутри layout-слайда не должен получать area, col или row напрямую.')
      }

      return node
    },
    normalize(placementInput, context) {
      const label = normalizeLabel(placementInput)

      if (placementInput.role && !context.layoutActive) {
        throw new Error('[Slot] role разрешён только внутри layout-слайда; вне layout-слайда используйте area, col или row.')
      }

      if (context.layoutActive && placementInput.role && !isThemeLayoutRole(placementInput.role)) {
        throw new Error(`[Slot] role внутри layout-слайда должен быть одним из: ${THEME_LAYOUT_ROLES.join(', ')}.`)
      }

      if (context.layoutActive && placementInput.role && hasCoordinates(placementInput)) {
        throw new Error('[Slot] area, col и row запрещены внутри layout-слайда; задайте role и выберите variant во frontmatter.')
      }

      if (context.layoutActive && !placementInput.role) {
        throw new Error('[Slot] area, col и row запрещены внутри layout-слайда; все Slot внутри layout должны использовать role.')
      }

      if (!context.layoutActive || !placementInput.role) {
        return {
          kind: 'manual',
          id: placementInput.id,
          label,
          area: placementInput.area ?? '',
          col: placementInput.col ?? '',
          row: placementInput.row ?? '',
        }
      }

      return {
        kind: 'layout',
        id: placementInput.id,
        label,
        role: placementInput.role,
        overrides: placementInput.overrides ?? {},
      }
    },
  }
}
