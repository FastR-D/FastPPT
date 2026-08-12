import {
  Comment,
  Fragment,
  Text as VueText,
  cloneVNode,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  shallowRef,
  watch,
  type Ref,
  type VNode,
  type WatchSource,
} from 'vue'
import { createPriorityTextSizeCandidates } from './text-priority-fit.mjs'

export const THEME_TEXT_SIZE_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export type ThemeTextSize = typeof THEME_TEXT_SIZE_LEVELS[number]
export type ThemeTextSizeTokenInput = ThemeTextSize | `${ThemeTextSize}`
export type ThemeTextSizeRangeInput = `${ThemeTextSize}-${ThemeTextSize}`
export type ThemeTextSizeInput = ThemeTextSizeTokenInput | ThemeTextSizeRangeInput

export type ThemeTextSizeRange = {
  minSize: ThemeTextSize
  maxSize: ThemeTextSize
  isRange: boolean
}

export type FitBounds = {
  width: number
  height: number
}

export type TextFitMeasurement = {
  fits: boolean
}

export type TextFitAdapter = {
  measure(element: HTMLElement, bounds: FitBounds): TextFitMeasurement
  observe(elements: readonly HTMLElement[], onChange: () => void): () => void
  schedule(callback: () => void): () => void
  afterFontsReady?(callback: () => void): () => void
}

type MaybeRef<T> = T | Ref<T>

type ElementFitInput = {
  target: Ref<HTMLElement | null>
  enabled: Ref<boolean>
  fallbackSize: MaybeRef<ThemeTextSize>
  maxSize?: MaybeRef<ThemeTextSize>
  minSize?: MaybeRef<ThemeTextSize>
  resolveBounds?: () => FitBounds | null
  watchSources?: WatchSource<unknown>[]
}

type TextFitHandle = {
  size: Ref<ThemeTextSize>
  refit: () => void
}

type GroupFitInput = {
  target: Ref<HTMLElement | null>
  nodes: () => VNode[]
  maxItems?: number
  sharedKey?: MaybeRef<string>
}

type TextGroupFitHandle = {
  apply(nodes: VNode[]): VNode[]
  refit: () => void
}

export type TextFitRuntime = {
  useElement(input: ElementFitInput): TextFitHandle
  useGroup(input: GroupFitInput): TextGroupFitHandle
}

type SlotTextFitItem = {
  minSize: ThemeTextSize
  maxSize: ThemeTextSize
  priority: number
}

type SlotTextFitGroup = {
  initialSizes: number[]
  items: SlotTextFitItem[]
  signature: string
}

type SlotTextFitSnapshot = {
  signature: string
  sizes: number[]
}

type SharedSlotTextFitItem = {
  target: Ref<HTMLElement | null>
  nodes: () => VNode[]
  maxItems: number
  currentFitGroup: SlotTextFitGroup | null
  pendingInternalSignature: string | null | undefined
}

type SharedSlotTextFitGroup = {
  fitSnapshot: Ref<SlotTextFitSnapshot | null>
  items: Map<symbol, SharedSlotTextFitItem>
  runId: number
  version: number
}

const sharedGroups = new Map<string, SharedSlotTextFitGroup>()
const THEME_TEXT_SIZE_SET = new Set<string>(THEME_TEXT_SIZE_LEVELS.map(String))
const DEFAULT_MAX_TEXT_SIZE = THEME_TEXT_SIZE_LEVELS[THEME_TEXT_SIZE_LEVELS.length - 1]
const FIT_TOLERANCE = 1

function readMaybeRef<T>(value: MaybeRef<T>) {
  if (typeof value === 'object' && value !== null && 'value' in value)
    return value.value

  return value
}

export function normalizeThemeTextSize(value: unknown, fallbackSize: ThemeTextSize): ThemeTextSize {
  const normalizedValue = String(value)

  if (!THEME_TEXT_SIZE_SET.has(normalizedValue))
    return fallbackSize

  return Number(normalizedValue) as ThemeTextSize
}

