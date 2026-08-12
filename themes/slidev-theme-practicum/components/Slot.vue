<script setup lang="ts">
import { useSlideContext } from '@slidev/client'
import {
  computed,
  getCurrentInstance,
  onBeforeUnmount,
  shallowRef,
  watchEffect,
} from 'vue'
import ImageRenderer from './ImageRenderer.vue'
import TextFitGroup from './TextFitGroup.vue'
import { createThemeMedia } from '../composables/theme-media.mjs'
import type { ThemeLayoutSlotSpec } from '../composables/layout-recipes'
import { useSlotPlacementSession, type ResolvedSlotPlacement } from '../composables/slot-placement'
import {
  resolveSlotGapCssValue,
  resolveSlotSpacingStyle,
  type SlotGapInput,
  type SlotMarginInput,
} from '../composables/slot-spacing'
import { useThemeConfig } from '../composables/use-theme-config'
import { resolveSlotTheme, themeVars, type ThemeSlotSurface } from '../composables/theme-foundation'
import { camelToKebab } from '../composables/layout-vnode'

type SlotRole = 'primary' | 'secondary' | 'support' | 'media'
type SlotSurfaceInput = ThemeSlotSurface
type ImageDataInput = {
  src: string
  fit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'
  position?: string
  anchor?: string
  x?: number | string
  y?: number | string
  zoom?: number | string
  rotate?: number | string
  color?: string
  opacity?: number | string
  backgroundColor?: string
} & {
  'background-color'?: string
}
type SlotBackgroundInput = ImageDataInput | ImageDataInput[]
type SlotDecorInput = Omit<Partial<ImageDataInput>, 'src'> & {
  src?: string
  id?: string
  meaning?: string
  tone?: string
}

const layoutOverrideKeys = [
  'surface',
  'tone',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'centered',
] as const satisfies readonly (keyof ThemeLayoutSlotSpec)[]

const props = withDefaults(defineProps<{
  as?: string
  role?: SlotRole
  area?: string
  col?: string
  row?: string
  label?: string
  surface?: SlotSurfaceInput
  tone?: string
  background?: SlotBackgroundInput
  decor?: SlotDecorInput
  margin?: SlotMarginInput
  marginTop?: SlotMarginInput
  marginRight?: SlotMarginInput
  marginBottom?: SlotMarginInput
  marginLeft?: SlotMarginInput
  gap?: SlotGapInput
  fitGroup?: string
  centered?: boolean
}>(), {
  as: 'section',
  role: undefined,
  area: '',
  col: '',
  row: '',
  label: '',
  surface: 'none',
  tone: '',
  background: undefined,
  decor: undefined,
  gap: '0',
  fitGroup: '',
  centered: false,
})

const slotId = `theme-slot-${Math.random().toString(36).slice(2, 10)}`
const instance = getCurrentInstance()
const placementSession = useSlotPlacementSession()
const { defaultTone, deckTitle, decors } = useThemeConfig()
const { $slidev } = useSlideContext()
const resolvedRect = shallowRef<ResolvedSlotPlacement['rect'] | null>(null)
const resolvedFootprint = shallowRef<ResolvedSlotPlacement['footprint'] | null>(null)
const resolvedLayoutSlot = shallowRef<ResolvedSlotPlacement['layoutSlot']>(null)
const placementStyle = shallowRef<ResolvedSlotPlacement['style']>({
  gridColumn: 'auto',
  gridRow: 'auto',
})

function hasAuthoredProp(key: string) {
  const vnodeProps = instance?.vnode.props ?? {}
  const kebabKey = camelToKebab(key)
  return key in vnodeProps || kebabKey in vnodeProps
}

function readLayoutOverrides() {
  const overrides: Partial<ThemeLayoutSlotSpec> = {}

  for (const key of layoutOverrideKeys) {
    if (!hasAuthoredProp(key))
      continue

    const value = props[key]
    if (key === 'tone' && !value)
      continue

    overrides[key] = value as never
  }

  return overrides
}

function readPlacementInput() {
  return {
    id: slotId,
    label: props.label || slotId,
    role: props.role,
    area: props.area,
    col: props.col,
    row: props.row,
    overrides: readLayoutOverrides(),
  }
}

function applyPlacement(placement: ResolvedSlotPlacement) {
  resolvedRect.value = placement.rect
  resolvedFootprint.value = placement.footprint
  resolvedLayoutSlot.value = placement.layoutSlot
  placementStyle.value = placement.style
}

const placementHandle = placementSession.register(readPlacementInput(), applyPlacement)

watchEffect(() => {
  placementHandle.update(readPlacementInput())
})

onBeforeUnmount(() => {
  placementHandle.dispose()
})

const resolvedSurface = computed(() => resolveSlotTheme({
  surface: resolvedLayoutSlot.value?.surface ?? props.surface ?? 'none',
  tone: resolvedLayoutSlot.value?.tone ?? props.tone ?? '',
  defaultTone: defaultTone.value,
  label: props.label || slotId,
}))

