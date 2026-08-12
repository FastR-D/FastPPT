<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DEFAULT_DECORS } from '../composables/decor-catalog.mjs'
import { DECOR_TUNING_OVERRIDES } from '../composables/decor-tuning-overrides.mjs'
import { createHttpDecorStore } from '../composables/decor-http-store'
import {
  createDecorWorkbench,
  formatNumber,
  formatRatioRange,
  formatSizeDraft,
  formatSizeRange,
  isStaleDecorSaveError,
  normalizeSizeDraft,
  type DecorPreviewFrame,
  type DecorSizeDraft,
  type DecorVariant,
  type ImageFit,
} from '../composables/decor-workbench'
import { createThemeMedia } from '../composables/theme-media.mjs'
import ImageRenderer from './ImageRenderer.vue'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type ColorOption = {
  label: string
  value: string
  swatch: string
}

const COLOR_OPTIONS: readonly ColorOption[] = Object.freeze([
  { label: 'none', value: '', swatch: 'transparent' },
  { label: 'light-0', value: 'var(--theme-color-light-0)', swatch: '#ffffff' },
  { label: 'light-1', value: 'var(--theme-color-light-1)', swatch: '#f0f0f0' },
  { label: 'dark-0', value: 'var(--theme-color-dark-0)', swatch: '#1e1e1e' },
  { label: 'dark-1', value: 'var(--theme-color-dark-1)', swatch: '#3c3c3c' },
  { label: 'blue-0', value: 'var(--theme-color-blue-0)', swatch: '#027ef2' },
  { label: 'blue-1', value: 'var(--theme-color-blue-1)', swatch: '#98d2fe' },
  { label: 'orange-0', value: 'var(--theme-color-orange-0)', swatch: '#ff6c26' },
  { label: 'orange-1', value: 'var(--theme-color-orange-1)', swatch: '#ffd2bd' },
  { label: 'green-0', value: 'var(--theme-color-green-0)', swatch: '#07ab4b' },
  { label: 'green-1', value: 'var(--theme-color-green-1)', swatch: '#9cddb7' },
  { label: 'red-0', value: 'var(--theme-color-red-0)', swatch: '#e84033' },
  { label: 'yellow-0', value: 'var(--theme-color-yellow-0)', swatch: '#ffd20a' },
])

const FIT_OPTIONS: readonly ImageFit[] = Object.freeze(['contain', 'cover', 'fill', 'none', 'scale-down'])
const ANCHOR_OPTIONS = Object.freeze([
  'center',
  'left top',
  'left center',
  'left bottom',
  'center top',
  'center bottom',
  'right top',
  'right center',
  'right bottom',
])

const workbench = createDecorWorkbench({
  catalog: DEFAULT_DECORS as readonly DecorVariant[],
  overrides: DECOR_TUNING_OVERRIDES as readonly DecorVariant[],
  store: createHttpDecorStore(),
})
const media = createThemeMedia({ baseCatalog: [] })
const query = ref('')
const copied = ref(false)
const saveStatus = ref<SaveStatus>('idle')
const saveError = ref('')

const decorVariants = workbench.variants
const selectedDecor = workbench.selected
const draft = workbench.draft
const previewStyle = workbench.previewStyle
const activePreviewFrameKey = workbench.activePreviewFrameKey
const currentRatio = workbench.currentRatio
const previewFrames = workbench.previewFrames
const selectedMeta = workbench.selectedMeta
const catalogSnippet = workbench.catalogSnippet
const slideSnippet = workbench.slideSnippet

watch(workbench.draftVersion, () => {
  if (saveStatus.value !== 'saved' && saveStatus.value !== 'error')
    return

  saveStatus.value = 'idle'
  saveError.value = ''
})

function includesQuery(decor: DecorVariant, value: string) {
  const normalized = value.trim().toLowerCase()
  if (!normalized)
    return true

  return [
    decor.id,
    decor.src,
    ...(decor.meanings ?? []),
    ...(decor.tones ?? []),
    ...(decor.tags ?? []),
  ].some(item => item.toLowerCase().includes(normalized))
}

const filteredDecors = computed(() => {
  return decorVariants.value.filter(decor => includesQuery(decor, query.value))
})

