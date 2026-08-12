import { computed, reactive, ref, watch } from 'vue'
import type {
  DecorImage,
  DecorSize,
  DecorStore,
  DecorVariant,
  ImageFit,
  RatioRange,
  SizeRange,
} from './decor-store'

export type {
  DecorImage,
  DecorSize,
  DecorStore,
  DecorVariant,
  ImageFit,
  RatioRange,
  SizeRange,
} from './decor-store'

export type DecorSizeDraft = {
  colsFrom: number
  colsTo: number
  rowsFrom: number
  rowsTo: number
  ratioFrom: number | null
  ratioTo: number | null
}
export type DecorDraft = {
  cols: number
  rows: number
  sizes: DecorSizeDraft[]
  fit: ImageFit
  positionX: number
  positionY: number
  anchor: string
  offsetX: number
  offsetY: number
  zoom: number
  rotate: number
  opacity: number
  color: string
  backgroundColor: string
}
export type DecorPreviewFrame = {
  key: string
  cols: number
  rows: number
  label: string
  detail: string
  sizeIndex: number
}
export type DecorSaveToken = {
  selectedId: string
  version: number
}
type DecorFrameCandidate = {
  cols: number
  rows: number
  area: number
  ratio: number
  score: number
}
type DecorPreviewStyle = {
  gridColumn: string
  gridRow: string
}

const EMPTY_DECOR: DecorVariant = Object.freeze({
  id: '',
  src: '',
})

export class StaleDecorSaveError extends Error {
  constructor() {
    super('Decor save is stale')
    this.name = 'StaleDecorSaveError'
  }
}

export function isStaleDecorSaveError(error: unknown): error is StaleDecorSaveError {
  return error instanceof StaleDecorSaveError
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function formatNumber(value: number, precision = 2) {
  const normalized = Number(value.toFixed(precision))
  return Object.is(normalized, -0) ? 0 : normalized
}

export function normalizeGridValue(value: unknown, fallback: number) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized))
    return fallback

  return clamp(Math.round(normalized), 1, 12)
}

export function normalizeGridRange(from: unknown, to: unknown, fallback: number): [number, number] {
  const normalizedFrom = normalizeGridValue(from, fallback)
  const normalizedTo = normalizeGridValue(to, normalizedFrom)

  return normalizedFrom <= normalizedTo
    ? [normalizedFrom, normalizedTo]
    : [normalizedTo, normalizedFrom]
}

export function normalizeRatioValue(value: unknown) {
  const normalized = Number(value)

  if (!Number.isFinite(normalized) || normalized <= 0)
    return null

  return clamp(formatNumber(normalized, 2), 0.08, 12)
}

export function normalizeRatioRange(from: unknown, to: unknown): [number | null, number | null] {
  const normalizedFrom = normalizeRatioValue(from)
  const normalizedTo = normalizeRatioValue(to)

  if (normalizedFrom === null && normalizedTo === null)
    return [null, null]

  const fromValue = normalizedFrom ?? normalizedTo ?? 1
  const toValue = normalizedTo ?? normalizedFrom ?? 1

  return fromValue <= toValue
    ? [fromValue, toValue]
    : [toValue, fromValue]
}

function rangeBounds(value: SizeRange | undefined, fallback: number): [number, number] {
  if (typeof value === 'number') {
    const normalized = normalizeGridValue(value, fallback)
    return [normalized, normalized]
  }

  if (!Array.isArray(value))
    return [fallback, fallback]

  return normalizeGridRange(value[0], value[1], fallback)
}

function ratioBounds(value: RatioRange | undefined): [number | null, number | null] {
  if (typeof value === 'number') {
    const normalized = normalizeRatioValue(value)
    return [normalized, normalized]
  }

  if (!Array.isArray(value))
    return [null, null]

  return normalizeRatioRange(value[0], value[1])
}

function rangePreviewValue(value: SizeRange | undefined, fallback: number) {
  const [from, to] = rangeBounds(value, fallback)
  return normalizeGridValue((from + to) / 2, fallback)
}

