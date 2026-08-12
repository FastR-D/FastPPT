<script setup lang="ts">
import {
  layout as layoutText,
  measureNaturalWidth,
  prepare,
  prepareWithSegments,
} from '@chenglou/pretext'
import { useNav } from '@slidev/client'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import type { ThemeTocItem } from '../types/slidev-runtime'
import BaseLayout from './base.vue'

interface TocEntry extends ThemeTocItem {
  index: number
}

interface TocDensity {
  titleSize: number
  titleLineHeight: number
  childSize: number
  childLineHeight: number
  itemGap: number
  childGap: number
  childMargin: number
  numberSize: number
  numberFontSize: number
  entryGap: number
  columnGap: number
  shellGap: number
  paddingBlock: number
  paddingInline: number
}

interface TocFit extends TocDensity {
  columns: number
  contentWidth: number
}

const props = withDefaults(
  defineProps<{
    active?: number | null
    tocTree?: ThemeTocItem[] | null
  }>(),
  {
    active: null,
    tocTree: null,
  },
)

const { tocTree: globalToc } = useNav()
const tocRoot = ref<HTMLElement | null>(null)
const fit = ref<TocFit>({
  columns: 1,
  contentWidth: 520,
  titleSize: 27,
  titleLineHeight: 32,
  childSize: 14,
  childLineHeight: 19,
  itemGap: 18,
  childGap: 3,
  childMargin: 6,
  numberSize: 42,
  numberFontSize: 20,
  entryGap: 16,
  columnGap: 28,
  shellGap: 48,
  paddingBlock: 24,
  paddingInline: 56,
})

const densityPresets: TocDensity[] = [
  { ...fit.value },
  {
    titleSize: 24,
    titleLineHeight: 29,
    childSize: 13,
    childLineHeight: 17,
    itemGap: 13,
    childGap: 2,
    childMargin: 5,
    numberSize: 38,
    numberFontSize: 18,
    entryGap: 13,
    columnGap: 24,
    shellGap: 38,
    paddingBlock: 18,
    paddingInline: 44,
  },
  {
    titleSize: 21,
    titleLineHeight: 25,
    childSize: 12,
    childLineHeight: 15,
    itemGap: 9,
    childGap: 1,
    childMargin: 4,
    numberSize: 34,
    numberFontSize: 16,
    entryGap: 10,
    columnGap: 18,
    shellGap: 30,
    paddingBlock: 12,
    paddingInline: 32,
  },
]

const activeClass = 'text-black opacity-100'
const inactiveClass = 'text-gray-400 opacity-40'
const activeBox = 'bg-[#3b99d4]'
const inactiveBox = 'bg-[#3b99d4] opacity-20'
const tocData = computed(() => props.tocTree ?? globalToc.value)
const indexedToc = computed<TocEntry[]>(() =>
  tocData.value.map((item, index) => ({ ...item, index })),
)
const tocColumns = computed(() =>
  splitEntries(indexedToc.value, fit.value.columns),
)
const fitStyle = computed<CSSProperties>(() => ({
  '--toc-title-size': `${fit.value.titleSize}px`,
  '--toc-title-line-height': `${fit.value.titleLineHeight}px`,
  '--toc-child-size': `${fit.value.childSize}px`,
  '--toc-child-line-height': `${fit.value.childLineHeight}px`,
  '--toc-item-gap': `${fit.value.itemGap}px`,
  '--toc-child-gap': `${fit.value.childGap}px`,
  '--toc-child-margin': `${fit.value.childMargin}px`,
  '--toc-number-size': `${fit.value.numberSize}px`,
  '--toc-number-font-size': `${fit.value.numberFontSize}px`,
  '--toc-entry-gap': `${fit.value.entryGap}px`,
  '--toc-column-gap': `${fit.value.columnGap}px`,
  '--toc-shell-gap': `${fit.value.shellGap}px`,
  '--toc-padding-block': `${fit.value.paddingBlock}px`,
  '--toc-padding-inline': `${fit.value.paddingInline}px`,
  '--toc-columns': String(fit.value.columns),
  '--toc-content-width': `${fit.value.contentWidth}px`,
}))

let resizeObserver: ResizeObserver | undefined
let fitRequest = 0

function splitEntries(entries: TocEntry[], columns: number): TocEntry[][] {
  const rows = Math.ceil(entries.length / columns)
  return Array.from({ length: columns }, (_, column) =>
    entries.slice(column * rows, Math.min(entries.length, (column + 1) * rows)),
  ).filter((column) => column.length > 0)
}

function scaledDensity(density: TocDensity, scale: number): TocDensity {
  return Object.fromEntries(
    Object.entries(density).map(([key, value]) => [
      key,
      Math.max(1, value * scale),
    ]),
  ) as unknown as TocDensity
}