const filteredDecorItems = computed(() => {
  return filteredDecors.value.map(decor => ({
    decor,
    layer: media.resolveImage({ src: decor.src, ...(decor.image ?? {}) }, decor.id),
  }))
})

const selectedLayer = computed(() => {
  const current = draft.value

  return media.resolveImage({
    src: selectedDecor.value.src,
    fit: current.fit,
    position: formatNumber(current.positionX, 1) + '% ' + formatNumber(current.positionY, 1) + '%',
    anchor: current.anchor,
    x: formatNumber(current.offsetX, 1) + '%',
    y: formatNumber(current.offsetY, 1) + '%',
    zoom: current.zoom,
    rotate: formatNumber(current.rotate, 1) + 'deg',
    color: current.color,
    opacity: current.opacity,
    backgroundColor: current.backgroundColor,
  }, selectedDecor.value.id)
})

const selectedLayerKind = computed(() => selectedLayer.value?.render.kind ?? 'img')

function selectDecor(id: string) {
  workbench.select(id)
  copied.value = false
  saveStatus.value = 'idle'
}

function resetSelected() {
  workbench.reset()
  copied.value = false
  saveStatus.value = 'idle'
}

function applyFrame(size: DecorSizeDraft) {
  workbench.applyFrame(size)
}

function applyPreviewFrame(frame: DecorPreviewFrame) {
  workbench.applyPreviewFrame(frame)
}

function previewFrameStyle(frame: DecorPreviewFrame) {
  return workbench.previewFrameStyle(frame)
}

function addCurrentSize() {
  workbench.addCurrentSize()
  saveStatus.value = 'idle'
}

function removeSize(index: number) {
  workbench.removeSize(index)
  saveStatus.value = 'idle'
}

function setColor(field: 'color' | 'backgroundColor', value: string) {
  draft.value[field] = value
  saveStatus.value = 'idle'
}

async function copySnippet() {
  copied.value = false

  if (!navigator?.clipboard)
    return

  await navigator.clipboard.writeText(catalogSnippet.value + '\n\n' + slideSnippet.value)
  copied.value = true
}

async function saveCurrentDecor() {
  const token = workbench.createSaveToken()

  saveStatus.value = 'saving'
  saveError.value = ''

  try {
    await workbench.save(token)
    if (!workbench.isCurrentSaveToken(token))
      return

    saveStatus.value = 'saved'
  }
  catch (error) {
    if (isStaleDecorSaveError(error) || !workbench.isCurrentSaveToken(token)) {
      if (saveStatus.value === 'saving')
        saveStatus.value = 'idle'
      return
    }

    saveStatus.value = 'error'
    saveError.value = error instanceof Error ? error.message : 'Не удалось сохранить'
  }
}
</script>