export function createSizeDraft(size: DecorSize | undefined, fallbackCols = 4, fallbackRows = 4): DecorSizeDraft {
  const [colsFrom, colsTo] = rangeBounds(size?.cols, fallbackCols)
  const [rowsFrom, rowsTo] = rangeBounds(size?.rows, fallbackRows)
  const [ratioFrom, ratioTo] = ratioBounds(size?.ratio ?? size?.aspectRatio)

  return { colsFrom, colsTo, rowsFrom, rowsTo, ratioFrom, ratioTo }
}

export function normalizeSizeDraft(size: DecorSizeDraft) {
  const [colsFrom, colsTo] = normalizeGridRange(size.colsFrom, size.colsTo, 4)
  const [rowsFrom, rowsTo] = normalizeGridRange(size.rowsFrom, size.rowsTo, 4)
  const [ratioFrom, ratioTo] = normalizeRatioRange(size.ratioFrom, size.ratioTo)

  size.colsFrom = colsFrom
  size.colsTo = colsTo
  size.rowsFrom = rowsFrom
  size.rowsTo = rowsTo
  size.ratioFrom = ratioFrom
  size.ratioTo = ratioTo
}

export function formatSizeRange(from: number, to: number) {
  return from === to ? String(from) : `${from}-${to}`
}

export function formatRatioRange(from: number | null, to: number | null) {
  if (from === null || to === null)
    return ''

  return from === to ? String(from) : `${from}-${to}`
}

export function formatSizeDraft(size: DecorSizeDraft) {
  const ratio = formatRatioRange(size.ratioFrom, size.ratioTo)
  const dimensions = `${formatSizeRange(size.colsFrom, size.colsTo)}x${formatSizeRange(size.rowsFrom, size.rowsTo)}`

  return ratio ? `${dimensions} · r ${ratio}` : dimensions
}

function rangeToDecorValue(from: number, to: number): SizeRange {
  return from === to ? from : [from, to]
}

function ratioToDecorValue(from: number | null, to: number | null): RatioRange | null {
  if (from === null || to === null)
    return null

  return from === to ? from : [from, to]
}

function formatDecorRange(from: number, to: number) {
  const value = rangeToDecorValue(from, to)
  return Array.isArray(value) ? `[${value.join(', ')}]` : String(value)
}

function formatDecorRatio(from: number | null, to: number | null) {
  const value = ratioToDecorValue(from, to)

  if (value === null)
    return ''

  return Array.isArray(value) ? `[${value.join(', ')}]` : String(value)
}

function formatDecorSize(size: DecorSizeDraft) {
  const normalized = normalizeDecorSizeDraft(size)

  const fields = [
    `cols: ${formatDecorRange(normalized.colsFrom, normalized.colsTo)}`,
    `rows: ${formatDecorRange(normalized.rowsFrom, normalized.rowsTo)}`,
  ]
  const ratio = formatDecorRatio(normalized.ratioFrom, normalized.ratioTo)

  if (ratio)
    fields.push(`ratio: ${ratio}`)

  return `{ ${fields.join(', ')} }`
}

function axisTokenToPercent(token: string, axis: 'x' | 'y') {
  const normalized = token.trim().toLowerCase()
  const percent = Number(normalized.replace('%', ''))

  if (normalized.endsWith('%') && Number.isFinite(percent))
    return clamp(percent, 0, 100)

  if (normalized === 'center')
    return 50

  if (axis === 'x') {
    if (normalized === 'left')
      return 0
    if (normalized === 'right')
      return 100
  }

  if (normalized === 'top')
    return 0
  if (normalized === 'bottom')
    return 100

  return 50
}

function parsePosition(position: unknown): [number, number] {
  if (typeof position !== 'string')
    return [50, 50]

  const tokens = position.trim().split(/\s+/u).filter(Boolean)
  if (tokens.length === 0)
    return [50, 50]

  if (tokens.length === 1) {
    const token = tokens[0]
    if (token === 'top' || token === 'bottom')
      return [50, axisTokenToPercent(token, 'y')]

    return [axisTokenToPercent(token, 'x'), 50]
  }

  return [axisTokenToPercent(tokens[0], 'x'), axisTokenToPercent(tokens[1], 'y')]
}

function parseNumeric(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === '')
    return fallback

  const normalized = Number(String(value).replace(/deg|px|%/gu, '').trim())
  return Number.isFinite(normalized) ? normalized : fallback
}