function textHeight(
  text: string,
  width: number,
  fontSize: number,
  lineHeight: number,
  fontWeight: number,
  fontFamily: string,
): number {
  if (!text) return 0
  try {
    return layoutText(
      prepare(text, `${fontWeight} ${fontSize}px ${fontFamily}`),
      Math.max(1, width),
      lineHeight,
    ).height
  } catch {
    return lineHeight
  }
}

function naturalTextWidth(
  text: string,
  fontSize: number,
  fontWeight: number,
  fontFamily: string,
): number {
  if (!text) return 0
  try {
    return measureNaturalWidth(
      prepareWithSegments(text, `${fontWeight} ${fontSize}px ${fontFamily}`),
    )
  } catch {
    return text.length * fontSize
  }
}

function preferredColumnWidth(
  entries: TocEntry[],
  density: TocDensity,
  fontFamily: string,
): number {
  const textWidth = entries.reduce((maximum, item) => {
    const titleWidth = naturalTextWidth(
      item.title,
      density.titleSize,
      700,
      fontFamily,
    )
    const childWidth = (item.children ?? []).reduce(
      (childMaximum, child) =>
        Math.max(
          childMaximum,
          naturalTextWidth(child.title, density.childSize, 500, fontFamily) +
            16,
        ),
      0,
    )
    return Math.max(maximum, titleWidth, childWidth)
  }, 0)
  return Math.min(
    520,
    Math.max(280, density.numberSize + density.entryGap + textWidth),
  )
}

function candidateContentWidth(
  entries: TocEntry[],
  columns: number,
  density: TocDensity,
  width: number,
  fontFamily: string,
): number {
  const badgeWidth = 72
  const maximumWidth =
    width - density.paddingInline * 2 - badgeWidth - density.shellGap
  const preferredWidth =
    splitEntries(entries, columns).reduce(
      (total, column) =>
        total + preferredColumnWidth(column, density, fontFamily),
      0,
    ) +
    density.columnGap * (columns - 1)
  return Math.min(maximumWidth, preferredWidth)
}

function entryHeight(
  item: TocEntry,
  width: number,
  density: TocDensity,
  fontFamily: string,
): number {
  const textWidth = Math.max(1, width - density.numberSize - density.entryGap)
  const titleHeight = textHeight(
    item.title,
    textWidth,
    density.titleSize,
    density.titleLineHeight,
    700,
    fontFamily,
  )
  const children = item.children ?? []
  const childrenHeight = children.reduce(
    (height, child, index) =>
      height +
      textHeight(
        child.title,
        Math.max(1, textWidth - 16),
        density.childSize,
        density.childLineHeight,
        500,
        fontFamily,
      ) +
      (index === 0 ? 0 : density.childGap),
    0,
  )
  const textBlockHeight =
    titleHeight +
    (children.length > 0 ? density.childMargin + childrenHeight : 0)
  return Math.max(density.numberSize, textBlockHeight)
}

function candidateFits(
  entries: TocEntry[],
  columns: number,
  density: TocDensity,
  width: number,
  height: number,
  fontFamily: string,
): boolean {
  const badgeWidth = 72
  const contentWidth = candidateContentWidth(
    entries,
    columns,
    density,
    width,
    fontFamily,
  )
  const columnWidth =
    (contentWidth - density.columnGap * (columns - 1)) / columns
  const availableHeight = height - density.paddingBlock * 2
  if (
    contentWidth + badgeWidth + density.shellGap + density.paddingInline * 2 >
      width + 1 ||
    columnWidth < 150 ||
    availableHeight <= 0
  )
    return false

  return splitEntries(entries, columns).every((column) => {
    const contentHeight = column.reduce(
      (total, item, index) =>
        total +
        entryHeight(item, columnWidth, density, fontFamily) +
        (index === 0 ? 0 : density.itemGap),
      0,
    )
    return contentHeight <= availableHeight
  })
}

function calculateFit(): void {
  const root = tocRoot.value
  const entries = indexedToc.value
  if (!root || entries.length === 0) return

  const style = getComputedStyle(root)
  const fontFamily = style.fontFamily || 'Source Han Sans, sans-serif'
  const maxColumns = Math.min(4, Math.max(1, Math.ceil(entries.length / 3)))

  for (const density of densityPresets) {
    for (let columns = 1; columns <= maxColumns; columns += 1) {
      if (
        candidateFits(
          entries,
          columns,
          density,
          root.clientWidth,
          root.clientHeight,
          fontFamily,
        )
      ) {
        fit.value = {
          ...density,
          columns,
          contentWidth: candidateContentWidth(
            entries,
            columns,
            density,
            root.clientWidth,
            fontFamily,
          ),
        }
        return
      }
    }
  }

  const density = densityPresets.at(-1)!
  for (let scale = 0.95; scale >= 0.5; scale -= 0.05) {
    const scaled = scaledDensity(density, scale)
    if (
      candidateFits(
        entries,
        maxColumns,
        scaled,
        root.clientWidth,
        root.clientHeight,
        fontFamily,
      )
    ) {
      fit.value = {
        ...scaled,
        columns: maxColumns,
        contentWidth: candidateContentWidth(
          entries,
          maxColumns,
          scaled,
          root.clientWidth,
          fontFamily,
        ),
      }
      return
    }
  }

  const scaled = scaledDensity(density, 0.5)
  fit.value = {
    ...scaled,
    columns: maxColumns,
    contentWidth: candidateContentWidth(
      entries,
      maxColumns,
      scaled,
      root.clientWidth,
      fontFamily,
    ),
  }
}