<template>
  <div class="DecorLibrary">
    <aside class="DecorLibrary-Browser">
      <div class="DecorLibrary-Header">
        <div>
          <p class="DecorLibrary-Kicker">decor catalog</p>
          <h1>Библиотека декора</h1>
        </div>
        <span>{{ filteredDecors.length }}/{{ decorVariants.length }}</span>
      </div>

      <label class="DecorLibrary-Search">
        <span>Поиск</span>
        <input v-model="query"
               type="search"
               placeholder="id, meaning, tone" />
      </label>

      <div class="DecorLibrary-List">
        <button v-for="item in filteredDecorItems"
                :key="item.decor.id"
                type="button"
                class="DecorLibrary-Item"
                :class="{ 'is-active': item.decor.id === selectedDecor.id }"
                @click="selectDecor(item.decor.id)">
          <span class="DecorLibrary-Thumb">
            <ImageRenderer v-if="item.layer" :layer="item.layer" />
          </span>
          <span class="DecorLibrary-ItemText">
            <strong>{{ item.decor.id }}</strong>
            <small>{{ [...(item.decor.meanings ?? []), ...(item.decor.tones ?? [])].join(' · ') }}</small>
          </span>
        </button>
      </div>
    </aside>

    <main class="DecorLibrary-Stage">
      <div class="DecorLibrary-StageTop">
        <div>
          <p class="DecorLibrary-Kicker">{{ selectedLayerKind === 'mask' ? 'svg mask / recolor' : 'raster / photo' }}</p>
          <h2>{{ selectedDecor.id }}</h2>
        </div>
        <button type="button"
                class="DecorLibrary-Reset"
                @click="resetSelected">
          Сброс
        </button>
      </div>

      <div class="DecorLibrary-PreviewGrid">
        <div class="DecorLibrary-Preview" :style="previewStyle">
          <ImageRenderer v-if="selectedLayer" :layer="selectedLayer" />
        </div>
      </div>

      <div v-if="previewFrames.length > 1" class="DecorLibrary-Variants">
        <div class="DecorLibrary-VariantsHeader">
          <span>Размерные превью</span>
          <span>{{ previewFrames.length }}</span>
        </div>

        <div class="DecorLibrary-VariantList">
          <button v-for="frame in previewFrames"
                  :key="frame.key"
                  type="button"
                  class="DecorLibrary-Variant"
                  :class="{ 'is-active': `${frame.cols}x${frame.rows}` === activePreviewFrameKey }"
                  @click="applyPreviewFrame(frame)">
            <span class="DecorLibrary-VariantGrid">
              <span class="DecorLibrary-VariantPreview" :style="previewFrameStyle(frame)">
                <ImageRenderer v-if="selectedLayer" :layer="selectedLayer" />
              </span>
            </span>
            <span class="DecorLibrary-VariantText">
              <strong>{{ frame.label }}</strong>
              <small>{{ frame.detail }}</small>
            </span>
          </button>
        </div>
      </div>

      <div class="DecorLibrary-Meta">
        <span v-for="item in selectedMeta" :key="item">{{ item }}</span>
      </div>
    </main>

    <aside class="DecorLibrary-Controls">
      <section>
        <h3>Кроп</h3>

        <label>
          <span>fit</span>
          <select v-model="draft.fit">
            <option v-for="fit in FIT_OPTIONS" :key="fit" :value="fit">{{ fit }}</option>
          </select>
        </label>

        <div class="DecorLibrary-ControlRow">
          <label>
            <span>cols</span>
            <input v-model.number="draft.cols"
                   type="number"
                   min="1"
                   max="12"
                   step="1" />
          </label>
          <label>
            <span>rows</span>
            <input v-model.number="draft.rows"
                   type="number"
                   min="1"
                   max="12"
                   step="1" />
          </label>
          <label>
            <span>ratio</span>
            <input :value="currentRatio"
                   type="text"
                   readonly />
          </label>
        </div>

        <div class="DecorLibrary-Sizes">
          <div class="DecorLibrary-SizeHeader">
            <span>Варианты размеров</span>
            <button type="button" @click="addCurrentSize">Добавить текущий</button>
          </div>

          <div v-for="(size, index) in draft.sizes"
               :key="index"
               class="DecorLibrary-SizeRow">
            <div class="DecorLibrary-SizeActions">
              <button type="button"
                      class="DecorLibrary-SizeChip"
                      @click="applyFrame(size)">
                {{ formatSizeDraft(size) }}
              </button>

              <button type="button"
                      class="DecorLibrary-RemoveSize"
                      :disabled="draft.sizes.length <= 1"
                      @click="removeSize(index)">
                Удалить
              </button>
            </div>

            <div class="DecorLibrary-SizeInputs">
              <div class="DecorLibrary-SizeAxis">
                <div class="DecorLibrary-SizeAxisHeader">
                  <span>cols</span>
                  <strong>{{ formatSizeRange(size.colsFrom, size.colsTo) }}</strong>
                </div>
                <div class="DecorLibrary-SizePair">
                  <label>
                    <span>от</span>
                    <input v-model.number="size.colsFrom"
                           type="number"
                           min="1"
                           max="12"
                           step="1"
                           @change="normalizeSizeDraft(size)" />
                  </label>
                  <label>
                    <span>до</span>
                    <input v-model.number="size.colsTo"
                           type="number"
                           min="1"
                           max="12"
                           step="1"
                           @change="normalizeSizeDraft(size)" />
                  </label>
                </div>
              </div>

              <div class="DecorLibrary-SizeAxis">
                <div class="DecorLibrary-SizeAxisHeader">
                  <span>rows</span>
                  <strong>{{ formatSizeRange(size.rowsFrom, size.rowsTo) }}</strong>
                </div>
                <div class="DecorLibrary-SizePair">
                  <label>
                    <span>от</span>
                    <input v-model.number="size.rowsFrom"
                           type="number"
                           min="1"
                           max="12"
                           step="1"
                           @change="normalizeSizeDraft(size)" />
                  </label>
                  <label>
                    <span>до</span>
                    <input v-model.number="size.rowsTo"
                           type="number"
                           min="1"
                           max="12"
                           step="1"
                           @change="normalizeSizeDraft(size)" />
                  </label>
                </div>
              </div>

              <div class="DecorLibrary-SizeAxis">
                <div class="DecorLibrary-SizeAxisHeader">
                  <span>ratio</span>
                  <strong>{{ formatRatioRange(size.ratioFrom, size.ratioTo) || 'auto' }}</strong>
                </div>
                <div class="DecorLibrary-SizePair">
                  <label>
                    <span>от</span>
                    <input v-model.number="size.ratioFrom"
                           type="number"
                           min="0.08"
                           max="12"
                           step="0.01"
                           placeholder="auto"
                           @change="normalizeSizeDraft(size)" />
                  </label>
                  <label>
                    <span>до</span>
                    <input v-model.number="size.ratioTo"
                           type="number"
                           min="0.08"
                           max="12"
                           step="0.01"
                           placeholder="auto"
                           @change="normalizeSizeDraft(size)" />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <label>
          <span>position x: {{ formatNumber(draft.positionX, 1) }}%</span>
          <input v-model.number="draft.positionX"
                 type="range"
                 min="0"
                 max="100"
                 step="0.5" />
        </label>

        <label>
          <span>position y: {{ formatNumber(draft.positionY, 1) }}%</span>
          <input v-model.number="draft.positionY"
                 type="range"
                 min="0"
                 max="100"
                 step="0.5" />
        </label>

        <label>
          <span>zoom: {{ formatNumber(draft.zoom, 2) }}</span>
          <input v-model.number="draft.zoom"
                 type="range"
                 min="0.2"
                 max="6"
                 step="0.01" />
        </label>
      </section>

      <section>
        <h3>Трансформация</h3>

        <label>
          <span>anchor</span>
          <select v-model="draft.anchor">
            <option v-for="anchor in ANCHOR_OPTIONS" :key="anchor" :value="anchor">{{ anchor }}</option>
          </select>
        </label>

        <label>
          <span>x: {{ formatNumber(draft.offsetX, 1) }}%</span>
          <input v-model.number="draft.offsetX"
                 type="range"
                 min="-120"
                 max="120"
                 step="0.5" />
        </label>

        <label>
          <span>y: {{ formatNumber(draft.offsetY, 1) }}%</span>
          <input v-model.number="draft.offsetY"
                 type="range"
                 min="-120"
                 max="120"
                 step="0.5" />
        </label>

        <label>
          <span>rotate: {{ formatNumber(draft.rotate, 1) }}deg</span>
          <input v-model.number="draft.rotate"
                 type="range"
                 min="-180"
                 max="180"
                 step="0.5" />
        </label>

        <label>
          <span>opacity: {{ formatNumber(draft.opacity, 2) }}</span>
          <input v-model.number="draft.opacity"
                 type="range"
                 min="0"
                 max="1"
                 step="0.01" />
        </label>
      </section>

      <section>
        <h3>Цвета</h3>

        <div class="DecorLibrary-Palette">
          <button v-for="option in COLOR_OPTIONS"
                  :key="`color-${option.label}`"
                  type="button"
                  :class="{ 'is-active': draft.color === option.value }"
                  :title="`color: ${option.label}`"
                  @click="setColor('color', option.value)">
            <span :style="{ background: option.swatch }" />
          </button>
        </div>

        <label>
          <span>color</span>
          <input v-model="draft.color" type="text" placeholder="var(--theme-color-blue-0)" />
        </label>

        <div class="DecorLibrary-Palette">
          <button v-for="option in COLOR_OPTIONS"
                  :key="`bg-${option.label}`"
                  type="button"
                  :class="{ 'is-active': draft.backgroundColor === option.value }"
                  :title="`background: ${option.label}`"
                  @click="setColor('backgroundColor', option.value)">
            <span :style="{ background: option.swatch }" />
          </button>
        </div>

        <label>
          <span>backgroundColor</span>
          <input v-model="draft.backgroundColor" type="text" placeholder="var(--theme-color-orange-1)" />
        </label>
      </section>

      <section>
        <h3>Вывод</h3>
        <textarea :value="`${catalogSnippet}\n\n${slideSnippet}`" readonly />
        <button type="button"
                class="DecorLibrary-Save"
                :disabled="saveStatus === 'saving'"
                @click="saveCurrentDecor">
          {{ saveStatus === 'saving' ? 'Сохраняю' : 'Сохранить в overrides' }}
        </button>
        <button type="button"
                class="DecorLibrary-Copy"
                @click="copySnippet">
          {{ copied ? 'Скопировано' : 'Копировать' }}
        </button>
        <p v-if="saveStatus === 'saved'" class="DecorLibrary-SaveStatus">
          Сохранено в composables/decor-tuning-overrides.mjs
        </p>
        <p v-else-if="saveStatus === 'error'" class="DecorLibrary-SaveStatus DecorLibrary-SaveStatus_error">
          {{ saveError }}
        </p>
      </section>
    </aside>
  </div>
