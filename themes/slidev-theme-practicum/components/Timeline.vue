<script setup lang="ts">
import { computed, getCurrentInstance, shallowRef, type ComponentPublicInstance } from 'vue'
import { resolveTimelineItemGridStyle, resolveTimelineLabelSpan } from '../composables/timeline-grid'
import { createTextFitRuntime, type ThemeTextSize } from '../composables/text-fit-runtime'
import Text from './Text.vue'
import TextFitGroup from './TextFitGroup.vue'

const TIMELINE_ACTIVE_YEAR_FALLBACK_SIZE: ThemeTextSize = 9
const timelineFitGroup = `timeline-${getCurrentInstance()?.uid ?? 'default'}`

const props = defineProps({
  items: {
    type: Array as () => Array<{ year: string, label: string, active?: boolean }>,
    required: true,
  },
})

const timelineElement = shallowRef<HTMLElement | null>(null)
const activeYearElement = shallowRef<HTMLElement | null>(null)
const hasActiveItem = computed(() => props.items.some(item => item.active))
const activeIndices = computed(() => props.items.flatMap((item, itemIndex) => item.active ? [itemIndex] : []))
const labelSpan = computed(() => resolveTimelineLabelSpan(props.items))
const TIMELINE_ACTIVE_YEAR_MAX_SIZE = computed<ThemeTextSize>(() => 12)
const textFit = createTextFitRuntime()

function assertSingleActiveItem() {
  if (activeIndices.value.length > 1)
    throw new Error('[Timeline] items поддерживает не больше одного active item.')
}

function setYearElement(element: Element | ComponentPublicInstance | null, isActive?: boolean) {
  if (!isActive)
    return

  assertSingleActiveItem()
  activeYearElement.value = element instanceof HTMLElement ? element : null
}

function resolveActiveYearBounds() {
  const timeline = timelineElement.value
  const activeYear = activeYearElement.value
  const activeItem = activeYear?.parentElement

  if (!timeline || !activeYear || !activeItem)
    return null

  const timelineStyle = globalThis.getComputedStyle(timeline)
  const dotSize = Number.parseFloat(timelineStyle.getPropertyValue('--timeline-dot-size')) || 0
  const blockHeight = Number.parseFloat(timelineStyle.getPropertyValue('--timeline-block-height')) || 0

  return {
    width: activeItem.clientWidth,
    height: Math.max(0, timeline.clientHeight - dotSize - blockHeight),
  }
}

const { size: fittedActiveYearSize } = textFit.useElement({
  target: activeYearElement,
  enabled: computed(() => {
    assertSingleActiveItem()
    return hasActiveItem.value
  }),
  fallbackSize: TIMELINE_ACTIVE_YEAR_FALLBACK_SIZE,
  maxSize: TIMELINE_ACTIVE_YEAR_MAX_SIZE,
  resolveBounds: resolveActiveYearBounds,
  watchSources: [
    () => props.items,
  ],
})

const timelineStyle = computed(() => ({
  '--theme-timeline-label-width': `var(--theme-grid-span-${labelSpan.value}-width)`,
  ...(hasActiveItem.value
    ? {
        '--theme-timeline-active-year-size': `var(--theme-text-size-${fittedActiveYearSize.value})`,
        '--theme-timeline-active-year-line': `var(--theme-text-line-${fittedActiveYearSize.value})`,
      }
    : {}),
}))

function getItemGridStyle(index: number) {
  assertSingleActiveItem()
  return resolveTimelineItemGridStyle(props.items, index)
}
</script>

<template>
  <div ref="timelineElement"
       class="Timeline"
       :style="timelineStyle"
       :class="{ 'Timeline_has_active': hasActiveItem }">
    <div class="Timeline-Rail" />

    <div v-for="(item, index) in items"
         :key="`${item.year}-${index}`"
         class="Timeline-Item"
         :style="getItemGridStyle(index)"
         :class="{ 'Timeline-Item_active': item.active }">
      <div :ref="element => setYearElement(element, item.active)" class="Timeline-Year">
        <span v-if="item.active">{{ item.year }}</span>
        <TextFitGroup v-else
                      class="Timeline-YearFitGroup"
                      :fit-group="`${timelineFitGroup}-years`">
          <Text size="4-7">{{ item.year }}</Text>
        </TextFitGroup>
      </div>
      <div class="Timeline-Dot" />
      <div class="Timeline-Label">
        <Text v-if="item.active" size="2-3">{{ item.label }}</Text>
        <TextFitGroup v-else :fit-group="`${timelineFitGroup}-labels`">
          <Text size="2-3">{{ item.label }}</Text>
        </TextFitGroup>
      </div>
    </div>
  </div>
</template>

<style scoped>
.Timeline {
  --timeline-block-height: calc(var(--theme-cell-height) * 2 + var(--theme-grid-gap));
  --timeline-dot-size: calc(var(--theme-grid-module) * 4);
  --theme-timeline-active-year-size: var(--theme-text-size-9);
  --theme-timeline-active-year-line: var(--theme-text-line-9);
  --theme-timeline-label-width: var(--theme-grid-span-3-width);
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--theme-grid-columns), minmax(0, 1fr));
  column-gap: var(--theme-grid-gap);
  align-items: end;
  align-content: end;
  min-height: 100%;
}

.Timeline-Rail {
  position: absolute;
  left: calc(var(--theme-margin-left) * -1);
  right: calc(var(--theme-margin-right) * -1);
  bottom: calc(var(--timeline-block-height) + (var(--timeline-dot-size) / 2) - (var(--theme-grid-module) / 2));
  height: var(--theme-grid-module);
  background: color-mix(in srgb, var(--theme-text-muted) 28%, transparent);
}

.Timeline-Item {
  position: relative;
  min-width: 0;
  display: grid;
  grid-template-rows:
    var(--timeline-block-height)
    var(--timeline-dot-size)
    var(--timeline-block-height);
  min-height: calc((var(--timeline-block-height) * 2) + var(--timeline-dot-size));
}

.Timeline-Year {
  min-width: 0;
  min-height: var(--timeline-block-height);
  padding-right: var(--theme-grid-gap);
  display: flex;
  align-items: flex-end;
  color: var(--theme-text);
}

.Timeline-YearFitGroup {
  padding-bottom: var(--theme-grid-module);
}

.Timeline-Dot {
  width: var(--timeline-dot-size);
  height: var(--timeline-dot-size);
  border: var(--theme-grid-module) solid var(--theme-text);
  border-radius: 50%;
  background: var(--theme-bg);
  align-self: center;
}

.Timeline-Label {
  min-height: var(--timeline-block-height);
  width: min(100%, var(--theme-timeline-label-width));
  padding-right: var(--theme-grid-gap);
  padding-top: var(--theme-slot-margin-3);
  color: var(--theme-text-muted);
}

.Timeline_has_active .Timeline-Year {
  color: var(--theme-text-muted);
}

.Timeline_has_active .Timeline-Dot {
  border-color: var(--theme-text-muted);
}

.Timeline-Item_active .Timeline-Year {
  color: var(--theme-text);
  font-size: var(--theme-timeline-active-year-size);
  line-height: var(--theme-timeline-active-year-line);
}

.Timeline-Item_active .Timeline-Dot {
  border-color: var(--theme-text);
}

.Timeline-Item_active .Timeline-Label {
  color: inherit;
}
</style>
