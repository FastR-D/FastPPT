import { pick } from '../theme'
import type {
  CalloutOptions,
  ComparisonTableOptions,
  FeatureCardOptions,
  IconOptions,
  ImageOptions,
  KpiGridOptions,
  LineOptions,
  LogoCloudOptions,
  PrimitiveOptions,
  RectOptions,
  SparklineOptions,
  StatCardOptions,
  StepFlowOptions,
  TeamCardOptions,
  TextOptions,
  Theme,
} from '../types'
import { validateRect } from '../validate'

/** The subset of Slide used by editable layout composites. */
export interface LayoutSlide {
  readonly theme: Partial<Theme>
  addRect(options: RectOptions): unknown
  addText(text: string, options: TextOptions): unknown
  addSparkline(options: SparklineOptions): unknown
  addIcon(options: IconOptions): unknown
  addLine(options: LineOptions): unknown
  addAvatar(options: PrimitiveOptions): unknown
  addImage(options: ImageOptions): unknown
}

export function addStatCard(
  slide: LayoutSlide,
  options: StatCardOptions,
): void {
  validateRect(options, 'addStatCard')
  const theme = slide.theme
  const {
    x,
    y,
    w = 3,
    h = 1.8,
    value = '0',
    label = '',
    unit = '',
    delta = null,
    sparkline = null,
    bg,
    color,
    accentColor,
    deltaUpColor,
    deltaDownColor,
    fontFace,
    radius = 0.18,
    border = false,
    borderColor,
    align = 'left',
  } = options
  const resolvedBackground = pick(bg, theme.surface, '#FFFFFF')
  const resolvedColor = pick(color, theme.text, '#0B0B0F')
  const resolvedDim = pick(theme.textDim, undefined, '#6B7280')
  const resolvedAccent = pick(accentColor, theme.primary, '#7C3AED')
  const resolvedFont = pick(
    fontFace,
    theme.fontBody,
    'Inter, system-ui, sans-serif',
  )
  const resolvedUp = pick(deltaUpColor, undefined, '#10B981')
  const resolvedDown = pick(deltaDownColor, undefined, '#EF4444')

  slide.addRect({
    x,
    y,
    w,
    h,
    fill: resolvedBackground,
    radius,
    borderColor: border ? pick(borderColor, undefined, '#E5E7EB') : null,
    borderWidth: border ? 1 : 0,
  })
  slide.addRect({ x, y, w: 0.06, h, fill: resolvedAccent, radius: 0 })

  const paddingX = 0.25
  const innerX = x + paddingX
  const innerWidth = w - paddingX * 2

  slide.addText(label, {
    x: innerX,
    y: y + 0.18,
    w: innerWidth,
    h: 0.3,
    fontFace: resolvedFont,
    fontSize: 11,
    bold: true,
    charSpacing: 2,
    color: resolvedDim,
    align,
  })
  slide.addText(unit ? `${value}${unit}` : `${value}`, {
    x: innerX,
    y: y + 0.45,
    w: innerWidth,
    h: h * 0.45,
    fontFace: resolvedFont,
    fontSize: Math.round(h * 36),
    bold: true,
    color: resolvedColor,
    align,
    valign: 'top',
  })

  if (delta !== null && delta !== undefined) {
    const isUp = delta >= 0
    slide.addText(`${isUp ? '▲' : '▼'} ${Math.abs(delta)}%`, {
      x: innerX,
      y: y + h - 0.45,
      w: innerWidth * 0.6,
      h: 0.3,
      fontFace: resolvedFont,
      fontSize: 12,
      bold: true,
      color: isUp ? resolvedUp : resolvedDown,
      align,
    })
  }

  if (sparkline && sparkline.length > 1) {
    slide.addSparkline({
      x: x + w * 0.55,
      y: y + h - 0.55,
      w: w * 0.4,
      h: 0.4,
      values: sparkline,
      strokeColor: resolvedAccent,
      strokeWidth: 2,
      fillColor: resolvedAccent,
      fillOpacity: 0.15,
      showDots: false,
    })
  }
}

export function addKpiGrid(slide: LayoutSlide, options: KpiGridOptions): void {
  validateRect(options, 'addKPIGrid')
  const { x, y, w, h, items = [], gap = 0.2, ...rest } = options
  if (items.length === 0) return

  const cardWidth = (w - gap * (items.length - 1)) / items.length
  items.forEach((item, index) => {
    addStatCard(slide, {
      ...rest,
      ...item,
      x: x + index * (cardWidth + gap),
      y,
      w: cardWidth,
      h,
    })
  })
}

