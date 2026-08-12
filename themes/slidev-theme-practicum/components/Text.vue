<script setup lang="ts">
import { computed, shallowRef, useSlots } from 'vue'
import {
  createTextFitRuntime,
  parseThemeTextSizeRange,
  type ThemeTextSize,
  type ThemeTextSizeInput,
} from '../composables/text-fit-runtime'
import { resolveTextSlotMarkdown } from '../composables/text-slot-markdown.mjs'

type ThemeTextPriority = 1 | 2 | 3
type ThemeTextPriorityInput = ThemeTextPriority | `${ThemeTextPriority}`
type TextFlowAlign = 'start' | 'middle' | 'end'
type TextColorToken =
  | 'current'
  | 'text'
  | 'text-muted'
  | 'text-on-dark'
  | 'text-muted-on-contrast'
  | 'link'
  | 'light-0'
  | 'light-1'
  | 'dark-0'
  | 'dark-1'
  | 'dark-2'
  | 'blue-0'
  | 'blue-1'
  | 'orange-0'
  | 'orange-1'
  | 'green-0'
  | 'green-1'
  | 'red-0'
  | 'yellow-0'

const TEXT_COLOR_MAP: Record<TextColorToken, string> = {
  'current': 'currentColor',
  'text': 'var(--theme-text)',
  'text-muted': 'var(--theme-text-muted)',
  'text-on-dark': 'var(--theme-text-on-dark)',
  'text-muted-on-contrast': 'var(--theme-text-muted-on-contrast)',
  'link': 'var(--theme-link)',
  'light-0': 'var(--theme-color-light-0)',
  'light-1': 'var(--theme-color-light-1)',
  'dark-0': 'var(--theme-color-dark-0)',
  'dark-1': 'var(--theme-color-dark-1)',
  'dark-2': 'var(--theme-color-dark-2)',
  'blue-0': 'var(--theme-color-blue-0)',
  'blue-1': 'var(--theme-color-blue-1)',
  'orange-0': 'var(--theme-color-orange-0)',
  'orange-1': 'var(--theme-color-orange-1)',
  'green-0': 'var(--theme-color-green-0)',
  'green-1': 'var(--theme-color-green-1)',
  'red-0': 'var(--theme-color-red-0)',
  'yellow-0': 'var(--theme-color-yellow-0)',
}

const props = withDefaults(defineProps<{
  as?: string
  size?: ThemeTextSizeInput
  priority?: ThemeTextPriorityInput
  align?: TextFlowAlign
  maxSize?: boolean
  muted?: boolean
  color?: TextColorToken
}>(), {
  as: 'div',
  size: '2',
  priority: '1',
  align: 'start',
  maxSize: false,
  muted: false,
  color: 'current',
})

const slots = useSlots()
const markdownNodes = computed(() => {
  const tag = props.as.toLowerCase()

  if (/^h[1-6]$/.test(tag))
    return null

  return resolveTextSlotMarkdown(slots.default?.() ?? [])
})
const textElement = shallowRef<HTMLElement | null>(null)
const normalizedSizeRange = computed(() => parseThemeTextSizeRange(props.size, 2))
const fitMax = computed(() => props.maxSize || normalizedSizeRange.value.isRange)
const fitMinSize = computed<ThemeTextSize>(() => props.maxSize ? 0 : normalizedSizeRange.value.minSize)
const fitMaxSize = computed<ThemeTextSize>(() => props.maxSize ? 12 : normalizedSizeRange.value.maxSize)
const fitFallbackSize = computed<ThemeTextSize>(() => normalizedSizeRange.value.minSize)
const textFit = createTextFitRuntime()
const { size: fittedSize } = textFit.useElement({
  target: textElement,
  enabled: fitMax,
  fallbackSize: fitFallbackSize,
  minSize: fitMinSize,
  maxSize: fitMaxSize,
  watchSources: [
    () => props.size,
    () => props.maxSize,
    () => props.priority,
  ],
})

const normalizedSize = computed(() => {
  if (fitMax.value)
    return fittedSize.value

  return normalizedSizeRange.value.minSize
})