</template>

<style scoped>
.DecorLibrary {
  --decor-space-1: var(--theme-grid-module);
  --decor-space-2: calc(var(--theme-grid-module) * 2);
  --decor-space-3: calc(var(--theme-grid-module) * 3);
  --decor-space-4: calc(var(--theme-grid-module) * 4);
  --decor-space-5: calc(var(--theme-grid-module) * 5);
  --decor-browser-width: calc(var(--theme-grid-module) * 52);
  --decor-control-width: calc(var(--theme-grid-module) * 58);
  --decor-stage-title-width: calc(var(--theme-grid-module) * 90);
  --decor-thumb-size: calc(var(--theme-grid-module) * 10);
  --decor-grid-size: calc(var(--theme-grid-module) * 8);
  --decor-variant-grid-size: calc(var(--theme-grid-module) * 13);
  --decor-pill-radius: calc(var(--theme-grid-module) * 10);
  --decor-swatch-button: calc(var(--theme-grid-module) * 4);
  --decor-swatch: calc(var(--theme-grid-module) * 2);

  grid-column: 1 / -1;
  grid-row: 1 / -1;
  display: grid;
  grid-template-columns: var(--decor-browser-width) minmax(0, 1fr) var(--decor-control-width);
  gap: var(--decor-space-3);
  width: 100%;
  height: 100%;
  padding: var(--decor-space-5);
  background: var(--theme-color-light-1);
  color: var(--theme-text);
  font-size: var(--theme-text-size-0);
  line-height: var(--theme-text-line-0);
}