export function addCallout(slide: LayoutSlide, options: CalloutOptions): void {
  validateRect(options, 'addCallout')
  const theme = slide.theme
  const {
    x,
    y,
    w,
    h = 1.2,
    title = '',
    body = '',
    variant = 'info',
    color,
    bg,
    fontFace,
    radius = 0.12,
  } = options
  const variants = {
    info: { color: '#3B82F6', background: '#EFF6FF' },
    success: { color: '#10B981', background: '#ECFDF5' },
    warning: { color: '#F59E0B', background: '#FFFBEB' },
    danger: { color: '#EF4444', background: '#FEF2F2' },
  } as const
  const selected = variants[variant]
  const resolvedColor = pick(color, undefined, selected.color)
  const resolvedBackground = pick(bg, undefined, selected.background)
  const resolvedFont = pick(
    fontFace,
    theme.fontBody,
    'Inter, system-ui, sans-serif',
  )

  slide.addRect({ x, y, w, h, fill: resolvedBackground, radius })
  slide.addRect({ x, y, w: 0.06, h, fill: resolvedColor, radius: 0 })
  slide.addText(title, {
    x: x + 0.25,
    y: y + 0.12,
    w: w - 0.4,
    h: 0.32,
    fontFace: resolvedFont,
    fontSize: 14,
    bold: true,
    color: resolvedColor,
  })
  slide.addText(body, {
    x: x + 0.25,
    y: y + 0.48,
    w: w - 0.4,
    h: h - 0.6,
    fontFace: resolvedFont,
    fontSize: 12,
    color: '#1F2937',
    valign: 'top',
    lineSpacingMultiple: 1.3,
  })
}

export function addFeatureCard(
  slide: LayoutSlide,
  options: FeatureCardOptions,
): void {
  validateRect(options, 'addFeatureCard')
  const theme = slide.theme
  const {
    x,
    y,
    w,
    h,
    icon = null,
    iconColor,
    iconSize = 0.5,
    title = '',
    body = '',
    bg,
    color,
    fontFace,
    radius = 0.18,
    border = true,
    borderColor,
  } = options
  const resolvedBackground = pick(bg, theme.surface, '#FFFFFF')
  const resolvedColor = pick(color, theme.text, '#0B0B0F')
  const resolvedDim = pick(theme.textDim, undefined, '#6B7280')
  const resolvedAccent = pick(iconColor, theme.primary, '#7C3AED')
  const resolvedFont = pick(
    fontFace,
    theme.fontBody,
    'Inter, system-ui, sans-serif',
  )
  const resolvedBorder = pick(borderColor, undefined, '#E5E7EB')

  slide.addRect({
    x,
    y,
    w,
    h,
    fill: resolvedBackground,
    radius,
    borderColor: border ? resolvedBorder : null,
    borderWidth: border ? 1 : 0,
  })
  const paddingX = 0.3
  let cursorY = y + 0.3
  if (icon) {
    slide.addIcon({
      name: icon,
      x: x + paddingX,
      y: cursorY,
      w: iconSize,
      h: iconSize,
      color: resolvedAccent,
      strokeWidth: 2,
    })
    cursorY += iconSize + 0.15
  }
  slide.addText(title, {
    x: x + paddingX,
    y: cursorY,
    w: w - paddingX * 2,
    h: 0.35,
    fontFace: resolvedFont,
    fontSize: 16,
    bold: true,
    color: resolvedColor,
  })
  slide.addText(body, {
    x: x + paddingX,
    y: cursorY + 0.4,
    w: w - paddingX * 2,
    h: h - (cursorY - y) - 0.5,
    fontFace: resolvedFont,
    fontSize: 12,
    color: resolvedDim,
    valign: 'top',
    lineSpacingMultiple: 1.4,
  })
}

