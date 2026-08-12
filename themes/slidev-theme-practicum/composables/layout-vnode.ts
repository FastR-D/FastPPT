import { Comment, Text as NativeText, type VNode } from 'vue'

export function camelToKebab(key: string) {
  return key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)
}

export function readVNodeProp<T = unknown>(node: VNode | null | undefined, key: string) {
  const nodeProps = (node?.props ?? {}) as Record<string, T | undefined>
  if (key in nodeProps)
    return nodeProps[key]

  const kebabKey = camelToKebab(key)
  if (kebabKey !== key && kebabKey in nodeProps)
    return nodeProps[kebabKey]

  return undefined
}

export function readVNodeTypeName(node: VNode | null | undefined) {
  if (typeof node?.type === 'string')
    return node.type

  if (typeof node?.type === 'object' && node.type) {
    const component = node.type as { name?: string, __name?: string }
    return component.name ?? component.__name ?? 'anonymous-component'
  }

  return 'anonymous-node'
}

export function isBlankTextVNode(node: VNode | null | undefined) {
  return node?.type === NativeText
    && typeof node.children === 'string'
    && !node.children.trim()
}

export function isCommentVNode(node: VNode | null | undefined) {
  return node?.type === Comment
}

export function isNamedComponentVNode(node: VNode | null | undefined, name: string, component?: unknown) {
  return node?.type === component || readVNodeTypeName(node) === name
}
