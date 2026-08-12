import { normalizeHex } from '../utils/color'

/**
 * Editorial chart — wrapper around pptxgenjs charts.
 * Applies magazine-style defaults (no grid, serif font, editorial palette)
 * and simplifies the API.
 *
 * Produces a native PPT chart that remains editable in PowerPoint.
 */

// Editorial palettes.
export const CHART_PALETTES = {
  editorial: ['#0b0b0f', '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#ef4444'],
  mono: ['#111111', '#555555', '#888888', '#aaaaaa', '#cccccc'],
  sunset: ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16'],
  ocean: ['#0369a1', '#0284c7', '#0ea5e9', '#38bdf8', '#7dd3fc'],
  pastel: ['#c7d2fe', '#fbcfe8', '#fed7aa', '#bbf7d0', '#fecaca'],
}

/**
 * Prepares pptxgenjs.addChart options from the simplified API.
 *
 * @param pres  — Slidewave.Pres instance used to access ShapeType and ChartType
 * @param opts
 *   type: 'bar' | 'column' | 'line' | 'pie' | 'doughnut' | 'area'
 *   data: [{ name, labels, values }, ...] or the { labels, values } shorthand
 *   x, y, w, h (inches)
 *   title, palette, font, style
 */
export function prepareEditorialChart(pres, opts: any = {}) {
  const {
    type = 'bar',
    data,
    x = 1,
    y = 1,
    w = 8,
    h = 4.5,
    title,
    palette = 'editorial',
    font = 'Inter',
    titleFont = 'Fraunces',
    titleFontSize = 18,
    titleColor = '#0b0b0f',
    showValues = false,
    showLegend = true,
    legendPosition = 'b', // b/r/t/l
    axisColor = '#e5e7eb',
    textColor = '#6b7280',
    barGap = 40, // spacing between groups (pptxgenjs barGapWidthPct)
  } = opts

  const colors = Array.isArray(palette)
    ? palette.map(normalizeHex)
    : (CHART_PALETTES[palette] || CHART_PALETTES.editorial).map(normalizeHex)

  const chartType = resolveChartType(pres, type)

  // Normalize data: accept either the shorthand or the complete pptxgenjs shape.
  let chartData
  if (Array.isArray(data) && data[0]?.labels) {
    chartData = data
  } else if (data?.labels && data?.values) {
    chartData = [
      {
        name: data.name || 'Series 1',
        labels: data.labels,
        values: data.values,
      },
    ]
  } else {
    chartData = data || []
  }

  const chartOpts: any = {
    x,
    y,
    w,
    h,

    // Colors.
    chartColors: colors,
    chartColorsOpacity: 100,

    // Title.
    showTitle: !!title,
    title: title || '',
    titleFontFace: titleFont,
    titleFontSize: titleFontSize,
    titleColor: normalizeHex(titleColor),

    // Axis and legend fonts.
    catAxisLabelFontFace: font,
    catAxisLabelFontSize: 11,
    catAxisLabelColor: normalizeHex(textColor),
    valAxisLabelFontFace: font,
    valAxisLabelFontSize: 11,
    valAxisLabelColor: normalizeHex(textColor),

    // Minimal axes.
    catAxisLineColor: normalizeHex(axisColor),
    valAxisLineColor: normalizeHex(axisColor),
    catGridLine: { style: 'none' },
    valGridLine: { style: 'solid', size: 0.5, color: normalizeHex(axisColor) },

    // Legend.
    showLegend,
    legendPos: legendPosition,
    legendFontFace: font,
    legendFontSize: 10,
    legendColor: normalizeHex(textColor),

    // Values.
    showValue: showValues,
    dataLabelFontFace: font,
    dataLabelFontSize: 10,
    dataLabelColor: normalizeHex(textColor),

    // Bars.
    barGapWidthPct: barGap,
    barDir: type === 'bar' ? 'bar' : 'col',
  }

  // Pie- and doughnut-specific options.
  if (type === 'pie' || type === 'doughnut') {
    chartOpts.showLegend = showLegend
    chartOpts.dataLabelFormatCode = '0%'
    if (type === 'doughnut') chartOpts.holeSize = 50
  }

  return { chartType, chartData, chartOpts }
}

function resolveChartType(pres, type) {
  const CT = pres._pptx.ChartType
  const map = {
    bar: CT.bar,
    column: CT.bar, // pptxgenjs uses 'bar' with barDir='col' for columns
    line: CT.line,
    pie: CT.pie,
    doughnut: CT.doughnut,
    area: CT.area,
    scatter: CT.scatter,
  }
  return map[type] || CT.bar
}
