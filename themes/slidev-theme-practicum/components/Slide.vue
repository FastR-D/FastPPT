<script setup lang="ts">
import { computed, defineComponent, h, isVNode, onBeforeUnmount, onMounted, onUpdated, shallowRef, unref, useSlots, type PropType, type VNode } from 'vue'
import { useSlideContext } from '@slidev/client'
import DebugGrid from './DebugGrid.vue'
import Header from './Header.vue'
import Image from './Image.vue'
import Person from './Person.vue'
import Slot from './Slot.vue'
import Text from './Text.vue'
import Timeline from './Timeline.vue'
import { createSlideLayout } from '../composables/slide-layout'
import type { SlideMarkdownContractError } from '../composables/layout-shorthands'
import type { ThemeLayout, ThemeLayoutHeader } from '../composables/layout-recipes'
import { typographElement } from '../composables/text-typography.mjs'
import { themeVars, type ThemeSlideMode, type ThemeTone } from '../composables/theme-foundation'
import { provideSlotPlacementSession } from '../composables/slot-placement'
import { provideTextFitScope } from '../composables/text-fit-scope'
import { useThemeConfig } from '../composables/use-theme-config'

const props = withDefaults(defineProps<{
  as?: string
  layout?: ThemeLayout | ''
  variant?: string
  arrangement?: string
  mode?: ThemeSlideMode
  tone?: ThemeTone | ''
  header?: ThemeLayoutHeader
}>(), {
  as: 'div',
  layout: '',
  variant: '',
  arrangement: '',
  tone: '',
})

const slots = useSlots()
const slideElement = shallowRef<HTMLElement | null>(null)
const browserLifecycleToken = typeof window !== 'undefined'
  && '__practicumBrowserLifecycle' in window
  ? `${Date.now()}-${Math.random()}`
  : ''

const { $frontmatter, $page } = useSlideContext()
const { debugGrid, defaultTone } = useThemeConfig()
const slideLayout = createSlideLayout({
  components: {
    Image,
    Person,
    Slot,
    Text,
    Timeline,
  },
})

const layoutContractLabel = computed(() => {
  const layout = props.layout || String($frontmatter.layout ?? '')
  const variant = props.variant || String($frontmatter.variant ?? '')
  return variant ? `${layout}:${variant}` : layout
})

function reportLayoutContractError(error: SlideMarkdownContractError) {
  const lines = [
    `[Slidev] Слайд ${$page ?? '?'}: ${layoutContractLabel.value}`,
    error.message,
  ]
  if (error.hint)
    lines.push(`  Подсказка: ${error.hint}`)
  lines.push('  См. example.md в slidev-theme-practicum (блоки «Контракт»).')
  console.error(lines.join('\n'))
}

function compileCurrentAuthoring(children?: readonly VNode[]) {
  try {
    return slideLayout.compile({
      props,
      frontmatter: $frontmatter as Record<string, unknown>,
      children,
      defaultTone: defaultTone.value,
      debugGrid: debugGrid.value,
    })
  }
  catch (error) {
    if (error instanceof Error && error.name === 'SlideMarkdownContractError')
      reportLayoutContractError(error as SlideMarkdownContractError)
    throw error
  }
}

const authored = computed(() => compileCurrentAuthoring())
const resolvedLayout = computed(() => authored.value.layout)
const isLayoutMode = computed(() => authored.value.mode === 'layout')
const resolvedVariant = computed(() => authored.value.variant)
const resolvedHeader = computed(() => authored.value.header)
const resolvedTheme = computed(() => authored.value.theme)
const isContrast = computed(() => authored.value.contrast)
const showDebugGrid = computed(() => authored.value.showDebugGrid)
provideSlotPlacementSession(slideLayout)
provideTextFitScope()

function applySlideTypography() {
  typographElement(slideElement.value)
}