export function addStepFlow(
  slide: LayoutSlide,
  options: StepFlowOptions,
): void {
  validateRect(options, 'addStepFlow')
  const theme = slide.theme
  const {
    x,
    y,
    w,
    h = 1.4,
    steps = [],
    color,
    inactiveColor,
    fontFace,
    numberSize = 0.6,
  } = options
  if (steps.length === 0) return

  const resolvedColor = pick(color, theme.primary, '#7C3AED')
  const resolvedInactive = pick(inactiveColor, undefined, '#E5E7EB')
  const resolvedFont = pick(
    fontFace,
    theme.fontBody,
    'Inter, system-ui, sans-serif',
  )
  const columnWidth = w / steps.length

  steps.forEach((step, index) => {
    const centerX = x + columnWidth * index + columnWidth / 2
    const circleX = centerX - numberSize / 2
    if (index > 0) {
      slide.addLine({
        x1: x + columnWidth * (index - 1) + columnWidth / 2 + numberSize / 2,
        y1: y + numberSize / 2,
        x2: centerX - numberSize / 2,
        y2: y + numberSize / 2,
        color: resolvedInactive,
        width: 2,
      })
    }
    slide.addAvatar({
      x: circleX,
      y,
      size: numberSize,
      initials: String(index + 1),
      bg: resolvedColor,
      color: '#FFFFFF',
      fontFace: resolvedFont,
    })
    slide.addText(step.title || '', {
      x: x + columnWidth * index,
      y: y + numberSize + 0.1,
      w: columnWidth,
      h: 0.35,
      fontFace: resolvedFont,
      fontSize: 14,
      bold: true,
      color: pick(theme.text, undefined, '#0B0B0F'),
      align: 'center',
    })
    if (step.body) {
      slide.addText(step.body, {
        x: x + columnWidth * index + 0.1,
        y: y + numberSize + 0.5,
        w: columnWidth - 0.2,
        h: h - numberSize - 0.5,
        fontFace: resolvedFont,
        fontSize: 11,
        color: pick(theme.textDim, undefined, '#6B7280'),
        align: 'center',
        valign: 'top',
        lineSpacingMultiple: 1.3,
      })
    }
  })
}

export function addComparisonTable(
  slide: LayoutSlide,
  options: ComparisonTableOptions,
): void {
  validateRect(options, 'addComparisonTable')
  const theme = slide.theme
  const {
    x,
    y,
    w,
    h,
    columns = [],
    rows = [],
    highlightCol = -1,
    accentColor,
    fontFace,
    checkColor,
    crossColor,
  } = options
  if (columns.length === 0 || rows.length === 0) return

  const resolvedAccent = pick(accentColor, theme.primary, '#7C3AED')
  const resolvedFont = pick(
    fontFace,
    theme.fontBody,
    'Inter, system-ui, sans-serif',
  )
  const resolvedCheck = pick(checkColor, undefined, '#10B981')
  const resolvedCross = pick(crossColor, undefined, '#D1D5DB')
  const resolvedText = pick(theme.text, undefined, '#0B0B0F')
  const resolvedDim = pick(theme.textDim, undefined, '#6B7280')
  const headerHeight = 0.5
  const labelWidth = w * 0.32
  const columnWidth = (w - labelWidth) / columns.length
  const rowHeight = (h - headerHeight) / rows.length

  if (highlightCol >= 0 && highlightCol < columns.length) {
    slide.addRect({
      x: x + labelWidth + columnWidth * highlightCol,
      y,
      w: columnWidth,
      h,
      fill: resolvedAccent,
      radius: 0.12,
    })
  }

  columns.forEach((column, index) => {
    const highlighted = index === highlightCol
    slide.addText(column, {
      x: x + labelWidth + columnWidth * index,
      y,
      w: columnWidth,
      h: headerHeight,
      fontFace: resolvedFont,
      fontSize: 13,
      bold: true,
      color: highlighted ? '#FFFFFF' : resolvedText,
      align: 'center',
      valign: 'middle',
    })
  })

  rows.forEach((row, rowIndex) => {
    const rowY = y + headerHeight + rowHeight * rowIndex
    if (rowIndex > 0) {
      slide.addLine({
        x1: x,
        y1: rowY,
        x2: x + w,
        y2: rowY,
        color: '#E5E7EB',
        width: 1,
      })
    }
    slide.addText(row.label || '', {
      x: x + 0.1,
      y: rowY,
      w: labelWidth - 0.2,
      h: rowHeight,
      fontFace: resolvedFont,
      fontSize: 12,
      color: resolvedText,
      valign: 'middle',
    })
    row.values.forEach((value, columnIndex) => {
      const cellX = x + labelWidth + columnWidth * columnIndex
      const highlighted = columnIndex === highlightCol
      const common = {
        x: cellX,
        y: rowY,
        w: columnWidth,
        h: rowHeight,
        fontFace: resolvedFont,
        align: 'center' as const,
        valign: 'middle' as const,
      }
      if (value === true) {
        slide.addText('✓', {
          ...common,
          fontSize: 18,
          bold: true,
          color: highlighted ? '#FFFFFF' : resolvedCheck,
        })
      } else if (value === false) {
        slide.addText('—', {
          ...common,
          fontSize: 18,
          color: highlighted ? '#FFFFFF' : resolvedCross,
        })
      } else {
        slide.addText(String(value), {
          ...common,
          fontSize: 12,
          bold: highlighted,
          color: highlighted ? '#FFFFFF' : resolvedDim,
        })
      }
    })
  })
}