function cloneSizeDraft(size: DecorSizeDraft): DecorSizeDraft {
  return { ...size }
}

function normalizeDecorSizeDraft(size: DecorSizeDraft): DecorSizeDraft {
  const normalized = cloneSizeDraft(size)
  normalizeSizeDraft(normalized)

  return normalized
}

function matchesRatio(cols: number, rows: number, size: DecorSizeDraft) {
  if (size.ratioFrom === null || size.ratioTo === null)
    return true

  const ratio = cols / rows
  return ratio >= size.ratioFrom && ratio <= size.ratioTo
}

function sizeDraftFrame(size: DecorSizeDraft, fallbackCols: number, fallbackRows: number) {
  normalizeSizeDraft(size)

  const centerCols = (size.colsFrom + size.colsTo) / 2
  const centerRows = (size.rowsFrom + size.rowsTo) / 2
  const centerRatio = size.ratioFrom !== null && size.ratioTo !== null
    ? (size.ratioFrom + size.ratioTo) / 2
    : centerCols / centerRows
  let best = {
    cols: rangePreviewValue([size.colsFrom, size.colsTo], fallbackCols),
    rows: rangePreviewValue([size.rowsFrom, size.rowsTo], fallbackRows),
    score: Number.POSITIVE_INFINITY,
  }

  for (let cols = size.colsFrom; cols <= size.colsTo; cols += 1) {
    for (let rows = size.rowsFrom; rows <= size.rowsTo; rows += 1) {
      if (!matchesRatio(cols, rows, size))
        continue

      const score = Math.abs(cols - centerCols)
        + Math.abs(rows - centerRows)
        + Math.abs(cols / rows - centerRatio)

      if (score < best.score)
        best = { cols, rows, score }
    }
  }

  return {
    cols: best.cols,
    rows: best.rows,
  }
}

function createSizeFrameCandidates(size: DecorSizeDraft) {
  const normalized = cloneSizeDraft(size)
  normalizeSizeDraft(normalized)

  const centerCols = (normalized.colsFrom + normalized.colsTo) / 2
  const centerRows = (normalized.rowsFrom + normalized.rowsTo) / 2
  const centerRatio = normalized.ratioFrom !== null && normalized.ratioTo !== null
    ? (normalized.ratioFrom + normalized.ratioTo) / 2
    : centerCols / centerRows
  const candidates: DecorFrameCandidate[] = []

  for (let cols = normalized.colsFrom; cols <= normalized.colsTo; cols += 1) {
    for (let rows = normalized.rowsFrom; rows <= normalized.rowsTo; rows += 1) {
      if (!matchesRatio(cols, rows, normalized))
        continue

      const ratio = cols / rows
      candidates.push({
        cols,
        rows,
        area: cols * rows,
        ratio,
        score: Math.abs(cols - centerCols) + Math.abs(rows - centerRows) + Math.abs(ratio - centerRatio),
      })
    }
  }

  return candidates
}

function sizePreviewCandidates(size: DecorSizeDraft) {
  const candidates = createSizeFrameCandidates(size)

  if (candidates.length === 0) {
    const frame = sizeDraftFrame(cloneSizeDraft(size), 4, 4)
    return [{ ...frame, area: frame.cols * frame.rows, ratio: frame.cols / frame.rows, score: 0 }]
  }

  return candidates.sort((a, b) => a.area - b.area || a.ratio - b.ratio || a.cols - b.cols || a.rows - b.rows)
}

function firstFrame(decor: DecorVariant) {
  const size = decor.sizes?.[0] ?? {}
  const draft = createSizeDraft(size, 4, 4)

  return sizeDraftFrame(draft, 4, 4)
}

function createSizeDrafts(decor: DecorVariant) {
  const frame = firstFrame(decor)
  const sizes = decor.sizes ?? []

  return sizes.length
    ? sizes.map(size => createSizeDraft(size, frame.cols, frame.rows))
    : [createSizeDraft({ cols: frame.cols, rows: frame.rows }, frame.cols, frame.rows)]
}