function reportBrowserLifecycle(
  phase: 'mounted' | 'unmounted',
  page: number | string,
  token: string,
) {
  if (typeof window === 'undefined' || !('__practicumBrowserLifecycle' in window))
    return

  window.dispatchEvent(new CustomEvent('practicum:slide-lifecycle', {
    detail: {
      phase,
      slide: page,
      token,
    },
  }))
}

onMounted(() => {
  applySlideTypography()
  reportBrowserLifecycle(
    'mounted',
    unref($page) ?? 0,
    browserLifecycleToken,
  )
})

onUpdated(() => {
  applySlideTypography()
})

onBeforeUnmount(() => {
  reportBrowserLifecycle(
    'unmounted',
    unref($page) ?? 0,
    browserLifecycleToken,
  )
})

// eslint-disable-next-line vue/one-component-per-file -- Рендер-адаптер намеренно локален: он не является самостоятельным публичным компонентом.
const RenderVNode = defineComponent({
  name: 'RenderVNode',
  props: {
    vnode: {
      type: Object as PropType<VNode>,
      required: true,
    },
  },
  setup(renderProps) {
    return () => renderProps.vnode
  },
})

const slideStyle = computed(() => themeVars('slide', resolvedTheme.value))

// eslint-disable-next-line vue/one-component-per-file -- Компонент замыкает compileCurrentAuthoring текущего слайда и не имеет самостоятельного API.
const LayoutBody = defineComponent({
  name: 'LayoutBody',
  setup(_, { slots: layoutSlots }) {
    return () => {
      const rawChildren = (layoutSlots.default?.() ?? []).filter(isVNode)
      const layoutChildren = compileCurrentAuthoring(rawChildren).children

      return layoutChildren.map((child, index) => h(RenderVNode, {
        key: child.key ?? `slide-layout-child-${index}`,
        vnode: child,
      }))
    }
  },
})

const slideClass = computed(() => ({
  [`Slide_mode_${resolvedTheme.value.mode}`]: true,
  Slide_layout: isLayoutMode.value,
  [`Slide_layout_${resolvedLayout.value}`]: isLayoutMode.value,
  [`Slide_variant_${resolvedVariant.value}`]: isLayoutMode.value && Boolean(resolvedVariant.value),
  Slide_contrast: isLayoutMode.value && isContrast.value,
}))
</script>

<template>
  <component :is="as"
             ref="slideElement"
             class="Slide slidev-layout"
             :class="slideClass"
             :style="slideStyle">
    <div class="Slide-Header">
      <slot v-if="!isLayoutMode && slots.header" name="header" />
      <Header v-else-if="resolvedHeader !== 'none'"
              :variant="resolvedHeader === 'cover' ? 'cover' : 'default'"
              :inverted="isContrast" />
    </div>
    <DebugGrid v-if="showDebugGrid" />
    <div class="Slide-Grid">
      <slot v-if="!isLayoutMode" />
      <LayoutBody v-else>
        <slot />
      </LayoutBody>
    </div>
  </component>
</template>

<style scoped>
.Slide {
  position: relative;
  isolation: isolate;
  color: var(--theme-text);
  background: var(--theme-bg);
}

.Slide-Header {
  position: absolute;
  top: 0;
  left: var(--theme-margin-left);
  right: var(--theme-margin-right);
  height: var(--theme-margin-top);
  z-index: 1;
  display: flex;
  align-items: flex-start;
}

.Slide-Grid {
  position: absolute;
  inset: var(--theme-margin-top) var(--theme-margin-right) var(--theme-margin-bottom) var(--theme-margin-left);
  z-index: 0;
  display: grid;
  width: auto;
  height: auto;
  grid-template-columns: repeat(var(--theme-grid-columns), minmax(0, 1fr));
  grid-template-rows: repeat(var(--theme-grid-rows), minmax(0, 1fr));
  gap: var(--theme-grid-gap);
}

:deep(.Slide-AgendaContent) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: calc(var(--theme-grid-module) * 4);
}

