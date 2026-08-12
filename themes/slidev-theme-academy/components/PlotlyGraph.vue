<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import Plotly from 'plotly.js-dist'

const props = defineProps<{
  filePath?: string
  graphWidth?: number
  graphHeight?: number
  xTitleFontSize?: number
  yTitleFontSize?: number
  tickFontSize?: number
  legendFontSize?: number
  annotationFontSizeScale?: number
}>()

const plotDiv = ref<HTMLElement>()
const errorMessage = ref('')
let renderRaf: number | null = null
let plotlyConfig: Record<string, unknown> | null = null

type PlotlyFont = Record<string, unknown> & { size?: unknown }
type PlotlyAxis = Record<string, unknown> & {
  tickfont?: PlotlyFont
  titlefont?: PlotlyFont
}
type PlotlyLegend = Record<string, unknown> & { font?: PlotlyFont }

function objectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

const base = import.meta.env.BASE_URL

async function createPlot() {
  if (!props.filePath) return
  try {
    const resolvedPath = props.filePath.startsWith('/')
      ? base.replace(/\/$/, '') + props.filePath
      : props.filePath
    const res = await fetch(resolvedPath)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const payload: unknown = await res.json()
    plotlyConfig = objectRecord(payload)
    scheduleDraw()
  } catch (err) {
    errorMessage.value = `Load failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

function scheduleDraw() {
  if (renderRaf) cancelAnimationFrame(renderRaf)
  renderRaf = requestAnimationFrame(() => drawPlot())
}

function buildSpec() {
  const base = plotlyConfig ?? {}
  const data = Array.isArray(base.data) ? base.data : []
  const layout: Record<string, unknown> = {
    ...((base.layout as Record<string, unknown> | undefined) ?? {}),
  }

  if (props.graphWidth !== undefined) {
    layout.width = props.graphWidth
  } else {
    delete layout.width
  }
  if (props.graphHeight !== undefined) layout.height = props.graphHeight

  if (props.legendFontSize !== undefined && layout.legend) {
    const legend = objectRecord(layout.legend) as PlotlyLegend
    layout.legend = {
      ...legend,
      font: { ...objectRecord(legend.font), size: props.legendFontSize },
    }
  }

  const xaxis: PlotlyAxis = { ...objectRecord(layout.xaxis) }
  const yaxis: PlotlyAxis = { ...objectRecord(layout.yaxis) }
  layout.xaxis = xaxis
  layout.yaxis = yaxis

  if (props.xTitleFontSize !== undefined) xaxis.titlefont = { size: props.xTitleFontSize }
  if (props.yTitleFontSize !== undefined) yaxis.titlefont = { size: props.yTitleFontSize }
  if (props.tickFontSize !== undefined) {
    xaxis.tickfont = { size: props.tickFontSize }
    yaxis.tickfont = { size: props.tickFontSize }
  }

  const annotationScale = props.annotationFontSizeScale
  if (annotationScale !== undefined && Array.isArray(layout.annotations)) {
    layout.annotations = (layout.annotations as Record<string, unknown>[]).map((a) => {
      const cloned = { ...a }
      const font = objectRecord(cloned.font) as PlotlyFont
      const cur = Number(font.size ?? 12)
      cloned.font = { ...font, size: cur * annotationScale }
      return cloned
    })
  }

  return { data, layout }
}

function drawPlot() {
  if (!plotlyConfig || !plotDiv.value) return
  const el = plotDiv.value
  if (!el.offsetParent || el.clientWidth === 0) {
    scheduleDraw()
    return
  }
  const { data, layout } = buildSpec()
  Plotly.react(el, data, layout, { displayModeBar: false, responsive: true })
    .then(() => resizePlot())
    .catch((err: unknown) => {
      errorMessage.value = `Render failed: ${err instanceof Error ? err.message : String(err)}`
    })
}

function resizePlot() {
  if (plotDiv.value) void Plotly.Plots.resize(plotDiv.value).catch(() => {})
}

onMounted(() => {
  void createPlot()
  window.addEventListener('resize', resizePlot)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizePlot)
  if (renderRaf) cancelAnimationFrame(renderRaf)
  if (plotDiv.value) Plotly.purge(plotDiv.value)
})
</script>

<template>
  <div class="plotly-wrap">
    <div ref="plotDiv" class="plotly-canvas" />
    <p v-if="errorMessage" class="plotly-error">{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
.plotly-wrap {
  width: 100%;
}
.plotly-canvas {
  width: 100%;
}
.plotly-error {
  margin-top: 0.4rem;
  font-size: 0.8rem;
  color: #b91c1c;
}
</style>