const resolvedColor = computed<TextColorToken>(() => props.muted ? 'text-muted' : props.color)

const textStyle = computed(() => ({
  color: TEXT_COLOR_MAP[resolvedColor.value],
}))
</script>

<template>
  <component :is="as"
             ref="textElement"
             class="Text"
             :class="[
               `Text_size_${normalizedSize}`,
               {
                 Text_align_start: props.align === 'start',
                 Text_align_middle: props.align === 'middle',
                 Text_align_end: props.align === 'end',
                 Text_fit_max: fitMax,
                 Text_muted: props.muted,
               },
             ]"
             :style="textStyle">
    <slot v-if="!markdownNodes" />
    <component v-for="(node, index) in markdownNodes"
               :is="node"
               :key="index" />
  </component>
</template>

<style scoped>
.Text {
  min-width: 0;
  margin: 0;
  font-weight: 400;
  --theme-text-list-marker-width: 2ch;
}

.Text_fit_max {
  width: 100%;
}

.Text_align_start {
  margin-top: 0;
  margin-bottom: 0;
}

.Text_align_middle {
  margin-top: auto;
  margin-bottom: auto;
}

.Text_align_end {
  margin-top: auto;
}

.Text_size_0 {
  font-size: var(--theme-text-size-0);
  line-height: var(--theme-text-line-0);
}

.Text_size_1 {
  font-size: var(--theme-text-size-1);
  line-height: var(--theme-text-line-1);
}

.Text_size_2 {
  font-size: var(--theme-text-size-2);
  line-height: var(--theme-text-line-2);
}

.Text_size_3 {
  font-size: var(--theme-text-size-3);
  line-height: var(--theme-text-line-3);
}

.Text_size_4 {
  font-size: var(--theme-text-size-4);
  line-height: var(--theme-text-line-4);
}

.Text_size_5 {
  font-size: var(--theme-text-size-5);
  line-height: var(--theme-text-line-5);
}

.Text_size_6 {
  font-size: var(--theme-text-size-6);
  line-height: var(--theme-text-line-6);
}

.Text_size_7 {
  font-size: var(--theme-text-size-7);
  line-height: var(--theme-text-line-7);
}

.Text_size_8 {
  font-size: var(--theme-text-size-8);
  line-height: var(--theme-text-line-8);
}

.Text_size_9 {
  font-size: var(--theme-text-size-9);
  line-height: var(--theme-text-line-9);
}

.Text_size_10 {
  font-size: var(--theme-text-size-10);
  line-height: var(--theme-text-line-10);
}

.Text_size_11 {
  font-size: var(--theme-text-size-11);
  line-height: var(--theme-text-line-11);
}

.Text_size_12 {
  font-size: var(--theme-text-size-12);
  line-height: var(--theme-text-line-12);
}

.Text :deep(:where(p, li)) {
  font-size: inherit;
  line-height: inherit;
}

.Text :deep(p) {
  margin: 0;
}

.Text :deep(:where(ul, ol)) {
  margin: 0;
  padding-left: 0;
  list-style-position: outside;
}

.Text :deep(ul) {
  list-style-type: disc;
  padding-inline-start: 1.25ch;
}

.Text :deep(ol) {
  list-style-type: decimal;
  padding-inline-start: var(--theme-text-list-marker-width);
  font-variant-numeric: tabular-nums;
}

.Text :deep(li > :is(ul, ol)) {
  padding-inline-start: calc(var(--theme-grid-module) * 2);
}

.Text :deep(li) {
  display: list-item;
  margin-bottom: var(--theme-space-flow);
  color: inherit;
  font-size: inherit;
}

/* Slidev pass-through: <li><p>…</p></li> ломает outside-маркеры */
.Text :deep(li > p) {
  display: inline;
  margin: 0;
}

.Text :deep(:where(p, li) + :where(p, ul, ol)) {
  margin-top: var(--theme-space-flow);
}

.Text :deep(li)::marker {
  color: currentcolor;
  font-size: inherit;
}
</style>