export function parseThemeTextSizeRange(value: unknown, fallbackSize: ThemeTextSize): ThemeTextSizeRange {
  const normalizedValue = String(value)
  const rangeMatch = normalizedValue.match(/^(\d+)-(\d+)$/)

  if (!rangeMatch) {
    const size = normalizeThemeTextSize(value, fallbackSize)

    return {
      minSize: size,
      maxSize: size,
      isRange: false,
    }
  }

  const minSize = normalizeThemeTextSize(rangeMatch[1], fallbackSize)
  const maxSize = normalizeThemeTextSize(rangeMatch[2], fallbackSize)

  if (String(minSize) !== rangeMatch[1] || String(maxSize) !== rangeMatch[2] || minSize > maxSize) {
    return {
      minSize: fallbackSize,
      maxSize: fallbackSize,
      isRange: false,
    }
  }

  return {
    minSize,
    maxSize,
    isRange: true,
  }
}

function defaultBounds(target: Ref<HTMLElement | null>) {
  const parent = target.value?.parentElement

  if (!parent)
    return null

  const parentStyle = getComputedStyle(parent)
  const horizontalPadding = Number.parseFloat(parentStyle.paddingLeft) + Number.parseFloat(parentStyle.paddingRight)
  const verticalPadding = Number.parseFloat(parentStyle.paddingTop) + Number.parseFloat(parentStyle.paddingBottom)

  return {
    width: parent.clientWidth - horizontalPadding,
    height: parent.clientHeight - verticalPadding,
  }
}

function readBounds(input: ElementFitInput) {
  const bounds = input.resolveBounds?.() ?? defaultBounds(input.target)

  if (!bounds || bounds.width <= 0 || bounds.height <= 0)
    return null

  return bounds
}

function readFitObserverElements(element: HTMLElement) {
  const elements: HTMLElement[] = [element]
  let parent = element.parentElement

  while (parent && elements.length < 8) {
    elements.push(parent)

    if (parent.classList.contains('slidev-page'))
      break

    parent = parent.parentElement
  }

  return elements
}

function createBrowserTextFitAdapter(): TextFitAdapter {
  return {
    measure(element, bounds) {
      return {
        fits: element.scrollWidth <= Math.ceil(bounds.width) + FIT_TOLERANCE
          && element.scrollHeight <= Math.ceil(bounds.height) + FIT_TOLERANCE,
      }
    },
    observe(elements, onChange) {
      const resizeObserver = typeof globalThis.ResizeObserver === 'function'
        ? new globalThis.ResizeObserver(onChange)
        : null
      const mutationObserver = typeof globalThis.MutationObserver === 'function'
        ? new globalThis.MutationObserver(onChange)
        : null

      for (const element of elements)
        resizeObserver?.observe(element)

      if (elements[0]) {
        mutationObserver?.observe(elements[0], {
          characterData: true,
          childList: true,
          subtree: true,
        })
      }

      return () => {
        resizeObserver?.disconnect()
        mutationObserver?.disconnect()
      }
    },
    schedule(callback) {
      if (typeof globalThis.requestAnimationFrame !== 'function') {
        callback()
        return () => {}
      }

      const frame = globalThis.requestAnimationFrame(callback)
      return () => globalThis.cancelAnimationFrame(frame)
    },
    afterFontsReady(callback) {
      let active = true
      let fallbackTimers: ReturnType<typeof globalThis.setTimeout>[] = []
      const runIfActive = () => {
        if (active)
          callback()
      }
      const fontReady = globalThis.document?.fonts?.ready

      if (fontReady) {
        void fontReady.then(runIfActive)
      }
      else if (typeof globalThis.setTimeout === 'function') {
        fallbackTimers = [
          globalThis.setTimeout(runIfActive, 250),
          globalThis.setTimeout(runIfActive, 1000),
        ]
      }

      return () => {
        if (!active)
          return

        active = false
        for (const timer of fallbackTimers)
          globalThis.clearTimeout(timer)

        fallbackTimers = []
      }
    },
  }
}

function isBlankSlotNode(node: VNode) {
  if (node.type === Comment)
    return true

  return node.type === VueText
    && typeof node.children === 'string'
    && !node.children.trim()
}

function isFragmentSlotNode(node: VNode) {
  return node.type === Fragment && Array.isArray(node.children)
}

function readVNodeProp(node: VNode, key: string) {
  const props = (node.props ?? {}) as Record<string, unknown>
  return props[key]
}