function createDraft(decor: DecorVariant): DecorDraft {
  const image = decor.image ?? {}
  const [positionX, positionY] = parsePosition(image.position)
  const frame = firstFrame(decor)

  return {
    cols: frame.cols,
    rows: frame.rows,
    sizes: createSizeDrafts(decor),
    fit: image.fit ?? 'contain',
    positionX,
    positionY,
    anchor: image.anchor ?? 'center',
    offsetX: parseNumeric(image.x, 0),
    offsetY: parseNumeric(image.y, 0),
    zoom: parseNumeric(image.zoom, 1),
    rotate: parseNumeric(image.rotate, 0),
    opacity: clamp(parseNumeric(image.opacity, 1), 0, 1),
    color: image.color ?? '',
    backgroundColor: image.backgroundColor ?? '',
  }
}

function normalizeList(value: unknown) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean)
    : []
}

function normalizeCatalogVariant(variant: DecorVariant) {
  const normalized: DecorVariant = {
    ...variant,
    id: variant.id.trim(),
  }

  if ((!Array.isArray(normalized.sizes) || normalized.sizes.length === 0)
    && normalized.cols !== undefined
    && normalized.rows !== undefined) {
    normalized.sizes = [{
      cols: normalized.cols,
      rows: normalized.rows,
      ratio: normalized.ratio ?? normalized.aspectRatio,
    }]
  }

  if (normalized.sizes) {
    normalized.sizes = normalized.sizes.map((size) => {
      const next = { ...size }
      next.ratio ??= next.aspectRatio
      delete next.aspectRatio

      return next
    })
  }

  if (normalizeList(normalized.meanings).length === 0 && typeof normalized.meaning === 'string' && normalized.meaning.trim())
    normalized.meanings = [normalized.meaning.trim()]

  if (normalizeList(normalized.tones).length === 0 && typeof normalized.tone === 'string' && normalized.tone.trim())
    normalized.tones = [normalized.tone.trim()]

  const toneTags = normalizeList(normalized.tones)
  const explicitTags = normalizeList(normalized.tags)
  normalized.tags = [...new Set([...explicitTags, ...toneTags])]

  return normalized
}

function mergeDecorVariants(catalog: readonly DecorVariant[], overrides: readonly DecorVariant[]) {
  const variantsById = new Map<string, DecorVariant>()

  for (const variant of [...catalog, ...overrides]) {
    if (!variant?.id?.trim())
      continue

    variantsById.set(variant.id.trim(), normalizeCatalogVariant(variant))
  }

  return [...variantsById.values()]
}

function getImagePatch(current: DecorDraft): DecorImage {
  return {
    fit: current.fit,
    position: `${formatNumber(current.positionX, 1)}% ${formatNumber(current.positionY, 1)}%`,
    anchor: current.anchor,
    x: `${formatNumber(current.offsetX, 1)}%`,
    y: `${formatNumber(current.offsetY, 1)}%`,
    zoom: formatNumber(current.zoom, 2),
    rotate: `${formatNumber(current.rotate, 1)}deg`,
    color: current.color,
    opacity: formatNumber(current.opacity, 2),
    backgroundColor: current.backgroundColor,
  }
}

function buildOverrideVariant(decor: DecorVariant, current: DecorDraft): DecorVariant {
  const sizes = current.sizes.map((size) => {
    const normalized = normalizeDecorSizeDraft(size)
    const ratio = ratioToDecorValue(normalized.ratioFrom, normalized.ratioTo)
    const nextSize: DecorSize = {
      cols: rangeToDecorValue(normalized.colsFrom, normalized.colsTo),
      rows: rangeToDecorValue(normalized.rowsFrom, normalized.rowsTo),
    }

    if (ratio !== null)
      nextSize.ratio = ratio

    return nextSize
  })

  return {
    id: decor.id,
    src: decor.src,
    meanings: [...(decor.meanings ?? [])],
    tones: [...(decor.tones ?? [])],
    tags: [...(decor.tags ?? [])],
    sizes,
    image: getImagePatch(current),
  }
}

export function createPreviewStyle(colsInput: unknown, rowsInput: unknown): DecorPreviewStyle {
  const cols = normalizeGridValue(colsInput, 4)
  const rows = normalizeGridValue(rowsInput, 4)
  const colStart = Math.floor((12 - cols) / 2) + 1
  const rowStart = Math.floor((12 - rows) / 2) + 1

  return {
    gridColumn: `${colStart} / span ${cols}`,
    gridRow: `${rowStart} / span ${rows}`,
  }
}

