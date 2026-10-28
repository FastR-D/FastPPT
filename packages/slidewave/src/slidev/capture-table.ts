import type {
  HtmlBox,
  HtmlColor,
  HtmlTableElement,
  HtmlTableCell,
  HtmlTextStyle,
} from '../snapshot-types.js'
import {
  cssPixels,
  parseCssColor,
  multiplyAlpha,
  compositeHtmlColor,
} from './css.js'

/** Unsupported presentation can use the ordinary walker, with semantic loss recorded. */
export class UnsupportedTableError extends Error {}

export function captureTable(
  table: HTMLTableElement,
  options: {
    id: string
    opacity: number
    normalize: (rect: DOMRect) => HtmlBox
    textStyle: (element: HTMLElement, opacity: number) => HtmlTextStyle
    scaleX: number
    scaleY: number
    excluded: (element: HTMLElement) => boolean
  },
): Pick<HtmlTableElement, 'box' | 'columnWidthsPx' | 'rowHeightsPx' | 'cells'> {
  const unsupported = (reason: string): never => {
    throw new UnsupportedTableError(reason)
  }
  if (options.opacity !== 1)
    unsupported('Translucent table groups require fragment capture.')
  const rows = [...table.rows]
  if (!rows.length || rows.length > 200)
    throw new Error('Table row count must be between 1 and 200.')
  const columns = rows[0]!.cells.length
  if (!columns || columns > 100 || rows.length * columns > 5000)
    throw new Error('Table exceeds the grid budget.')
  if (
    rows.some((row) =>
      [...row.cells].some((cell) => cell.rowSpan !== 1 || cell.colSpan !== 1),
    )
  )
    unsupported('Merged cells require the N1b table adapter.')
  if (rows.some((row) => row.cells.length !== columns))
    throw new Error('Table has an incomplete rectangular grid.')
  const css = getComputedStyle(table)
  if (css.borderCollapse !== 'collapse')
    unsupported('Only collapsed table borders are currently supported.')
  if (options.scaleX <= 0 || options.scaleY <= 0)
    unsupported('Mirrored tables are not supported.')
  const checkVisual = (
    element: HTMLElement,
    inline = false,
  ): CSSStyleDeclaration => {
    const style = getComputedStyle(element)
    if (element !== table && style.zIndex !== 'auto')
      unsupported('Independent table-cell stacking requires fragment capture.')
    if (Number(style.opacity) !== 1)
      unsupported('Translucent table descendants require fragment capture.')
    if (
      [
        'borderTopLeftRadius',
        'borderTopRightRadius',
        'borderBottomLeftRadius',
        'borderBottomRightRadius',
      ].some(
        (key) =>
          cssPixels(style[key as keyof CSSStyleDeclaration] as string) > 0,
      )
    )
      unsupported('Rounded table cells require fragment capture.')
    if (
      style.fontFeatureSettings !== 'normal' ||
      !['normal', '100%'].includes(style.fontStretch) ||
      (inline && style.verticalAlign !== 'baseline')
    )
      unsupported(
        'Additional font features or inline vertical offsets require fragment capture.',
      )
    if (
      options.excluded(element) ||
      style.display === 'none' ||
      style.visibility !== 'visible'
    )
      unsupported(
        'Hidden or excluded table descendants require fragment capture.',
      )
    if (
      (element !== table && style.transform !== 'none') ||
      style.writingMode !== 'horizontal-tb' ||
      style.direction !== 'ltr' ||
      style.float !== 'none' ||
      (element !== table && !['static', 'relative'].includes(style.position)) ||
      (element !== table &&
        style.position === 'relative' &&
        [style.top, style.right, style.bottom, style.left].some(
          (value) => value !== 'auto' && cssPixels(value) !== 0,
        )) ||
      !['normal', '1'].includes(style.zoom)
    )
      unsupported(
        `Positioned, transformed or vertical/RTL table content is not supported (${element.tagName}).`,
      )
    if (
      style.backgroundImage !== 'none' ||
      style.boxShadow !== 'none' ||
      style.textShadow !== 'none' ||
      style.filter !== 'none' ||
      style.clipPath !== 'none' ||
      (style.maskImage && style.maskImage !== 'none') ||
      style.mixBlendMode !== 'normal' ||
      (style.backdropFilter && style.backdropFilter !== 'none')
    )
      unsupported('Table effects require fragment capture.')
    for (const pseudo of ['::before', '::after']) {
      const content = getComputedStyle(element, pseudo).content
      if (content && !['none', 'normal', '""'].includes(content))
        unsupported('Generated table content requires fragment capture.')
    }
    if (
      style.overflowX !== 'visible' ||
      style.overflowY !== 'visible' ||
      style.textOverflow !== 'clip'
    )
      unsupported('Clipped table content is not supported.')
    if (
      inline &&
      ((parseCssColor(style.backgroundColor)?.alpha ?? 0) > 0 ||
        ['Top', 'Right', 'Bottom', 'Left'].some(
          (side) =>
            cssPixels(
              style[
                `border${side}Width` as keyof CSSStyleDeclaration
              ] as string,
            ) > 0,
        ))
    )
      unsupported('Inline backgrounds or borders require fragment capture.')
    if (
      style.textTransform !== 'none' ||
      style.fontVariantCaps !== 'normal' ||
      style.verticalAlign === 'super' ||
      style.verticalAlign === 'sub' ||
      !['normal', '0px'].includes(style.wordSpacing)
    )
      unsupported('Transformed or script table text is not supported.')
    return style
  }
  checkVisual(table)
  if (
    [
      ...table.querySelectorAll(
        'table,img,svg,canvas,video,audio,iframe,input,button,ul,ol',
      ),
    ].length
  )
    unsupported(
      'Nested tables, media, lists and controls are not supported in native cells.',
    )
  for (const group of table.querySelectorAll<HTMLElement>(
    'thead,tbody,tfoot,colgroup,col,tr',
  )) {
    const style = checkVisual(group)
    if (
      (group.tagName === 'COL' || group.tagName === 'COLGROUP') &&
      ['Top', 'Right', 'Bottom', 'Left'].some(
        (side) =>
          cssPixels(
            style[`border${side}Width` as keyof CSSStyleDeclaration] as string,
          ) > 0,
      )
    )
      unsupported('Column borders require fragment capture.')
    if (group.tagName === 'COL' || group.tagName === 'COLGROUP') {
      if ((parseCssColor(style.backgroundColor)?.alpha ?? 0) > 0)
        unsupported('Column backgrounds require fragment capture.')
    }
  }
  const border = (style: CSSStyleDeclaration, side: string, axis: number) => {
    const kind = style[
      `border${side}Style` as keyof CSSStyleDeclaration
    ] as string
    if (!['none', 'hidden', 'solid'].includes(kind))
      unsupported('Only solid table borders are supported.')
    if (kind === 'hidden')
      unsupported('Hidden collapsed border precedence is not supported.')
    const color = multiplyAlpha(
      parseCssColor(
        style[`border${side}Color` as keyof CSSStyleDeclaration] as string,
      ) ?? { hex: '000000', alpha: 1 },
      options.opacity,
    )
    return {
      color,
      widthPx:
        kind === 'none'
          ? 0
          : cssPixels(
              style[
                `border${side}Width` as keyof CSSStyleDeclaration
              ] as string,
            ) * axis,
    }
  }
  const tableBorders = ['Top', 'Right', 'Bottom', 'Left'].map((side, i) =>
    border(css, side, i % 2 ? options.scaleX : options.scaleY),
  )
  const rect = table.getBoundingClientRect()
  const viewportScale = rect.width / parseFloat(css.width)
  const first = rows[0]!.getBoundingClientRect(),
    last = rows.at(-1)!.getBoundingClientRect()
  const topWidth =
    (Math.max(
      cssPixels(css.borderTopWidth),
      ...[...rows[0]!.cells].map((cell) =>
        cssPixels(getComputedStyle(cell).borderTopWidth),
      ),
    ) *
      viewportScale) /
    2
  const bottomWidth =
    (Math.max(
      cssPixels(css.borderBottomWidth),
      ...[...rows.at(-1)!.cells].map((cell) =>
        cssPixels(getComputedStyle(cell).borderBottomWidth),
      ),
    ) *
      viewportScale) /
    2
  const box = options.normalize(
    new DOMRect(
      rect.left,
      first.top - topWidth,
      rect.width,
      last.bottom + bottomWidth - first.top + topWidth,
    ),
  )
  const xs = [
    box.x,
    ...[...rows[0]!.cells].slice(0, -1).map((cell) => {
      const b = options.normalize(cell.getBoundingClientRect())
      return b.x + b.width
    }),
    box.x + box.width,
  ]
  const ys = [
    box.y,
    ...rows.slice(0, -1).map((row) => {
      const b = options.normalize(row.getBoundingClientRect())
      return b.y + b.height
    }),
    box.y + box.height,
  ]
  const columnWidthsPx = xs.slice(1).map((value, i) => value - xs[i]!)
  const rowHeightsPx = ys.slice(1).map((value, i) => value - ys[i]!)
  const strongest = (
    a: HtmlTableCell['borders'][number],
    b: HtmlTableCell['borders'][number],
  ) => (b.widthPx > a.widthPx ? b : a)
  const cells: HtmlTableCell[] = []
  let textLength = 0
  for (const [r, row] of rows.entries())
    for (const [c, cell] of [...row.cells].entries()) {
      const style = checkVisual(cell)
      const measured = options.normalize(cell.getBoundingClientRect())
      if (
        Math.abs(
          measured.x +
            measured.width -
            (xs[c + 1]! -
              (c === columns - 1
                ? (Math.max(
                    cssPixels(css.borderRightWidth),
                    cssPixels(style.borderRightWidth),
                  ) *
                    options.scaleX) /
                  2
                : 0)),
        ) > 1
      )
        unsupported('Cells do not share the measured column grid.')
      const runs: HtmlTableCell['runs'] = []
      const append = (text: string, element: HTMLElement, opacity: number) => {
        if (!text) return
        const inherited = options.textStyle(element, opacity)
        for (
          let ancestor: HTMLElement | null = element;
          ancestor && cell.contains(ancestor);
          ancestor = ancestor.parentElement
        ) {
          const decoration = getComputedStyle(ancestor)
          if (
            decoration.textDecorationLine !== 'none' &&
            (decoration.textDecorationStyle !== 'solid' ||
              decoration.textDecorationColor !==
                getComputedStyle(element).color)
          )
            unsupported('Complex table text decoration is not supported.')
          for (const value of ['underline', 'line-through'] as const)
            if (
              decoration.textDecorationLine.includes(value) &&
              !inherited.decoration.includes(value)
            )
              inherited.decoration.push(value)
        }
        const hyperlink = element.closest('a')?.href
        runs.push({
          text,
          style: inherited,
          ...(hyperlink ? { hyperlink } : {}),
        })
      }
      let whitespace = false
      const walk = (node: Node, opacity: number): void => {
        if (node instanceof Text) {
          const parent = node.parentElement!
          const whiteSpace = getComputedStyle(parent).whiteSpace
          const preserve = ['pre', 'pre-wrap', 'break-spaces'].includes(
            whiteSpace,
          )
          let text = node.data.replace(/\r\n?/g, '\n')
          if (!preserve) {
            text = text.replace(/[\t\n\f ]+/g, ' ')
            if (whitespace || runs.length === 0) text = text.replace(/^ /, '')
          }
          if (text.includes('\t'))
            unsupported('Preserved table tabs are not supported.')
          append(text, parent, opacity)
          whitespace =
            !preserve &&
            (text.endsWith(' ') || text.endsWith('\n') || (!text && whitespace))
        } else if (node instanceof HTMLElement) {
          if (
            ![
              'TD',
              'TH',
              'SPAN',
              'STRONG',
              'B',
              'EM',
              'I',
              'U',
              'S',
              'DEL',
              'A',
              'BR',
            ].includes(node.tagName)
          )
            unsupported(
              'Only inline text and explicit line breaks are supported in native cells.',
            )
          const childStyle = node === cell ? style : checkVisual(node, true)
          if (
            node !== cell &&
            (childStyle.display !== 'inline' ||
              ['Top', 'Right', 'Bottom', 'Left'].some(
                (side) =>
                  cssPixels(
                    childStyle[
                      `margin${side}` as keyof CSSStyleDeclaration
                    ] as string,
                  ) ||
                  cssPixels(
                    childStyle[
                      `padding${side}` as keyof CSSStyleDeclaration
                    ] as string,
                  ),
              ))
          )
            unsupported('Inline table text must stay in ordinary flow.')
          const alpha =
            node === cell ? opacity : opacity * Number(childStyle.opacity)
          if (node.tagName === 'BR') {
            append('\n', node, alpha)
            whitespace = true
            return
          }
          for (const child of node.childNodes) walk(child, alpha)
        } else if (node.nodeType !== Node.COMMENT_NODE)
          unsupported('Non-HTML cell content is not supported.')
      }
      const alpha =
        options.opacity *
        Number(style.opacity) *
        Number(getComputedStyle(row).opacity) *
        Number(getComputedStyle(row.parentElement!).opacity)
      walk(cell, alpha)
      if (!['pre', 'pre-wrap', 'break-spaces'].includes(style.whiteSpace)) {
        while (runs.length && runs.at(-1)!.text.endsWith(' ')) {
          runs.at(-1)!.text = runs.at(-1)!.text.replace(/ +$/, '')
          if (!runs.at(-1)!.text) runs.pop()
        }
      }
      const text = runs.map((run) => run.text).join('')
      textLength += text.length
      if (textLength > 200000)
        throw new Error('Table text exceeds the capture budget.')
      let fill: HtmlColor | undefined
      for (const layer of [table, row.parentElement!, row, cell]) {
        const color = parseCssColor(getComputedStyle(layer).backgroundColor)
        if (color?.alpha) fill = fill ? compositeHtmlColor(color, fill) : color
      }
      if (fill) fill = multiplyAlpha(fill, alpha)
      cells.push({
        id: `${options.id}/cell-${r}-${c}`,
        row: r,
        column: c,
        header: cell.tagName === 'TH',
        text,
        style: options.textStyle(cell, alpha),
        runs,
        ...(fill ? { fill } : {}),
        borders: ['Top', 'Right', 'Bottom', 'Left'].map((side, i) =>
          border(style, side, i % 2 ? options.scaleX : options.scaleY),
        ),
        insetsPx: {
          top: cssPixels(style.paddingTop) * options.scaleY,
          right: cssPixels(style.paddingRight) * options.scaleX,
          bottom: cssPixels(style.paddingBottom) * options.scaleY,
          left: cssPixels(style.paddingLeft) * options.scaleX,
        },
        verticalAlign:
          style.verticalAlign === 'middle'
            ? 'middle'
            : style.verticalAlign === 'bottom'
              ? 'bottom'
              : style.verticalAlign === 'top'
                ? 'top'
                : unsupported(
                    'Baseline-aligned table cells require fragment capture.',
                  ),
      })
    }
  for (const cell of cells) {
    const sourceRow = rows[cell.row]!,
      group = sourceRow.parentElement!
    const layers = [sourceRow, group]
    for (const layer of layers) {
      const style = getComputedStyle(layer)
      const groupRows = rows.filter((value) => value.parentElement === group)
      for (const [i, side] of ['Top', 'Right', 'Bottom', 'Left'].entries()) {
        if (
          (i === 0 && layer === group && sourceRow !== groupRows[0]) ||
          (i === 2 && layer === group && sourceRow !== groupRows.at(-1)) ||
          (i === 1 && cell.column !== columns - 1) ||
          (i === 3 && cell.column !== 0)
        )
          continue
        cell.borders[i] = strongest(
          cell.borders[i]!,
          border(style, side, i % 2 ? options.scaleX : options.scaleY),
        )
      }
    }

    const { row, column } = cell
    if (row === 0)
      cell.borders[0] = strongest(cell.borders[0]!, tableBorders[0]!)
    if (column === columns - 1)
      cell.borders[1] = strongest(cell.borders[1]!, tableBorders[1]!)
    if (row === rows.length - 1)
      cell.borders[2] = strongest(cell.borders[2]!, tableBorders[2]!)
    if (column === 0)
      cell.borders[3] = strongest(cell.borders[3]!, tableBorders[3]!)
    if (row > 0) {
      const above = cells[(row - 1) * columns + column]!
      cell.borders[0] = above.borders[2] = strongest(
        above.borders[2]!,
        cell.borders[0]!,
      )
    }
    if (column > 0) {
      const left = cells[row * columns + column - 1]!
      cell.borders[3] = left.borders[1] = strongest(
        left.borders[1]!,
        cell.borders[3]!,
      )
    }
  }
  if (
    cells.some((cell) =>
      cell.borders.some(
        (value) =>
          value.widthPx > 0 && value.color.alpha > 0 && value.color.alpha < 1,
      ),
    )
  )
    unsupported('Translucent table borders are not supported.')
  return { box, columnWidthsPx, rowHeightsPx, cells }
}
