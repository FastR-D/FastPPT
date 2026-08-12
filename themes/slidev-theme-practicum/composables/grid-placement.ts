export const THEME_GRID_COLUMNS = 12
export const THEME_GRID_ROWS = 12

export type GridPlacementInput = {
  area?: string
  col?: string
  row?: string
  label?: string
}

export type GridRect = {
  colStart: number
  colEnd: number
  rowStart: number
  rowEnd: number
}

export type GridPlacementStyle = {
  gridColumn: string
  gridRow: string
}

export type GridPlacedItem = GridRect & {
  id: string
  label: string
}

export type GridCursor = {
  row: number
  col: number
}

export type GridPlacementResult = {
  rect: GridRect
  style: GridPlacementStyle
  nextCursor: GridCursor
}

type ParsedGridLine =
  | { kind: 'auto' }
  | { kind: 'line'; value: number }
  | { kind: 'span'; value: number }

type ParsedAxisPlacement = {
  raw: string
  start: ParsedGridLine
  end: ParsedGridLine
}

type ParsedGridPlacement = {
  col: ParsedAxisPlacement
  row: ParsedAxisPlacement
}

type AxisResolution = {
  explicit: boolean
  start?: number
  end?: number
  span: number
}

const INTEGER_PATTERN = /^-?\d+$/
const SPAN_PATTERN = /^span\s+(\d+)$/i

function fail(label: string, message: string): never {
  throw new Error(`[${label}] ${message}`)
}

function parseGridLine(rawValue: string, label: string, axis: 'row' | 'col'): ParsedGridLine {
  const raw = rawValue.trim()

  if (!raw)
    fail(label, `Пустое значение ${axis}.`)

  if (raw === 'auto')
    return { kind: 'auto' }

  const spanMatch = raw.match(SPAN_PATTERN)
  if (spanMatch) {
    const value = Number(spanMatch[1])
    if (!Number.isInteger(value) || value <= 0)
      fail(label, `Неверный span в ${axis}: "${raw}".`)

    return { kind: 'span', value }
  }

  if (INTEGER_PATTERN.test(raw)) {
    const value = Number(raw)
    if (!Number.isInteger(value) || value === 0)
      fail(label, `Линия грида в ${axis} должна быть целым числом, кроме 0: "${raw}".`)

    return { kind: 'line', value }
  }

  fail(
    label,
    `Публичный low-level API пока не поддерживает named lines. Используйте числа, отрицательные линии, auto и span: "${raw}".`,
  )
}

function parseAxisPlacement(rawValue: string, label: string, axis: 'row' | 'col'): ParsedAxisPlacement {
  const parts = rawValue
    .split('/')
    .map(part => part.trim())

  if (parts.some(part => !part))
    fail(label, `${axis} содержит пустую часть: "${rawValue}".`)

  if (parts.length === 0 || parts.length > 2)
    fail(label, `${axis} должен содержать одну или две части, разделённые "/": "${rawValue}".`)

  const start = parseGridLine(parts[0], label, axis)
  const end = parseGridLine(parts[1] ?? 'auto', label, axis)

  if (start.kind === 'span' && end.kind === 'span')
    fail(label, `${axis} не может одновременно использовать span в start и end: "${rawValue}".`)

  return {
    raw: rawValue.trim(),
    start,
    end,
  }
}

function parseAreaPlacement(rawValue: string, label: string): ParsedGridPlacement {
  const parts = rawValue
    .split('/')
    .map(part => part.trim())

  if (parts.some(part => !part))
    fail(label, `area содержит пустую часть: "${rawValue}".`)

  if (parts.length !== 4) {
    fail(
      label,
      `area должен содержать ровно четыре части в формате "row-start / col-start / row-end / col-end": "${rawValue}".`,
    )
  }

  const [rowStart, colStart, rowEnd, colEnd] = parts

  return {
    row: parseAxisPlacement(`${rowStart} / ${rowEnd}`, label, 'row'),
    col: parseAxisPlacement(`${colStart} / ${colEnd}`, label, 'col'),
  }
}

function parseGridPlacement(input: GridPlacementInput, label: string): ParsedGridPlacement {
  const area = input.area?.trim()
  const col = input.col?.trim()
  const row = input.row?.trim()

  if (area && (col || row))
    fail(label, 'Используйте либо area, либо col/row, но не оба варианта сразу.')

  if (area)
    return parseAreaPlacement(area, label)

  return {
    col: parseAxisPlacement(col || 'auto', label, 'col'),
    row: parseAxisPlacement(row || 'auto', label, 'row'),
  }
}

function normalizeLine(value: number, trackCount: number, label: string, axis: 'row' | 'col') {
  const lineCount = trackCount + 1

  if (value > 0) {
    if (value < 1 || value > lineCount)
      fail(label, `${axis} использует линию ${value}, но доступен диапазон 1..${lineCount}.`)

    return value
  }

  const resolved = lineCount + 1 + value
  if (resolved < 1 || resolved > lineCount)
    fail(label, `${axis} использует отрицательную линию ${value}, которая выходит за диапазон 1..${lineCount}.`)

  return resolved
}