function isTextSlotNode(node: VNode) {
  if (typeof node.type !== 'object' || node.type == null)
    return false

  const component = node.type as { name?: string, __name?: string }
  return component.name === 'Text' || component.__name === 'Text'
}

function flattenContentNodes(nodes: VNode[]): VNode[] {
  return nodes.flatMap((node) => {
    if (isFragmentSlotNode(node))
      return flattenContentNodes(node.children as VNode[])

    return isBlankSlotNode(node) ? [] : [node]
  })
}

function normalizeTextPriority(value: unknown) {
  const priority = Number(value ?? 1)

  if (!Number.isInteger(priority) || priority < 1)
    return 1

  return priority
}

function firstTextFitCandidate(items: SlotTextFitItem[]) {
  const first = createPriorityTextSizeCandidates(items).next()

  if (first.done || !first.value)
    throw new Error('[Text] size ranges cannot satisfy priority hierarchy.')

  return first.value
}

function readSharedGroupKey(value: MaybeRef<string> | undefined) {
  if (value == null)
    return ''

  return String(readMaybeRef(value)).trim()
}

function createSlotTextFitSignature(items: SlotTextFitItem[]) {
  return items.map(item => `${item.minSize}-${item.maxSize}:${item.priority}`).join('|')
}

function combineSlotTextFitGroups(groups: SlotTextFitGroup[]) {
  if (!groups.length)
    return null

  const itemCount = groups[0].items.length

  if (!groups.every(group => group.items.length === itemCount))
    return null

  const items: SlotTextFitItem[] = groups[0].items.map((firstItem, index) => {
    const groupItems = groups.map(group => group.items[index])
    const minSize = Math.max(...groupItems.map(item => item.minSize)) as ThemeTextSize
    const maxSize = Math.min(...groupItems.map(item => item.maxSize)) as ThemeTextSize

    return {
      minSize,
      maxSize,
      priority: firstItem.priority,
    }
  })

  if (items.some(item => item.minSize > item.maxSize))
    return null

  return {
    initialSizes: firstTextFitCandidate(items),
    items,
    signature: createSlotTextFitSignature(items),
  }
}

function readSlotTextFitGroup(nodes: VNode[], maxItems: number): SlotTextFitGroup | null {
  const directNodes = flattenContentNodes(nodes)

  if (!directNodes.length || !directNodes.every(isTextSlotNode))
    return null

  const items: SlotTextFitItem[] = directNodes.map((node) => {
    const sizeRange = parseThemeTextSizeRange(readVNodeProp(node, 'size') ?? '2', 2)

    return {
      minSize: sizeRange.minSize,
      maxSize: sizeRange.maxSize,
      priority: normalizeTextPriority(readVNodeProp(node, 'priority')),
    }
  })

  if (!items.some(item => item.minSize !== item.maxSize))
    return null

  if (items.length > maxItems)
    throw new Error(`[Slot] coordinated text fitting supports up to ${maxItems} direct Text children.`)

  return {
    initialSizes: firstTextFitCandidate(items),
    items,
    signature: createSlotTextFitSignature(items),
  }
}

function applySlotTextFit(nodes: VNode[], group: SlotTextFitGroup | null, sizes: number[] | null) {
  if (!group || !sizes)
    return nodes

  const resolvedSizes = sizes
  let childNumber = 0

  function applyNode(node: VNode): VNode {
    if (isFragmentSlotNode(node))
      return h(Fragment, null, (node.children as VNode[]).map(applyNode))

    if (isBlankSlotNode(node))
      return node

    childNumber += 1

    if (!isTextSlotNode(node))
      return node

    const size = resolvedSizes[childNumber - 1]

    return cloneVNode(node, {
      size: String(size),
    })
  }

  return nodes.map(applyNode)
}

function sizesEqual(left: number[], right: number[]) {
  return left.length === right.length && left.every((size, index) => size === right[index])
}

function textChildrenFit(element: HTMLElement, adapter: TextFitAdapter) {
  return Array.from(element.children).every((child) => {
    const textElement = child as HTMLElement

    if (!textElement.classList?.contains('Text'))
      return true

    return adapter.measure(textElement, {
      width: textElement.clientWidth,
      height: Number.POSITIVE_INFINITY,
    }).fits
  })
}