:deep(.Slide-AgendaList) {
  list-style: none;
  margin: 0;
  padding-left: var(--theme-grid-module);
  counter-reset: slide-toc;
}

:deep(.Slide-AgendaList li) {
  display: grid;
  grid-template-columns: calc(var(--theme-grid-module) * 4) minmax(0, 1fr);
  column-gap: calc(var(--theme-grid-module) * 3);
  align-items: start;
  margin-bottom: calc(var(--theme-grid-module) * 2);
  font-size: var(--theme-text-size-5);
  line-height: var(--theme-text-line-5);
  counter-increment: slide-toc;
}

:deep(.Slide-AgendaList li)::before {
  display: grid;
  place-items: center;
  align-self: start;
  width: calc(var(--theme-grid-module) * 4);
  height: calc(var(--theme-grid-module) * 4);
  border-radius: 50%;
  background: var(--theme-color-dark-0);
  color: var(--theme-color-light-0);
  font-size: var(--theme-text-size-0);
  text-align: center;
  content: counter(slide-toc);
  margin-top: calc(var(--theme-grid-module) * 2);
}

.Slide_contrast :deep(.Slide-AgendaList li)::before {
  background: var(--theme-color-light-0);
  color: var(--theme-current-color);
}

:deep(.Slide-DefinitionLabel) {
  margin-bottom: var(--theme-slot-margin-4);
}

:deep(.Slide-TitleBody) {
  max-width: var(--theme-grid-span-6-width);
  color: var(--theme-text);
  font-size: var(--theme-text-size-4);
  line-height: var(--theme-text-line-4);
}

:deep(.Slide-TitleBody_muted) {
  color: var(--theme-text-muted);
}

:deep(.Slide-TitleBody :where(p, ul, ol, blockquote)) {
  margin: 0;
  color: inherit;
  font-size: inherit;
  line-height: inherit;
}

:deep(.Slide-TitleBody :where(ul, ol)) {
  padding-left: calc(var(--theme-grid-module) * 4);
  list-style-position: outside;
}

:deep(.Slide-TitleBody ul) {
  list-style-type: disc;
}

:deep(.Slide-TitleBody li) {
  display: list-item;
  padding-left: calc(var(--theme-grid-module) * 2);
  margin-bottom: calc(var(--theme-grid-module) * 2);
  font-size: inherit;
  line-height: inherit;
}

:deep(.Slide-TitleBody ul li)::marker {
  color: currentcolor;
  font-size: inherit;
  content: '●';
}

:deep(.Slide-TitleBody ul ul li)::marker {
  content: '▪︎';
}

:deep(.Slide-TitleBody :where(p, ul, ol, blockquote) + :where(p, ul, ol, blockquote)) {
  margin-top: calc(var(--theme-grid-module) * 3);
}

:deep(.Slide-MetricsFeaturedText) {
  max-width: calc(var(--theme-grid-span-6-width) - (var(--theme-slot-margin-4) * 2));
}

:deep(.Slide-PointsTitle) {
  max-width: var(--theme-grid-span-7-width);
}

:deep(.Slide-MetricsFeaturedCopy) {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  width: 100%;
  height: 100%;
  min-height: 100%;
}

:deep(.Slide-MetricsFeaturedCopyValue),
:deep(.Slide-MetricsFeaturedCopyLabel) {
  display: flex;
  min-width: 0;
  min-height: 100%;
}

:deep(.Slide-MetricsFeaturedCopyValue) {
  align-items: center;
  justify-content: center;
  text-align: center;
}

:deep(.Slide-MetricsFeaturedCopyLabel) {
  align-items: flex-start;
  justify-content: flex-start;
}

:deep(.Slide-Quote) {
  max-width: var(--theme-grid-span-11-width);
  font-size: var(--theme-text-size-7);
  line-height: var(--theme-text-line-7);
}

:deep(.Slide-Quote p) {
  font-size: inherit;
  line-height: inherit;
}
</style>