function scheduleFit(): void {
  cancelAnimationFrame(fitRequest)
  fitRequest = requestAnimationFrame(calculateFit)
}

onMounted(async () => {
  await document.fonts.ready
  await nextTick()
  calculateFit()
  if (tocRoot.value) {
    resizeObserver = new ResizeObserver(scheduleFit)
    resizeObserver.observe(tocRoot.value)
  }
})

watch(
  tocData,
  async () => {
    await nextTick()
    scheduleFit()
  },
  { deep: true },
)

onBeforeUnmount(() => {
  cancelAnimationFrame(fitRequest)
  resizeObserver?.disconnect()
})
</script>

<template>
  <BaseLayout main-overflow="hidden">
    <template #main>
      <div ref="tocRoot" class="toc-shell" :style="fitStyle">
        <div class="toc-badge" aria-hidden="true">
          <div class="toc-badge-shadow" />
          <div class="toc-badge-main">目录</div>
        </div>

        <div class="toc-columns">
          <div
            v-for="(column, columnIndex) in tocColumns"
            :key="columnIndex"
            class="toc-column"
          >
            <div
              v-for="item in column"
              :key="item.path ?? item.index"
              class="toc-entry transition-all duration-300"
              :class="
                props.active === null || props.active === item.index + 1
                  ? activeClass
                  : inactiveClass
              "
            >
              <div
                class="toc-number"
                :class="
                  props.active === null || props.active === item.index + 1
                    ? activeBox
                    : inactiveBox
                "
              >
                {{ String(item.index + 1).padStart(2, '0') }}
              </div>

              <div class="toc-copy">
                <h2 class="toc-title">{{ item.title }}</h2>

                <ul v-if="item.children?.length" class="toc-children">
                  <li
                    v-for="child in item.children"
                    :key="child.path ?? child.title"
                  >
                    {{ child.title }}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </BaseLayout>
</template>

<style scoped>
.toc-shell {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--toc-shell-gap);
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: var(--toc-padding-block) var(--toc-padding-inline);
  overflow: hidden;
}

.toc-badge {
  position: relative;
  flex: 0 0 72px;
  width: 72px;
  height: 72px;
}

.toc-badge-shadow {
  position: absolute;
  top: -8px;
  left: -8px;
  width: 64px;
  height: 64px;
  background: #2c5364;
}

.toc-badge-main {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  color: white;
  font-size: 26px;
  font-weight: 700;
  background: #3b99d4;
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
}

.toc-columns {
  display: grid;
  grid-template-columns: repeat(var(--toc-columns), minmax(0, 1fr));
  gap: var(--toc-column-gap);
  align-items: center;
  flex: 0 1 var(--toc-content-width);
  width: var(--toc-content-width);
  min-width: 0;
  min-height: 0;
}

.toc-column {
  display: flex;
  flex-direction: column;
  gap: var(--toc-item-gap);
  min-width: 0;
}

.toc-entry {
  display: flex;
  align-items: flex-start;
  gap: var(--toc-entry-gap);
  min-width: 0;
}

.toc-number {
  display: flex;
  flex: 0 0 var(--toc-number-size);
  align-items: center;
  justify-content: center;
  width: var(--toc-number-size);
  height: var(--toc-number-size);
  color: white;
  font-size: var(--toc-number-font-size);
  font-weight: 700;
}

.toc-copy {
  min-width: 0;
}

.toc-title {
  margin: 0;
  font-size: var(--toc-title-size);
  font-weight: 700;
  line-height: var(--toc-title-line-height);
  overflow-wrap: anywhere;
}

.toc-children {
  display: flex;
  flex-direction: column;
  gap: var(--toc-child-gap);
  margin: var(--toc-child-margin) 0 0;
  padding: 0 0 0 16px;
  border-left: 2px solid rgb(59 153 212 / 0.3);
  font-size: var(--toc-child-size);
  font-weight: 500;
  line-height: var(--toc-child-line-height);
  list-style: none;
}

.toc-children > li {
  min-height: 0;
  padding: 0;
  overflow-wrap: anywhere;
}

.toc-children > li::before {
  content: none;
}
</style>