.DecorLibrary,
.DecorLibrary * {
  box-sizing: border-box;
}

.DecorLibrary-Browser,
.DecorLibrary-Stage,
.DecorLibrary-Controls {
  min-height: 0;
  border: var(--theme-stroke-thin) solid var(--theme-border-subtle);
  border-radius: var(--theme-grid-module);
  background: var(--theme-color-light-0);
}

.DecorLibrary-Browser,
.DecorLibrary-Controls {
  display: flex;
  flex-direction: column;
}

.DecorLibrary-Header,
.DecorLibrary-StageTop {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--decor-space-2);
  padding: var(--decor-space-3);
  border-bottom: var(--theme-stroke-thin) solid var(--theme-border-subtle);
}

.DecorLibrary-Header h1,
.DecorLibrary-StageTop h2,
.DecorLibrary-Controls h3 {
  margin: 0;
  color: var(--theme-text);
  font-size: var(--theme-text-size-2);
  line-height: var(--theme-text-line-2);
  font-weight: 400;
}

.DecorLibrary-StageTop h2 {
  max-width: var(--decor-stage-title-width);
  overflow-wrap: anywhere;
  font-size: var(--theme-text-size-3);
}

.DecorLibrary-Controls h3 {
  font-size: var(--theme-text-size-1);
}