const slotStyle = computed(() => ({
  ...placementStyle.value,
  ...themeVars('slot', resolvedSurface.value),
}))

function readDecorToken(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

const slideIndex = computed(() => {
  const nav = $slidev?.nav as { currentPage?: unknown } | undefined
  const currentPage = Number(nav?.currentPage)

  return Number.isFinite(currentPage) ? String(currentPage) : ''
})

const decorSlotIdentity = computed(() => {
  if (props.label)
    return props.label

  if (props.area)
    return props.area

  if (props.col || props.row)
    return `${props.col}|${props.row}`

  if (resolvedRect.value) {
    return `${props.role || 'slot'}|${resolvedRect.value.colStart}-${resolvedRect.value.rowStart}-${resolvedRect.value.colEnd}-${resolvedRect.value.rowEnd}`
  }

  return 'slot'
})

const decorSeed = computed(() => [
  deckTitle.value,
  slideIndex.value,
  decorSlotIdentity.value,
  readDecorToken(props.decor?.id),
  readDecorToken(props.decor?.meaning),
  readDecorToken(props.decor?.tone),
].filter(Boolean).join('|'))

const media = computed(() => createThemeMedia({
  themeCatalog: decors.value,
  warn: (message: string) => console.warn(message),
}))

const backgroundLayers = computed(() =>
  media.value.resolveSlotLayers({
    background: props.background,
    decor: props.decor,
  }, {
    label: props.label || slotId,
    footprint: resolvedFootprint.value,
    seed: decorSeed.value,
    tone: resolvedSurface.value.tone,
    contrast: resolvedSurface.value.surface === 'dark' || resolvedSurface.value.surface === 'color',
  }),
)

const marginStyle = computed(() => {
  const layoutSlot = resolvedLayoutSlot.value

  return resolveSlotSpacingStyle({
    margin: layoutSlot?.margin ?? props.margin,
    marginTop: layoutSlot?.marginTop ?? props.marginTop,
    marginRight: layoutSlot?.marginRight ?? props.marginRight,
    marginBottom: layoutSlot?.marginBottom ?? props.marginBottom,
    marginLeft: layoutSlot?.marginLeft ?? props.marginLeft,
  }, props.label || slotId)
})

const contentStyle = computed(() => ({
  ...(marginStyle.value ?? {}),
  '--theme-slot-gap': resolveSlotGapCssValue(props.gap, props.label || slotId),
}))

const alignmentClass = computed(() => ({
  Slot_centered: resolvedLayoutSlot.value?.centered ?? props.centered,
}))

const surfaceClass = computed(() => {
  if (resolvedSurface.value.surface === 'none')
    return null

  return `Slot_surface_${resolvedSurface.value.surface}`
})
</script>

<template>
  <component :is="as"
             class="Slot"
             :class="[
               alignmentClass,
               surfaceClass,
             ]"
             :style="slotStyle">
    <div v-if="backgroundLayers.length" class="Slot-Background" aria-hidden="true">
      <ImageRenderer v-for="backgroundLayer in backgroundLayers"
                     :key="backgroundLayer.key"
                     class="Slot-BackgroundLayer"
                     :layer="backgroundLayer" />
    </div>
    <TextFitGroup class="Slot-Content" :style="contentStyle" :fit-group="props.fitGroup">
      <slot />
    </TextFitGroup>
  </component>
</template>

<style scoped>
.Slot {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: var(--theme-panel-radius);
}

.Slot-Background {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  border-radius: inherit;
}

.Slot-BackgroundLayer {
  position: absolute;
  inset: 0;
}

.Slot-Content {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-radius: inherit;
  gap: var(--theme-slot-gap, 0);
  align-items: stretch;
}

.Slot_surface_none {
  background: transparent;
}

.Slot_surface_light {
  background: var(--theme-surface-light);
  --theme-text: var(--theme-color-dark-0);
  --theme-text-muted: var(--theme-color-dark-2);
  --theme-inline-code-text: var(--theme-text);
  color: var(--theme-text);
}

.Slot_surface_dark {
  background: var(--theme-surface-dark);
  --theme-text: var(--theme-text-on-dark);
  --theme-text-muted: var(--theme-text-muted-on-contrast);
  --theme-inline-code-text: var(--theme-text);
  color: var(--theme-text);
}

.Slot_surface_color {
  background: var(--theme-slot-color, var(--theme-current-color));
  --theme-text: var(--theme-text-on-dark);
  --theme-text-muted: var(--theme-text-muted-on-contrast);
  --theme-inline-code-text: var(--theme-text);
  color: var(--theme-text);
}

.Slot_surface_tint {
  background: var(--theme-slot-tint, var(--theme-surface-light));
  --theme-text: var(--theme-color-dark-0);
  --theme-text-muted: var(--theme-color-dark-2);
  --theme-inline-code-text: var(--theme-text);
  color: var(--theme-text);
}

.Slot_centered .Slot-Content {
  align-items: center;
  text-align: center;
}
</style>