function resolveAxis(
  placement: ParsedAxisPlacement,
  trackCount: number,
  axis: 'row' | 'col',
  label: string,
): AxisResolution {
  const startLine = placement.start.kind === 'line'
    ? normalizeLine(placement.start.value, trackCount, label, axis)
    : undefined

  const endLine = placement.end.kind === 'line'
    ? normalizeLine(placement.end.value, trackCount, label, axis)
    : undefined

  const span = placement.start.kind === 'span'
    ? placement.start.value
    : placement.end.kind === 'span'
      ? placement.end.value
      : 1

  if (span > trackCount)
    fail(label, `${axis} использует span ${span}, но в сетке только ${trackCount} треков.`)

  if (startLine !== undefined && endLine !== undefined) {
    if (endLine <= startLine)
      fail(label, `${axis} должен заканчиваться после start: "${placement.raw}".`)

    return {
      explicit: true,
      start: startLine,
      end: endLine,
      span: endLine - startLine,
    }
  }

  if (startLine !== undefined) {
    const end = placement.end.kind === 'span' ? startLine + placement.end.value : startLine + 1
    if (end > trackCount + 1)
      fail(label, `${axis} выходит за пределы сетки: "${placement.raw}".`)

    return {
      explicit: true,
      start: startLine,
      end,
      span: end - startLine,
    }
  }

  if (endLine !== undefined) {
    const start = placement.start.kind === 'span' ? endLine - placement.start.value : endLine - 1
    if (start < 1)
      fail(label, `${axis} выходит за пределы сетки: "${placement.raw}".`)

    return {
      explicit: true,
      start,
      end: endLine,
      span: endLine - start,
    }
  }

  return {
    explicit: false,
    span,
  }
}

function intersects(a: GridRect, b: GridRect) {
  return a.colStart < b.colEnd
    && a.colEnd > b.colStart
    && a.rowStart < b.rowEnd
    && a.rowEnd > b.rowStart
}

function ensureNoOverlap(rect: GridRect, occupied: GridPlacedItem[], label: string) {
  for (const other of occupied) {
    if (!intersects(rect, other))
      continue

    fail(
      label,
      `Слот пересекается с "${other.label}" в зоне col ${other.colStart}/${other.colEnd}, row ${other.rowStart}/${other.rowEnd}. На первом этапе overlap запрещён.`,
    )
  }
}

function fits(occupied: GridPlacedItem[], rect: GridRect) {
  if (rect.colStart < 1 || rect.colEnd > THEME_GRID_COLUMNS + 1)
    return false

  if (rect.rowStart < 1 || rect.rowEnd > THEME_GRID_ROWS + 1)
    return false

  return !occupied.some(other => intersects(rect, other))
}

function findRowMajorPlacement(
  occupied: GridPlacedItem[],
  colSpan: number,
  rowSpan: number,
  cursor: GridCursor,
) {
  for (let row = cursor.row; row <= THEME_GRID_ROWS - rowSpan + 1; row++) {
    const startCol = row === cursor.row ? cursor.col : 1
    for (let col = startCol; col <= THEME_GRID_COLUMNS - colSpan + 1; col++) {
      const rect = {
        colStart: col,
        colEnd: col + colSpan,
        rowStart: row,
        rowEnd: row + rowSpan,
      }

      if (fits(occupied, rect))
        return rect
    }
  }

  for (let row = 1; row <= THEME_GRID_ROWS - rowSpan + 1; row++) {
    for (let col = 1; col <= THEME_GRID_COLUMNS - colSpan + 1; col++) {
      const rect = {
        colStart: col,
        colEnd: col + colSpan,
        rowStart: row,
        rowEnd: row + rowSpan,
      }

      if (fits(occupied, rect))
        return rect
    }
  }

  return null
}

function advanceCursor(rect: GridRect): GridCursor {
  const col = rect.colEnd > THEME_GRID_COLUMNS ? 1 : rect.colEnd
  const row = rect.colEnd > THEME_GRID_COLUMNS ? rect.rowStart + 1 : rect.rowStart

  return { row, col }
}

function placementStyle(rect: GridRect): GridPlacementStyle {
  return {
    gridColumn: `${rect.colStart} / ${rect.colEnd}`,
    gridRow: `${rect.rowStart} / ${rect.rowEnd}`,
  }
}

export function resolveGridPlacement(input: GridPlacementInput, options: {
  occupied: GridPlacedItem[]
  cursor?: GridCursor
  label?: string
}): GridPlacementResult {
  const label = options.label?.trim() || input.label?.trim() || 'Slot'
  const placement = parseGridPlacement(input, label)
  const cursor = options.cursor ?? { row: 1, col: 1 }

  const col = resolveAxis(placement.col, THEME_GRID_COLUMNS, 'col', label)
  const row = resolveAxis(placement.row, THEME_GRID_ROWS, 'row', label)

  let rect: GridRect | null = null

  if (col.explicit && row.explicit) {
    rect = {
      colStart: col.start!,
      colEnd: col.end!,
      rowStart: row.start!,
      rowEnd: row.end!,
    }
  }
  else if (col.explicit) {
    for (let rowStart = 1; rowStart <= THEME_GRID_ROWS - row.span + 1; rowStart++) {
      const candidate = {
        colStart: col.start!,
        colEnd: col.end!,
        rowStart,
        rowEnd: rowStart + row.span,
      }

      if (fits(options.occupied, candidate)) {
        rect = candidate
        break
      }
    }
  }
  else if (row.explicit) {
    for (let colStart = 1; colStart <= THEME_GRID_COLUMNS - col.span + 1; colStart++) {
      const candidate = {
        colStart,
        colEnd: colStart + col.span,
        rowStart: row.start!,
        rowEnd: row.end!,
      }

      if (fits(options.occupied, candidate)) {
        rect = candidate
        break
      }
    }
  }
  else {
    rect = findRowMajorPlacement(options.occupied, col.span, row.span, cursor)
  }

  if (!rect)
    fail(label, 'Не удалось разместить слот внутри сетки без пересечений.')

  ensureNoOverlap(rect, options.occupied, label)

  return {
    rect,
    style: placementStyle(rect),
    nextCursor: advanceCursor(rect),
  }
}