.DecorLibrary-Kicker {
  margin: 0 0 var(--decor-space-1);
  color: var(--theme-text-muted);
  font-size: var(--theme-text-size-0);
  text-transform: uppercase;
}

.DecorLibrary-Header > span {
  padding: var(--decor-space-1) var(--decor-space-2);
  border: var(--theme-stroke-thin) solid var(--theme-border-subtle);
  border-radius: var(--decor-pill-radius);
  color: var(--theme-text-muted);
  font-size: var(--theme-text-size-0);
}

.DecorLibrary-Search {
  display: grid;
  gap: var(--decor-space-1);
  padding: var(--decor-space-2) var(--decor-space-3);
  border-bottom: var(--theme-stroke-thin) solid var(--theme-border-subtle);
}

.DecorLibrary-Search span,
.DecorLibrary-Controls label span {
  color: var(--theme-text-muted);
  font-size: var(--theme-text-size-0);
}

.DecorLibrary input,
.DecorLibrary select,
.DecorLibrary textarea {
  width: 100%;
  min-width: 0;
  border: var(--theme-stroke-thin) solid var(--theme-border-subtle);
  border-radius: var(--theme-grid-module);
  background: var(--theme-color-light-0);
  color: var(--theme-text);
  font: inherit;
}

.DecorLibrary input,
.DecorLibrary select {
  height: var(--decor-space-5);
  padding: 0 var(--decor-space-1);
}

.DecorLibrary input[type='range'] {
  padding: 0;
  border: 0;
}

.DecorLibrary textarea {
  min-height: calc(var(--theme-grid-module) * 20);
  padding: var(--decor-space-2);
  resize: none;
  font-family: var(--theme-font-mono);
  font-size: var(--theme-text-size-0);
  line-height: var(--theme-text-line-0);
}

.DecorLibrary button {
  border: 0;
  font: inherit;
  cursor: pointer;
}

.DecorLibrary button:disabled {
  cursor: default;
  opacity: 0.45;
}

.DecorLibrary-List {
  display: grid;
  gap: var(--decor-space-1);
  min-height: 0;
  padding: var(--decor-space-2);
  overflow: auto;
}

.DecorLibrary-Item {
  display: grid;
  grid-template-columns: var(--decor-thumb-size) minmax(0, 1fr);
  gap: var(--decor-space-2);
  align-items: center;
  padding: var(--decor-space-1);
  border: var(--theme-stroke-thin) solid transparent;
  border-radius: var(--theme-grid-module);
  background: transparent;
  color: inherit;
  text-align: left;
}

.DecorLibrary-Item.is-active {
  border-color: var(--theme-color-blue-0);
  background: color-mix(in srgb, var(--theme-color-blue-1) 22%, transparent);
}

.DecorLibrary-Thumb {
  display: block;
  width: var(--decor-thumb-size);
  aspect-ratio: 1;
  overflow: hidden;
  border: var(--theme-stroke-thin) solid var(--theme-border-subtle);
  border-radius: var(--theme-grid-module);
  background:
    linear-gradient(45deg, color-mix(in srgb, var(--theme-color-dark-2) 15%, transparent) 25%, transparent 25%),
    linear-gradient(-45deg, color-mix(in srgb, var(--theme-color-dark-2) 15%, transparent) 25%, transparent 25%),
    var(--theme-color-light-1);
  background-position: 0 0, 0 var(--decor-space-2);
  background-size: var(--decor-space-4) var(--decor-space-4);
}

.DecorLibrary-ItemText {
  display: grid;
  min-width: 0;
  gap: var(--decor-space-1);
}

.DecorLibrary-ItemText strong,
.DecorLibrary-ItemText small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.DecorLibrary-ItemText strong {
  font-weight: 400;
}

.DecorLibrary-ItemText small {
  color: var(--theme-text-muted);
  font-size: var(--theme-text-size-0);
}

.DecorLibrary-Stage {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  min-width: 0;
}

.DecorLibrary-Reset,
.DecorLibrary-Copy,
.DecorLibrary-Save {
  height: var(--decor-space-5);
  padding: 0 var(--decor-space-2);
  border-radius: var(--theme-grid-module);
  background: var(--theme-color-dark-0);
  color: var(--theme-color-light-0);
}