function createTextFitCleanupOwner(isDisposed: () => boolean) {
  let cleanup: (() => void) | null = null
  let generation = 0

  return {
    replace(register: (release: () => void) => (() => void) | null) {
      const registrationGeneration = ++generation
      const previousCleanup = cleanup
      cleanup = null
      previousCleanup?.()

      if (isDisposed() || registrationGeneration !== generation)
        return

      const release = () => {
        if (registrationGeneration !== generation)
          return

        generation += 1
        cleanup = null
      }
      const nextCleanup = register(release)

      if (!nextCleanup)
        return

      if (isDisposed() || registrationGeneration !== generation) {
        nextCleanup()
        return
      }

      cleanup = nextCleanup
    },
    clear() {
      generation += 1
      const currentCleanup = cleanup
      cleanup = null
      currentCleanup?.()
    },
  }
}

type TextFitLifecycleOwnerInput = {
  adapter: TextFitAdapter
  fit: () => void | Promise<void>
  onDispose: () => void
  target: Ref<HTMLElement | null>
  watchTarget?: boolean
}

function createTextFitLifecycleOwner({
  adapter,
  fit,
  onDispose,
  target,
  watchTarget = false,
}: TextFitLifecycleOwnerInput) {
  let disposed = false
  const scheduleCleanup = createTextFitCleanupOwner(() => disposed)
  const fontCleanup = createTextFitCleanupOwner(() => disposed)
  const observerCleanup = createTextFitCleanupOwner(() => disposed)

  function scheduleFit() {
    if (disposed)
      return

    scheduleCleanup.replace(release => adapter.schedule(() => {
      release()
      if (disposed)
        return

      void fit()
    }))
  }

  function reconnectObservers() {
    observerCleanup.replace(() => {
      const element = target.value
      if (!element)
        return null

      return adapter.observe(readFitObserverElements(element), scheduleFit)
    })
  }

  onMounted(async () => {
    await nextTick()
    if (disposed)
      return

    reconnectObservers()
    scheduleFit()
    const afterFontsReady = adapter.afterFontsReady
    fontCleanup.replace(() => afterFontsReady?.(scheduleFit) ?? null)
  })

  if (watchTarget) {
    watch(target, async () => {
      await nextTick()
      if (disposed)
        return

      reconnectObservers()
      scheduleFit()
    }, { flush: 'post' })
  }

  onBeforeUnmount(() => {
    if (disposed)
      return

    disposed = true
    fontCleanup.clear()
    scheduleCleanup.clear()
    observerCleanup.clear()
    onDispose()
  })

  return {
    scheduleFit,
  }
}