export function addLogoCloud(
  slide: LayoutSlide,
  options: LogoCloudOptions,
): void {
  validateRect(options, 'addLogoCloud')
  const { x, y, w, h, logos = [], cols = null, gap = 0.2 } = options
  if (logos.length === 0) return

  const columnCount =
    cols || Math.min(logos.length, Math.ceil(Math.sqrt(logos.length * (w / h))))
  const rowCount = Math.ceil(logos.length / columnCount)
  const cellWidth = (w - gap * (columnCount - 1)) / columnCount
  const cellHeight = (h - gap * (rowCount - 1)) / rowCount

  logos.forEach((source, index) => {
    const row = Math.floor(index / columnCount)
    const column = index % columnCount
    const imageX = x + column * (cellWidth + gap)
    const imageY = y + row * (cellHeight + gap)
    const padding = 0.1
    slide.addImage({
      ...(source.startsWith('data:') ? { data: source } : { path: source }),
      x: imageX + padding,
      y: imageY + padding,
      w: cellWidth - padding * 2,
      h: cellHeight - padding * 2,
      sizing: {
        type: 'contain',
        w: cellWidth - padding * 2,
        h: cellHeight - padding * 2,
      },
    })
  })
}

export function addTeamCard(
  slide: LayoutSlide,
  options: TeamCardOptions,
): void {
  validateRect(options, 'addTeamCard')
  const theme = slide.theme
  const {
    x,
    y,
    w,
    h,
    name = '',
    role = '',
    bio = '',
    image = null,
    initials = '',
    bg,
    accentColor,
    fontFace,
    radius = 0.18,
    border = true,
    borderColor,
    avatarSize = 1.2,
  } = options
  const resolvedBackground = pick(bg, theme.surface, '#FFFFFF')
  const resolvedAccent = pick(accentColor, theme.primary, '#7C3AED')
  const resolvedFont = pick(
    fontFace,
    theme.fontBody,
    'Inter, system-ui, sans-serif',
  )
  const resolvedText = pick(theme.text, undefined, '#0B0B0F')
  const resolvedDim = pick(theme.textDim, undefined, '#6B7280')
  const resolvedBorder = pick(borderColor, undefined, '#E5E7EB')

  slide.addRect({
    x,
    y,
    w,
    h,
    fill: resolvedBackground,
    radius,
    borderColor: border ? resolvedBorder : null,
    borderWidth: border ? 1 : 0,
  })
  const avatarX = x + (w - avatarSize) / 2
  const avatarY = y + 0.3
  slide.addAvatar({
    x: avatarX,
    y: avatarY,
    size: avatarSize,
    ...(image ? { image } : { initials: initials || name[0] || '?' }),
    bg: resolvedAccent,
    color: '#FFFFFF',
    fontFace: resolvedFont,
  })
  slide.addText(name, {
    x: x + 0.2,
    y: avatarY + avatarSize + 0.15,
    w: w - 0.4,
    h: 0.35,
    fontFace: resolvedFont,
    fontSize: 16,
    bold: true,
    color: resolvedText,
    align: 'center',
  })
  slide.addText(role, {
    x: x + 0.2,
    y: avatarY + avatarSize + 0.5,
    w: w - 0.4,
    h: 0.28,
    fontFace: resolvedFont,
    fontSize: 11,
    bold: true,
    charSpacing: 2,
    color: resolvedAccent,
    align: 'center',
  })
  if (bio) {
    slide.addText(bio, {
      x: x + 0.25,
      y: avatarY + avatarSize + 0.85,
      w: w - 0.5,
      h: h - (avatarY + avatarSize + 0.85 - y) - 0.2,
      fontFace: resolvedFont,
      fontSize: 11,
      color: resolvedDim,
      align: 'center',
      valign: 'top',
      lineSpacingMultiple: 1.4,
    })
  }
}