.DecorLibrary-Copy {
  background: var(--theme-color-light-1);
  color: var(--theme-text);
}

.DecorLibrary-PreviewGrid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-template-rows: repeat(12, minmax(0, 1fr));
  gap: var(--theme-grid-gap);
  min-height: 0;
  padding: var(--decor-space-5);
  background:
    linear-gradient(var(--theme-border-subtle) var(--theme-stroke-thin), transparent var(--theme-stroke-thin)),
    linear-gradient(90deg, var(--theme-border-subtle) var(--theme-stroke-thin), transparent var(--theme-stroke-thin)),
    var(--theme-color-light-0);
  background-size: var(--decor-grid-size) var(--decor-grid-size);
}

.DecorLibrary-Preview {
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: var(--theme-stroke-thin) solid var(--theme-color-dark-0);
  border-radius: var(--theme-grid-module);
  background: var(--theme-color-light-1);
}

.DecorLibrary-Variants {
  display: grid;
  gap: var(--decor-space-2);
  padding: var(--decor-space-2) var(--decor-space-3);
  border-top: var(--theme-stroke-thin) solid var(--theme-border-subtle);
}

.DecorLibrary-VariantsHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--decor-space-2);
  color: var(--theme-text-muted);
  font-size: var(--theme-text-size-0);
}

.DecorLibrary-VariantList {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(calc(var(--theme-grid-module) * 24), 1fr));
  gap: var(--decor-space-1);
  max-height: calc(var(--theme-grid-module) * 24);
  overflow: auto;
}

.DecorLibrary-Variant {
  display: grid;
  grid-template-columns: var(--decor-variant-grid-size) minmax(0, 1fr);
  gap: var(--decor-space-2);
  align-items: center;
  min-width: 0;
  padding: var(--decor-space-1);
  border: var(--theme-stroke-thin) solid var(--theme-border-subtle);
  border-radius: var(--theme-grid-module);
  background: var(--theme-color-light-0);
  color: inherit;
  text-align: left;
}

.DecorLibrary-Variant.is-active {
  border-color: var(--theme-color-blue-0);
  background: color-mix(in srgb, var(--theme-color-blue-1) 18%, transparent);
}

.DecorLibrary-VariantGrid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-template-rows: repeat(12, minmax(0, 1fr));
  gap: var(--theme-stroke-thin);
  width: var(--decor-variant-grid-size);
  aspect-ratio: 1;
  padding: var(--decor-space-1);
  border: var(--theme-stroke-thin) solid var(--theme-border-subtle);
  border-radius: var(--theme-grid-module);
  background:
    linear-gradient(var(--theme-border-subtle) var(--theme-stroke-thin), transparent var(--theme-stroke-thin)),
    linear-gradient(90deg, var(--theme-border-subtle) var(--theme-stroke-thin), transparent var(--theme-stroke-thin)),
    var(--theme-color-light-1);
  background-size: var(--decor-space-2) var(--decor-space-2);
}

.DecorLibrary-VariantPreview {
  display: block;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: var(--theme-stroke-thin) solid var(--theme-color-dark-0);
  border-radius: var(--theme-grid-module);
  background: var(--theme-color-light-0);
}

.DecorLibrary-VariantText {
  display: grid;
  min-width: 0;
  gap: var(--decor-space-1);
}

.DecorLibrary-VariantText strong,
.DecorLibrary-VariantText small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.DecorLibrary-VariantText strong {
  font-weight: 400;
}

.DecorLibrary-VariantText small {
  color: var(--theme-text-muted);
  font-size: var(--theme-text-size-0);
}

.DecorLibrary-Meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--decor-space-1);
  padding: var(--decor-space-2) var(--decor-space-3);
  border-top: var(--theme-stroke-thin) solid var(--theme-border-subtle);
}

.DecorLibrary-Meta span,
.DecorLibrary-SizeChip,
.DecorLibrary-SizeHeader button,
.DecorLibrary-RemoveSize {
  padding: var(--decor-space-1) var(--decor-space-2);
  border: var(--theme-stroke-thin) solid var(--theme-border-subtle);
  border-radius: var(--decor-pill-radius);
  background: transparent;
  color: var(--theme-text-muted);
  font-size: var(--theme-text-size-0);
}