export function createTextFitRuntime(adapter: TextFitAdapter = createBrowserTextFitAdapter()): TextFitRuntime {
  function ensureSharedGroup(key: string) {
    let group = sharedGroups.get(key)

    if (!group) {
      group = {
        fitSnapshot: shallowRef<SlotTextFitSnapshot | null>(null),
        items: new Map(),
        runId: 0,
        version: 0,
      }
      sharedGroups.set(key, group)
    }

    return group
  }

  function readSharedFitGroup(group: SharedSlotTextFitGroup) {
    const itemGroups: SlotTextFitGroup[] = []

    for (const item of group.items.values()) {
      const fitGroup = item.currentFitGroup ?? readSlotTextFitGroup(item.nodes(), item.maxItems)
      item.currentFitGroup = fitGroup

      if (fitGroup)
        itemGroups.push(fitGroup)
    }

    return combineSlotTextFitGroups(itemGroups)
  }

  function setSharedFitSnapshot(group: SharedSlotTextFitGroup, signature: string, sizes: number[]) {
    if (group.fitSnapshot.value?.signature === signature && sizesEqual(group.fitSnapshot.value.sizes, sizes))
      return

    for (const item of group.items.values())
      item.pendingInternalSignature = signature

    group.fitSnapshot.value = {
      signature,
      sizes,
    }
  }

  function clearSharedFitSnapshot(group: SharedSlotTextFitGroup) {
    if (group.fitSnapshot.value) {
      for (const item of group.items.values())
        item.pendingInternalSignature = null

      group.fitSnapshot.value = null
    }
  }

  function sharedItemsFit(group: SharedSlotTextFitGroup) {
    for (const item of group.items.values()) {
      const element = item.target.value

      if (!element)
        return false

      const ownBounds = {
        width: element.clientWidth,
        height: element.clientHeight,
      }

      if (!adapter.measure(element, ownBounds).fits || !textChildrenFit(element, adapter))
        return false
    }

    return true
  }

  async function fitSharedNow(key: string) {
    const groupState = sharedGroups.get(key)

    if (!groupState) {
      return
    }

    const currentRunId = ++groupState.runId
    const group = readSharedFitGroup(groupState)

    if (!group) {
      clearSharedFitSnapshot(groupState)
      return
    }

    let fallbackSizes = group.initialSizes

    for (const sizes of createPriorityTextSizeCandidates(group.items)) {
      fallbackSizes = sizes
      setSharedFitSnapshot(groupState, group.signature, sizes)

      await nextTick()

      if (currentRunId !== groupState.runId)
        return

      const currentGroup = readSharedFitGroup(groupState)

      if (!currentGroup || currentGroup.signature !== group.signature)
        return

      if (sharedItemsFit(groupState))
        return
    }

    setSharedFitSnapshot(groupState, group.signature, fallbackSizes)
  }

  return {
    useElement(input: ElementFitInput) {
      const size = ref<ThemeTextSize>(readMaybeRef(input.fallbackSize))
      let runId = 0

      async function fitNow() {
        const currentRunId = ++runId
        const element = input.target.value

        if (!input.enabled.value) {
          size.value = readMaybeRef(input.fallbackSize)
          return
        }

        if (!element)
          return

        const resolvedMinSize = readMaybeRef(input.minSize ?? 0)
        const resolvedMaxSize = input.maxSize == null ? DEFAULT_MAX_TEXT_SIZE : readMaybeRef(input.maxSize)
        const candidateSizes = THEME_TEXT_SIZE_LEVELS
          .filter(candidateSize => candidateSize >= resolvedMinSize && candidateSize <= resolvedMaxSize)
          .slice()
          .reverse()

        let resolvedSize = candidateSizes[candidateSizes.length - 1] ?? readMaybeRef(input.fallbackSize)

        for (const candidateSize of candidateSizes) {
          size.value = candidateSize
          await nextTick()

          if (currentRunId !== runId || !input.enabled.value)
            return

          const bounds = readBounds(input)

          if (!bounds)
            return

          if (adapter.measure(element, bounds).fits) {
            resolvedSize = candidateSize
            break
          }
        }

        size.value = resolvedSize
      }

      const { scheduleFit } = createTextFitLifecycleOwner({
        adapter,
        fit: fitNow,
        onDispose: () => {
          runId += 1
        },
        target: input.target,
        watchTarget: true,
      })

      watch(input.enabled, (isEnabled) => {
        if (isEnabled)
          scheduleFit()
        else
          size.value = readMaybeRef(input.fallbackSize)
      }, { flush: 'post' })

      if (input.watchSources && input.watchSources.length > 0) {
        watch(input.watchSources, () => {
          scheduleFit()
        }, { flush: 'post' })
      }

      return {
        size,
        refit: scheduleFit,
      }
    },
    useGroup(input: GroupFitInput) {
      const maxItems = input.maxItems ?? 3
      const itemId = Symbol('slot-text-fit-group')
      const fitSnapshot = shallowRef<SlotTextFitSnapshot | null>(null)
      let currentFitGroup: SlotTextFitGroup | null = null
      let currentSharedKey = ''
      let appliedSharedSignature: string | null = null
      let appliedSharedVersion = 0
      let runId = 0
      let pendingInternalSignature: string | null | undefined

      function unregisterSharedItem() {
        if (!currentSharedKey)
          return

        const group = sharedGroups.get(currentSharedKey)
        group?.items.delete(itemId)

        if (group && !group.items.size)
          sharedGroups.delete(currentSharedKey)

        currentSharedKey = ''
      }

      function registerSharedItem(key: string) {
        if (currentSharedKey && currentSharedKey !== key)
          unregisterSharedItem()

        currentSharedKey = key
        const group = ensureSharedGroup(key)
        let item = group.items.get(itemId)
        let isNew = false

        if (!item) {
          isNew = true
          item = {
            target: input.target,
            nodes: input.nodes,
            maxItems,
            currentFitGroup: null,
            pendingInternalSignature: undefined,
          }
          group.items.set(itemId, item)
          group.version += 1
        }

        item.target = input.target
        item.nodes = input.nodes
        item.maxItems = maxItems

        return { group, item, isNew }
      }

      function setFitSnapshot(signature: string, sizes: number[]) {
        if (fitSnapshot.value?.signature === signature && sizesEqual(fitSnapshot.value.sizes, sizes))
          return

        pendingInternalSignature = signature
        fitSnapshot.value = {
          signature,
          sizes,
        }
      }

      function clearFitSnapshot() {
        if (fitSnapshot.value) {
          pendingInternalSignature = null
          fitSnapshot.value = null
        }
      }

      async function fitNow() {
        const sharedKey = readSharedGroupKey(input.sharedKey)

        if (sharedKey) {
          registerSharedItem(sharedKey)
          await fitSharedNow(sharedKey)
          return
        }

        unregisterSharedItem()

        const currentRunId = ++runId
        const group = currentFitGroup ?? readSlotTextFitGroup(input.nodes(), maxItems)
        const element = input.target.value

        if (!group || !element) {
          clearFitSnapshot()
          return
        }

        let fallbackSizes = group.initialSizes

        for (const sizes of createPriorityTextSizeCandidates(group.items)) {
          fallbackSizes = sizes
          setFitSnapshot(group.signature, sizes)

          await nextTick()

          if (currentRunId !== runId || currentFitGroup?.signature !== group.signature)
            return

          const ownBounds = {
            width: element.clientWidth,
            height: element.clientHeight,
          }

          if (adapter.measure(element, ownBounds).fits && textChildrenFit(element, adapter))
            return
        }

        setFitSnapshot(group.signature, fallbackSizes)
      }

      const { scheduleFit } = createTextFitLifecycleOwner({
        adapter,
        fit: fitNow,
        onDispose: () => {
          runId += 1
          unregisterSharedItem()
        },
        target: input.target,
      })

      onUpdated(() => {
        const sharedKey = readSharedGroupKey(input.sharedKey)

        if (sharedKey) {
          const sharedGroup = sharedGroups.get(sharedKey)
          const sharedItem = sharedGroup?.items.get(itemId)
          const internalSignature = sharedItem?.pendingInternalSignature

          if (sharedItem)
            sharedItem.pendingInternalSignature = undefined

          if (internalSignature !== undefined && internalSignature === (sharedGroup ? readSharedFitGroup(sharedGroup)?.signature ?? null : null))
            return

          scheduleFit()
          return
        }

        const internalSignature = pendingInternalSignature
        pendingInternalSignature = undefined

        if (internalSignature !== undefined && internalSignature === (currentFitGroup?.signature ?? null))
          return

        scheduleFit()
      })

      function apply(nodes: VNode[]) {
        const group = readSlotTextFitGroup(nodes, maxItems)
        currentFitGroup = group

        const sharedKey = readSharedGroupKey(input.sharedKey)

        if (sharedKey) {
          const shared = registerSharedItem(sharedKey)
          const previousSignature = shared.item.currentFitGroup?.signature ?? null
          shared.item.currentFitGroup = group
          const nextSignature = group?.signature ?? null

          if (
            shared.isNew
            || previousSignature !== nextSignature
            || appliedSharedVersion !== shared.group.version
            || appliedSharedSignature !== nextSignature
          ) {
            appliedSharedVersion = shared.group.version
            appliedSharedSignature = nextSignature
            scheduleFit()
          }

          const sharedGroup = readSharedFitGroup(shared.group)
          const fittedSizes = group && sharedGroup && shared.group.fitSnapshot.value?.signature === sharedGroup.signature
            ? shared.group.fitSnapshot.value.sizes
            : sharedGroup?.initialSizes ?? group?.initialSizes ?? null

          return applySlotTextFit(nodes, group, fittedSizes)
        }

        unregisterSharedItem()

        const fittedSizes = group && fitSnapshot.value?.signature === group.signature
          ? fitSnapshot.value.sizes
          : group?.initialSizes ?? null

        return applySlotTextFit(nodes, group, fittedSizes)
      }

      return {
        apply,
        refit: scheduleFit,
      }
    },
  }
}