export function createDecorWorkbench(input: {
  catalog: readonly DecorVariant[]
  overrides: readonly DecorVariant[]
  store: DecorStore
}) {
  const overrides = ref<DecorVariant[]>([...input.overrides])
  const selectedId = ref(input.catalog[0]?.id ?? input.overrides[0]?.id ?? '')
  const drafts = reactive<Record<string, DecorDraft>>({})
  const variants = computed(() => mergeDecorVariants(input.catalog, overrides.value))
  const selected = computed(() => {
    return variants.value.find(decor => decor.id === selectedId.value) ?? variants.value[0] ?? EMPTY_DECOR
  })
  const draft = computed(() => {
    const decor = selected.value
    drafts[decor.id] ??= createDraft(decor)
    return drafts[decor.id]
  })
  const draftSignature = computed(() => {
    const current = draft.value

    return JSON.stringify({
      selectedId: selected.value.id,
      cols: current.cols,
      rows: current.rows,
      sizes: current.sizes.map(size => ({
        colsFrom: size.colsFrom,
        colsTo: size.colsTo,
        rowsFrom: size.rowsFrom,
        rowsTo: size.rowsTo,
        ratioFrom: size.ratioFrom,
        ratioTo: size.ratioTo,
      })),
      fit: current.fit,
      positionX: current.positionX,
      positionY: current.positionY,
      anchor: current.anchor,
      offsetX: current.offsetX,
      offsetY: current.offsetY,
      zoom: current.zoom,
      rotate: current.rotate,
      opacity: current.opacity,
      color: current.color,
      backgroundColor: current.backgroundColor,
    })
  })
  const draftVersion = ref(0)
  let saveTail: Promise<unknown> | null = null

  watch(draftSignature, () => {
    draftVersion.value += 1
  }, { flush: 'sync' })

  const previewStyle = computed(() => {
    return createPreviewStyle(draft.value.cols, draft.value.rows)
  })
  const activePreviewFrameKey = computed(() => {
    return `${normalizeGridValue(draft.value.cols, 4)}x${normalizeGridValue(draft.value.rows, 4)}`
  })
  const currentRatio = computed(() => {
    const cols = normalizeGridValue(draft.value.cols, 4)
    const rows = normalizeGridValue(draft.value.rows, 4)

    return formatNumber(cols / rows, 2)
  })
  const previewFrames = computed(() => {
    const seen = new Set<string>()
    const frames: DecorPreviewFrame[] = []

    for (const [sizeIndex, size] of draft.value.sizes.entries()) {
      for (const frame of sizePreviewCandidates(size)) {
        const dimensionsKey = `${frame.cols}x${frame.rows}`
        if (seen.has(dimensionsKey))
          continue

        seen.add(dimensionsKey)
        frames.push({
          key: `${sizeIndex}-${dimensionsKey}`,
          cols: frame.cols,
          rows: frame.rows,
          label: dimensionsKey,
          detail: `r ${formatNumber(frame.ratio, 2)}`,
          sizeIndex,
        })
      }
    }

    return frames
  })
  const selectedMeta = computed(() => {
    return [
      ...(selected.value.meanings ?? []),
      ...(selected.value.tones ?? []),
    ]
  })
  const catalogSnippet = computed(() => {
    const current = draft.value
    const sizes = current.sizes
      .map(size => formatDecorSize(size))
      .join(', ')
    const fields: string[] = [
      `fit: '${current.fit}'`,
      `position: '${formatNumber(current.positionX, 1)}% ${formatNumber(current.positionY, 1)}%'`,
      `zoom: ${formatNumber(current.zoom, 2)}`,
    ]

    if (current.anchor !== 'center')
      fields.push(`anchor: '${current.anchor}'`)
    if (current.offsetX !== 0)
      fields.push(`x: '${formatNumber(current.offsetX, 1)}%'`)
    if (current.offsetY !== 0)
      fields.push(`y: '${formatNumber(current.offsetY, 1)}%'`)
    if (current.rotate !== 0)
      fields.push(`rotate: '${formatNumber(current.rotate, 1)}deg'`)
    if (current.color)
      fields.push(`color: '${current.color}'`)
    if (current.backgroundColor)
      fields.push(`backgroundColor: '${current.backgroundColor}'`)
    if (current.opacity !== 1)
      fields.push(`opacity: ${formatNumber(current.opacity, 2)}`)

    return `sizes: [${sizes}]\nimage: {\n  ${fields.join(',\n  ')},\n}`
  })
  const slideSnippet = computed(() => {
    const current = draft.value
    const fields: string[] = [
      `id: '${selected.value.id}'`,
      `position: '${formatNumber(current.positionX, 1)}% ${formatNumber(current.positionY, 1)}%'`,
      `zoom: ${formatNumber(current.zoom, 2)}`,
    ]

    if (current.color)
      fields.push(`color: '${current.color}'`)
    if (current.backgroundColor)
      fields.push(`backgroundColor: '${current.backgroundColor}'`)
    if (current.opacity !== 1)
      fields.push(`opacity: ${formatNumber(current.opacity, 2)}`)

    return `:decor="{ ${fields.join(', ')} }"`
  })

  function select(id: string) {
    selectedId.value = id
  }

  function update(patch: Partial<DecorDraft>) {
    Object.assign(draft.value, patch)
  }

  function reset() {
    drafts[selected.value.id] = createDraft(selected.value)
  }

  function buildOverride() {
    return buildOverrideVariant(selected.value, draft.value)
  }

  function exportOverrides(next = buildOverride()) {
    const byId = new Map(overrides.value.map(variant => [variant.id, variant]))
    byId.set(next.id, next)

    return [...byId.values()]
  }

  function createSaveToken(): DecorSaveToken {
    return {
      selectedId: selected.value.id,
      version: draftVersion.value,
    }
  }

  function isCurrentSaveToken(token: DecorSaveToken) {
    return token.selectedId === selected.value.id && token.version === draftVersion.value
  }

  async function save(token = createSaveToken()) {
    const next = buildOverride()
    const saveCurrent = async () => {
      const nextOverrides = exportOverrides(next)
      const result = await input.store.save(nextOverrides)

      overrides.value = exportOverrides(next)

      if (!isCurrentSaveToken(token))
        throw new StaleDecorSaveError()

      return result
    }
    const pendingSave = saveTail === null
      ? saveCurrent()
      : saveTail.then(saveCurrent)
    const tail = pendingSave.catch(() => {}).finally(() => {
      if (saveTail === tail)
        saveTail = null
    })
    saveTail = tail

    return pendingSave
  }

  function applyFrame(size: DecorSizeDraft) {
    const frame = sizeDraftFrame(size, draft.value.cols, draft.value.rows)

    draft.value.cols = frame.cols
    draft.value.rows = frame.rows
  }

  function applyPreviewFrame(frame: DecorPreviewFrame) {
    draft.value.cols = frame.cols
    draft.value.rows = frame.rows
  }

  function previewFrameStyle(frame: DecorPreviewFrame) {
    return createPreviewStyle(frame.cols, frame.rows)
  }

  function addCurrentSize() {
    const ratio = formatNumber(draft.value.cols / draft.value.rows, 2)
    const size = createSizeDraft({ cols: draft.value.cols, rows: draft.value.rows, ratio }, draft.value.cols, draft.value.rows)
    const duplicate = draft.value.sizes.some(item => formatSizeDraft(item) === formatSizeDraft(size))

    if (!duplicate)
      draft.value.sizes.push(size)
  }

  function removeSize(index: number) {
    if (draft.value.sizes.length <= 1)
      return

    draft.value.sizes.splice(index, 1)
  }

  return {
    overrides,
    variants,
    selectedId,
    selected,
    draft,
    draftVersion,
    previewStyle,
    activePreviewFrameKey,
    currentRatio,
    previewFrames,
    selectedMeta,
    catalogSnippet,
    slideSnippet,
    select,
    update,
    reset,
    buildOverride,
    exportOverrides,
    createSaveToken,
    isCurrentSaveToken,
    save,
    applyFrame,
    applyPreviewFrame,
    previewFrameStyle,
    addCurrentSize,
    removeSize,
  }
}