.DecorLibrary-Controls {
  gap: var(--decor-space-2);
  padding: var(--decor-space-3);
  overflow: auto;
}

.DecorLibrary-Controls section {
  display: grid;
  gap: var(--decor-space-2);
  padding-bottom: var(--decor-space-2);
  border-bottom: var(--theme-stroke-thin) solid var(--theme-border-subtle);
}

.DecorLibrary-Controls section:last-child {
  border-bottom: 0;
}

.DecorLibrary-Controls label {
  display: grid;
  gap: var(--decor-space-1);
}

.DecorLibrary-ControlRow {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--decor-space-1);
}

.DecorLibrary-ControlRow input[readonly] {
  background: var(--theme-color-light-1);
  color: var(--theme-text-muted);
}

.DecorLibrary-Sizes,
.DecorLibrary-Palette {
  display: flex;
  flex-wrap: wrap;
  gap: var(--decor-space-1);
}

.DecorLibrary-Sizes {
  display: grid;
}

.DecorLibrary-SizeHeader,
.DecorLibrary-SizeRow {
  display: grid;
  gap: var(--decor-space-1);
}

.DecorLibrary-SizeHeader {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.DecorLibrary-SizeHeader span {
  color: var(--theme-text-muted);
}

.DecorLibrary-SizeRow {
  padding: var(--decor-space-2);
  border: var(--theme-stroke-thin) solid var(--theme-border-subtle);
  border-radius: var(--theme-grid-module);
  background: var(--theme-color-light-1);
}

.DecorLibrary-SizeActions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--decor-space-1);
  align-items: center;
}

.DecorLibrary-SizeInputs {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--decor-space-1);
}

.DecorLibrary-SizeAxis {
  display: grid;
  grid-template-columns: calc(var(--theme-grid-module) * 12) minmax(0, 1fr);
  gap: var(--decor-space-1);
  align-items: end;
  min-width: 0;
  padding: var(--decor-space-1);
  border: var(--theme-stroke-thin) solid var(--theme-border-subtle);
  border-radius: var(--theme-grid-module);
  background: var(--theme-color-light-0);
}

.DecorLibrary-SizeAxisHeader {
  display: grid;
  gap: var(--decor-space-1);
}

.DecorLibrary-SizeAxisHeader span {
  color: var(--theme-text-muted);
  font-size: var(--theme-text-size-0);
}

.DecorLibrary-SizeAxisHeader strong {
  color: var(--theme-text);
  font-family: var(--theme-font-mono);
  font-size: var(--theme-text-size-0);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.DecorLibrary-SizePair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--decor-space-1);
}

.DecorLibrary-SizePair label {
  min-width: 0;
}

.DecorLibrary-SizePair input {
  padding: 0 var(--decor-space-2);
  font-family: var(--theme-font-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.DecorLibrary-SizePair input::-webkit-inner-spin-button,
.DecorLibrary-SizePair input::-webkit-outer-spin-button {
  margin: 0;
}

.DecorLibrary-SizeChip,
.DecorLibrary-SizeHeader button,
.DecorLibrary-RemoveSize {
  background: transparent;
}

.DecorLibrary-SaveStatus {
  margin: 0;
  color: var(--theme-text-muted);
  font-size: var(--theme-text-size-0);
}

.DecorLibrary-SaveStatus_error {
  color: var(--theme-color-red-0);
}

.DecorLibrary-Palette button {
  display: grid;
  place-items: center;
  width: var(--decor-swatch-button);
  height: var(--decor-swatch-button);
  border: var(--theme-stroke-thin) solid var(--theme-border-subtle);
  border-radius: var(--theme-grid-module);
  background: var(--theme-color-light-0);
}

.DecorLibrary-Palette button.is-active {
  border-color: var(--theme-color-blue-0);
  box-shadow: inset 0 0 0 calc(var(--theme-stroke-thin) * 2) var(--theme-color-blue-0);
}

.DecorLibrary-Palette span {
  width: var(--decor-swatch);
  height: var(--decor-swatch);
  border: var(--theme-stroke-thin) solid var(--theme-border-subtle);
  border-radius: var(--decor-pill-radius);
}
</style>
