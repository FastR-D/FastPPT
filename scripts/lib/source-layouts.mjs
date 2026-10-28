import { parseSourceKerning, sourceKerningSetup } from './text-kerning.mjs'
import { parseSourceBaseline } from './text-baseline.mjs'
import { textDecorationLine } from './text-decoration.mjs'
import { parseSourceLetterSpacing } from './text-letter-spacing.mjs'
import { basename } from 'node:path'
import { validateTextTabs, validateDecimalTabDeclaration } from './text-tabs.mjs'
import { isTextLanguage } from './text-language.mjs'
import { autoNumberSchemes } from './text-numbering.mjs'
import { scriptFontsSetup } from './script-fonts.mjs'

const list = (value) => (Array.isArray(value) ? value : [])
const rgb = (value) =>
  /^[0-9a-f]{6}$/i.test(String(value ?? '').replace(/^#/, ''))
    ? String(value).replace(/^#/, '').toUpperCase()
    : undefined
const id = (part, index) =>
  `source-${
    basename(part)
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'layout'
  }-${index + 1}`
const locate = (entries, object) =>
  list(entries).find((entry) =>
    object.shapeId
      ? entry.shapeId === object.shapeId
      : entry.order === object.order,
  )
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  )

function geometry(object, resolved) {
  if (resolved)
    return resolved.status === 'resolved' && resolved.axisAligned
      ? resolved.bounds
      : undefined
  // Compatibility with old analyses is limited to explicit, untransformed frames.
  const t = object.transform
  if (
    object.parentShapeId ||
    (t?.attributes?.rot && Number(t.attributes.rot) % 21600000) ||
    [t?.attributes?.flipH, t?.attributes?.flipV].some(
      (value) => value !== undefined && !['0', 'false'].includes(value),
    )
  )
    return undefined
  const values = [t?.offset?.x, t?.offset?.y, t?.extent?.cx, t?.extent?.cy]
  if (
    !values.every((value) => typeof value === 'string' && /^-?\d+$/.test(value))
  )
    return undefined
  return {
    x: Number(values[0]),
    y: Number(values[1]),
    width: Number(values[2]),
    height: Number(values[3]),
  }
}
const validGeometry = (box) =>
  box &&
  Object.values(box).every(Number.isSafeInteger) &&
  box.width > 0 &&
  box.height > 0

function solidColor(source, resolved, issues, label) {
  if (!source || source.kind === 'none') return undefined
  if (source.kind !== 'solid') {
    issues.push(`${label}: unsupported ${source.kind} fill`)
    return undefined
  }
  const direct = source.color
  const color =
    resolved?.value ??
    (list(direct?.transforms).length === 0
      ? direct?.kind === 'srgbClr'
        ? direct.attributes?.val
        : direct?.kind === 'sysClr'
          ? direct.attributes?.lastClr
          : undefined
      : undefined)
  if (!rgb(color)) issues.push(`${label}: unresolved color`)
  if (resolved?.alpha !== undefined && resolved.alpha !== 1)
    issues.push(
      `${label}: alpha is not represented by the native fixed-object contract`,
    )
  return rgb(color)
}

// Project only properties represented by the native text contract. The full
// resolved evidence stays in analysis; unsupported properties prevent publishing.
function projectTextStyle(character, issues, label, scriptFonts = false) {
  if (!character) return undefined
  const attributes = character.attributes ?? {}
  const style = {}
  for (const [name, value] of Object.entries(attributes)) {
    if (['dirty', 'smtClean'].includes(name)) continue
    if (['lang', 'altLang'].includes(name)) {
      if (!isTextLanguage(value)) issues.push(`${label}: invalid ${name} language identifier`)
      else style[name === 'lang' ? 'language' : 'alternativeLanguage'] = value
      continue
    }
    if (
      name === 'sz' &&
      /^\d+$/.test(value) &&
      Number(value) >= 100 &&
      Number(value) <= 400000
    )
      style.fontSize = Number(value) / 100
    else if (
      ['b', 'i'].includes(name) &&
      ['0', '1', 'true', 'false'].includes(value)
    )
      style[name === 'b' ? 'bold' : 'italic'] = ['1', 'true'].includes(value)
    else if (name === 'u' && ['none', 'sng'].includes(value)) style.underline = value === 'sng'
    else if (name === 'strike' && ['noStrike', 'sngStrike'].includes(value)) style.strike = value === 'sngStrike'
    else if (name === 'spc' && parseSourceLetterSpacing(value) !== undefined) style.letterSpacing = parseSourceLetterSpacing(value)
    else if (name === 'baseline' && parseSourceBaseline(value) !== undefined) style.baselinePercent = parseSourceBaseline(value)
    else if (name === 'cap' && ['none', 'all', 'small'].includes(value)) style.capitalization = value
    else if (name === 'kern' && parseSourceKerning(value) !== undefined) style.kerningThreshold = parseSourceKerning(value)
    else
      issues.push(
        `${label}: character property ${name}=${value} is not represented`,
      )
  }
  for (const child of Object.values(character.children ?? {})) {
    if (['uLnTx', 'uFillTx'].includes(child.kind) &&
      [undefined, 'http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main'].includes(child.namespace) &&
      !Object.keys(child.attributes ?? {}).length && !list(child.children).length) continue
    issues.push(`${label}: character child ${child.kind} is not represented`)
  }
  const fonts = Object.values(character.resolvedFonts ?? {})
  for (const font of fonts)
    if (font.issue) issues.push(`${label}: ${font.issue}`)
  const families = [
    ...new Set(fonts.map((font) => font.family).filter(Boolean)),
  ]
  if (families.length > 1 && !scriptFonts)
    issues.push(
      `${label}: distinct script fonts require a per-script native text contract`,
    )
  else if (
    scriptFonts &&
    families.length &&
    (families.length > 1 || fonts.length < 3)
  )
    style.fontFamilies = Object.fromEntries(
      [
        ['latin', 'latin'],
        ['ea', 'eastAsian'],
        ['cs', 'complexScript'],
      ].flatMap(([script, source]) =>
        character.resolvedFonts?.[source]?.family
          ? [[script, character.resolvedFonts[source].family]]
          : [],
      ),
    )
  else if (families.length === 1) style.fontFamily = families[0]
  if (character.fill?.kind === 'none')
    issues.push(`${label}: invisible text fill is not represented`)
  const color = solidColor(
    character.fill,
    character.color,
    issues,
    `${label} text`,
  )
  if (color) style.color = color
  return Object.keys(style).length ? style : undefined
}

const canonical = (value) =>
  JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)),
        )
      : entry,
  )
const sameStyle = (left, right) => canonical(left) === canonical(right)

const paragraphDefaults = {
  algn: 'l',
  marL: '0',
  marR: '0',
  indent: '0',
  defTabSz: '914400',
  rtl: '0',
  eaLnBrk: '1',
  latinLnBrk: '0',
  hangingPunct: '1',
}
function reviewParagraph(style, issues, label, fixed = false) {
  for (const [key, value] of Object.entries(style?.attributes ?? {})) {
    if (key === 'lvl' || value === paragraphDefaults[key] || (key === 'rtl' && ['0', '1', 'true', 'false'].includes(value))) continue
    issues.push(
      `${label}: paragraph property ${key}=${value} is not represented`,
    )
  }
  for (const child of Object.values(style?.children ?? {})) {
    if (
      child.namespace &&
      ![
        'http://schemas.openxmlformats.org/drawingml/2006/main',
        'http://purl.oclc.org/ooxml/drawingml/main',
      ].includes(child.namespace)
    ) {
      issues.push(
        `${label}: foreign paragraph child ${child.kind} is not represented`,
      )
      continue
    }
    if (!fixed && child.kind === 'buNone') continue
    if (
      ['lnSpc', 'spcBef', 'spcAft'].includes(child.kind) &&
      child.children.length === 1 &&
      child.children[0].kind ===
        (child.kind === 'lnSpc' ? 'spcPct' : 'spcPts') &&
      child.children[0].attributes.val ===
        (child.kind === 'lnSpc' ? '120000' : '0')
    )
      continue
    issues.push(`${label}: paragraph child ${child.kind} is not represented`)
  }
}

function projectParagraphStyle(style, issues, label, decimalTab) {
  const result = {}
  const alignment = { l: 'left', ctr: 'center', r: 'right', just: 'justify' }
  const margins = { marL: 'marginLeft', marR: 'marginRight', indent: 'indent' }
  for (const [key, value] of Object.entries(style?.attributes ?? {})) {
    if (key === 'lvl') continue
    if (key === 'defTabSz' && /^\d+$/.test(value) && Number(value) <= 51206400) result.defaultTabSize = Number(value)
    else if (key === 'algn' && alignment[value]) result.align = alignment[value]
    else if (key === 'rtl' && ['0', '1', 'true', 'false'].includes(value)) result.direction = ['1', 'true'].includes(value) ? 'rtl' : 'ltr'
    else if (
      margins[key] &&
      /^-?\d+$/.test(value) &&
      Math.abs(Number(value)) <= 51206400 &&
      (key === 'indent' || Number(value) >= 0)
    )
      result[margins[key]] = Number(value)
    else if (value !== paragraphDefaults[key])
      issues.push(
        `${label}: paragraph property ${key}=${value} is not represented`,
      )
  }
  const spacing = {
    lnSpc: 'lineSpacing',
    spcBef: 'spaceBefore',
    spcAft: 'spaceAfter',
  }
  for (const child of Object.values(style?.children ?? {})) {
    if (
      child.namespace &&
      ![
        'http://schemas.openxmlformats.org/drawingml/2006/main',
        'http://purl.oclc.org/ooxml/drawingml/main',
      ].includes(child.namespace)
    ) {
      issues.push(
        `${label}: foreign paragraph child ${child.kind} is not represented`,
      )
      continue
    }
    if (
      child.kind === 'buNone' &&
      !Object.keys(child.attributes).length &&
      !child.children.length
    ) {
      result.bullet = { kind: 'none' }
      continue
    }
    if (
      child.kind === 'buChar' &&
      Object.keys(child.attributes).every((key) => key === 'char') &&
      !child.children.length &&
      [...(child.attributes.char ?? '')].length === 1 &&
      !/[\p{Cc}\p{Cf}\p{Cs}\p{Z}]/u.test(child.attributes.char)
    ) {
      result.bullet = { kind: 'character', character: child.attributes.char }
      continue
    }
    if (child.kind === 'buAutoNum' && !child.children.length &&
        Object.keys(child.attributes).every(key => ['type', 'startAt'].includes(key)) &&
        autoNumberSchemes.includes(child.attributes.type) &&
        (child.attributes.startAt === undefined || (/^\d+$/.test(child.attributes.startAt) && Number(child.attributes.startAt) >= 1 && Number(child.attributes.startAt) <= 32767))) {
      result.bullet = { kind: 'auto-number', scheme: child.attributes.type, ...(child.attributes.startAt === undefined ? {} : { startAt: Number(child.attributes.startAt) }) }
      continue
    }
    if (child.kind === 'tabLst' && !Object.keys(child.attributes).length) {
      const align = { l: 'left', ctr: 'center', r: 'right', dec: 'decimal' }
      const stops = child.children.map(tab => ({ position: /^-?\d+$/.test(tab.attributes.pos) ? Number(tab.attributes.pos) : NaN, align: align[tab.attributes.algn] }))
      try {
        if (child.children.some(tab => tab.kind !== 'tab' || tab.children.length || (tab.namespace && tab.namespace !== child.namespace) || Object.keys(tab.attributes).some(key => !['pos', 'algn'].includes(key)))) throw new Error('Unsupported tab stop properties.')
        validateTextTabs({ tabStops: stops })
        result.tabStops = stops
        if (stops.some(stop => stop.align === 'decimal')) {
          if (decimalTab) result.decimalTab = decimalTab
          else issues.push(`${label}: decimal tab alignment requires a measured separator convention`)
        }
      } catch (error) { issues.push(`${label}: ${error.message}`) }
      continue
    }
    const following = {
      buFontTx: 'bulletFont',
      buSzTx: 'bulletSize',
      buClrTx: 'bulletColor',
    }[child.kind]
    if (
      following &&
      !Object.keys(child.attributes).length &&
      !child.children.length
    ) {
      result[following] = { kind: 'text' }
      continue
    }
    if (
      child.kind === 'buFont' &&
      Object.keys(child.attributes).every((key) => key === 'typeface') &&
      !child.children.length &&
      style.resolvedBulletFont?.family
    ) {
      result.bulletFont = {
        kind: 'font',
        fontFamily: style.resolvedBulletFont.family,
      }
      continue
    }
    if (
      child.kind === 'buClr' &&
      !Object.keys(child.attributes).length &&
      (style.resolvedBulletColor?.alpha ?? 1) === 1 &&
      rgb(style.resolvedBulletColor.value)
    ) {
      result.bulletColor = {
        kind: 'color',
        color: rgb(style.resolvedBulletColor.value),
      }
      continue
    }
    if (
      ['buSzPct', 'buSzPts'].includes(child.kind) &&
      Object.keys(child.attributes).every((key) => key === 'val') &&
      !child.children.length &&
      /^\d+$/.test(child.attributes.val)
    ) {
      const points = child.kind === 'buSzPts',
        value = Number(child.attributes.val) / (points ? 100 : 1000)
      if (value >= (points ? 1 : 25) && value <= (points ? 4000 : 400)) {
        result.bulletSize = { kind: points ? 'points' : 'percent', value }
        continue
      }
    }
    const value = child.children?.[0]
    if (
      spacing[child.kind] &&
      child.children.length === 1 &&
      (!value.namespace ||
        [
          'http://schemas.openxmlformats.org/drawingml/2006/main',
          'http://purl.oclc.org/ooxml/drawingml/main',
        ].includes(value.namespace)) &&
      ['spcPct', 'spcPts'].includes(value.kind) &&
      /^\d+$/.test(value.attributes.val)
    ) {
      const unit = value.kind === 'spcPct' ? 'percent' : 'points'
      const number =
        Number(value.attributes.val) / (unit === 'percent' ? 1000 : 100)
      if (number <= (unit === 'percent' ? 13200 : 1584)) {
        result[spacing[child.kind]] = { unit, value: number }
        continue
      }
    }
    issues.push(`${label}: paragraph child ${child.kind} is not represented`)
  }
  if (result.direction === 'rtl' && ((result.bullet && result.bullet.kind !== 'none') || result.tabStops?.length || style?.runs?.some(run => run.text?.includes('\t')))) issues.push(`${label}: RTL bullets or tabs require measured direction-aware geometry`)
  return result
}

function placeholderTextBody(body, issues, label) {
  const values = body?.attributes ?? {}
  const defaults = { lIns: 91440, rIns: 91440, tIns: 45720, bIns: 45720 }
  const insets = {}
  for (const [key, field] of [
    ['lIns', 'left'],
    ['rIns', 'right'],
    ['tIns', 'top'],
    ['bIns', 'bottom'],
  ]) {
    const value =
      values[key] === undefined
        ? defaults[key]
        : /^\d+$/.test(values[key])
          ? Number(values[key])
          : NaN
    if (!Number.isSafeInteger(value) || value < 0 || value > 51206400)
      issues.push(`${label}: unsupported text body ${key}=${values[key]}`)
    else insets[field] = value
  }
  const align = { t: 'top', ctr: 'middle', b: 'bottom' }[values.anchor ?? 't']
  if (!align)
    issues.push(`${label}: unsupported text body anchor=${values.anchor}`)
  if (values.wrap !== undefined && !['square', 'none'].includes(values.wrap))
    issues.push(`${label}: unsupported text body wrap=${values.wrap}`)
  for (const [key, value] of Object.entries(values)) {
    if (['lIns', 'rIns', 'tIns', 'bIns', 'anchor', 'wrap'].includes(key))
      continue
    if (
      (key === 'rot' && value === '0') ||
      (key === 'vert' && value === 'horz') ||
      (key === 'rtlCol' && ['0', 'false'].includes(value)) ||
      (key === 'anchorCtr' && ['0', 'false'].includes(value))
    )
      continue
    issues.push(`${label}: unsupported text body ${key}=${value}`)
  }
  if (
    body?.autoFit &&
    (body.autoFit.kind !== 'noAutofit' ||
      Object.keys(body.autoFit.attributes ?? {}).length ||
      list(body.autoFit.children).length)
  )
    issues.push(`${label}: unsupported text body autofit ${body.autoFit.kind}`)
  return {
    insets,
    ...(align ? { verticalAlign: align } : {}),
    wrap: values.wrap !== 'none',
    autoFit: 'none',
  }
}

function placeholderTextStyle(evidence, issues, label, decimalTab) {
  if (!evidence) return undefined
  issues.push(
    ...list(evidence.issues).filter(
      (issue) => !issue.startsWith('Missing master placeholder'),
    ),
  )
  const levels = list(evidence.levels).map((level) => ({
    level: level.level,
    textStyle:
      projectTextStyle(
        level.defaultRun,
        issues,
        `${label}/level${level.level}`,
        true,
      ) ?? {},
    paragraph: projectParagraphStyle(
      level,
      issues,
      `${label}/level${level.level}`,
      decimalTab,
    ),
  }))
  if (
    levels.length !== 9 ||
    new Set(levels.map((level) => level.level)).size !== 9 ||
    levels.some(
      (entry) =>
        !Number.isInteger(entry.level) || entry.level < 1 || entry.level > 9,
    )
  )
    issues.push(
      `${label}: reusable text defaults require all nine unambiguous levels`,
    )
  // Sample text remains source evidence; it never replaces reusable defaults.
  for (const paragraph of list(evidence.paragraphs)) {
    const level = levels.find((entry) => entry.level === (paragraph.level ?? 1))
    const projected = projectParagraphStyle(
      paragraph,
      issues,
      `${label}/p${paragraph.paragraph}`,
      decimalTab,
    )
    if (!sameStyle(projected, level?.paragraph))
      issues.push(
        `${label}: prompt paragraph style differs from reusable list defaults`,
      )
    for (const [index, run] of list(paragraph.runs).entries()) {
      if (run.kind === 'field')
        issues.push(`${label}: dynamic prompt text field requires review`)
      const style =
        projectTextStyle(
          run,
          issues,
          `${label}/p${paragraph.paragraph}/r${index}`,
          true,
        ) ?? {}
      if (!sameStyle(style, level?.textStyle))
        issues.push(
          `${label}: prompt run style differs from reusable list defaults`,
        )
    }
    if (!paragraph.runs?.length || paragraph.runs.at(-1)?.kind === 'break') {
      const end =
        projectTextStyle(
          paragraph.end,
          issues,
          `${label}/p${paragraph.paragraph}/end`,
          true,
        ) ?? {}
      if (!sameStyle(end, level?.textStyle))
        issues.push(
          `${label}: empty paragraph style differs from reusable list defaults`,
        )
    }
  }
  // The base contains only properties shared by every level. Using level one
  // as the base would falsely inject its explicit font into unspecified levels.
  const common = (values) =>
    Object.fromEntries(
      Object.entries(values[0] ?? {}).filter(([key, value]) =>
        values.every((entry) => sameStyle(entry[key], value)),
      ),
    )
  const textStyle = common(levels.map((entry) => entry.textStyle))
  const paragraph = common(levels.map((entry) => entry.paragraph))
  const difference = (value, base) =>
    Object.fromEntries(
      Object.entries(value).filter(
        ([key, field]) => !sameStyle(field, base[key]),
      ),
    )
  const overrides = levels.flatMap((entry) => {
    const text = difference(entry.textStyle, textStyle)
    const para = difference(entry.paragraph, paragraph)
    return Object.keys(text).length || Object.keys(para).length
      ? [
          {
            level: entry.level,
            ...(Object.keys(text).length ? { textStyle: text } : {}),
            ...(Object.keys(para).length ? { paragraph: para } : {}),
          },
        ]
      : []
  })
  const result = {
    ...textStyle,
    ...(Object.keys(paragraph).length ? { paragraph } : {}),
    ...(overrides.length ? { levels: overrides } : {}),
  }
  return Object.keys(result).length ? result : undefined
}

function fixedObject(
  object,
  resolvedGeometry,
  colors,
  textEvidence,
  issues,
  owner,
) {
  const label = `${object.part}#${object.shapeId ?? object.order}`
  issues.push(...list(textEvidence?.issues))
  for (const feature of list(object.unsupported))
    issues.push(`${label}: ${feature}`)
  if (object.kind === 'grpSp') return undefined // descendants carry the composed matrix
  if (object.kind !== 'sp') {
    issues.push(`${label}: unsupported fixed object ${object.kind}`)
    return undefined
  }
  const box = geometry(object, resolvedGeometry)
  if (!validGeometry(box)) {
    issues.push(`${label}: unresolved or non-axis-aligned fixed geometry`)
    return undefined
  }
  if (
    object.shapeGeometry &&
    (object.shapeGeometry.kind !== 'preset' ||
      object.shapeGeometry.preset !== 'rect')
  )
    issues.push(
      `${label}: unsupported shape geometry ${object.shapeGeometry.preset ?? object.shapeGeometry.kind}`,
    )
  const appearance = object.appearance
  const fill = solidColor(appearance?.fill, colors?.fill, issues, label)
  if (appearance?.line && appearance.line.fill?.kind !== 'none')
    issues.push(`${label}: line style is not represented`)
  const runs = textEvidence
    ? list(textEvidence.paragraphs).flatMap((paragraph) => list(paragraph.runs))
    : list(object.text?.paragraphs).flatMap((paragraph, p) =>
        list(paragraph.runs).map((run, r) => ({
          ...run,
          attributes: run.properties,
          fill: run.style?.fill,
          color: colors?.paragraphs?.[p]?.runs?.[r]?.color,
          resolvedFonts: Object.fromEntries(
            ['latin', 'eastAsian', 'complexScript']
              .filter((face) => run.style?.[face])
              .map((face) => [
                face,
                {
                  family: run.style[face].startsWith('+')
                    ? undefined
                    : run.style[face],
                  ...(run.style[face].startsWith('+')
                    ? {
                        issue:
                          'theme font reference requires script resolution',
                      }
                    : {}),
                },
              ]),
          ),
        })),
      )
  const styled = runs
    .filter((run) => run.text)
    .map((run, index) => {
      const style = projectTextStyle(run, issues, `${label}/r${index}`) ?? {}
      if (run.kind === 'field')
        issues.push(`${label}: dynamic text field requires review`)
      if (style.bold || style.italic)
        issues.push(`${label}: fixed bold/italic formatting is not represented`)
      for (const issue of list(run.issues))
        issues.push(`${label}/r${index}: ${issue}`)
      return style
    })
  const first = styled[0] ?? {}
  if (styled.some((style) => !sameStyle(style, first)))
    issues.push(`${label}: mixed run styles require review`)
  const directions = (textEvidence ? list(textEvidence.paragraphs).map(paragraph => paragraph.attributes?.rtl) : list(object.text?.paragraphs).map(paragraph => paragraph.format?.attributes?.rtl)).map(value => ['1', 'true'].includes(value) ? 'rtl' : 'ltr')
  const direction = directions[0]
  if (directions.some(value => value !== direction)) issues.push(`${label}: mixed fixed paragraph directions are not represented`)
  const { fontFamily, fontSize, color: textColor, language, alternativeLanguage, underline, strike, letterSpacing, baselinePercent, kerningThreshold, capitalization } = first
  if (object.text?.plainText) {
    // The fixed-object contract is zero-inset, top-aligned, with a 1.2 line
    // height. Missing source defaults are not proof of the same appearance.
    const body = appearance?.textBody?.attributes ?? {}
    if (
      ['lIns', 'rIns', 'tIns', 'bIns'].some((key) => body[key] !== '0') ||
      (body.anchor && body.anchor !== 't')
    )
      issues.push(`${label}: text body insets/alignment require review`)
    if (
      list(appearance?.textBody?.children).length ||
      Object.entries(body).some(
        ([key, value]) =>
          ![
            'lIns',
            'rIns',
            'tIns',
            'bIns',
            'anchor',
            'wrap',
            'rot',
            'vert',
          ].includes(key) ||
          (key === 'wrap' && value !== 'square') ||
          (key === 'rot' && value !== '0') ||
          (key === 'vert' && value !== 'horz'),
      )
    )
      issues.push(`${label}: text body formatting is not represented`)
    if (!fontFamily || !fontSize || !textColor)
      issues.push(`${label}: text style is not fully explicit`)
    if (textEvidence) {
      for (const paragraph of list(textEvidence.paragraphs)) {
        reviewParagraph(
          paragraph,
          issues,
          `${label}/p${paragraph.paragraph}`,
          true,
        )
        if (
          !paragraph.runs?.length ||
          paragraph.runs.at(-1)?.kind === 'break'
        ) {
          const end = projectTextStyle(
            paragraph.end,
            issues,
            `${label}/p${paragraph.paragraph}/end`,
          )
          if (!sameStyle(end, first))
            issues.push(`${label}: empty paragraph style is not represented`)
        }
      }
    } else {
      if (list(appearance?.paragraphDefaults).length)
        issues.push(`${label}: paragraph defaults require review`)
      for (const paragraph of list(object.text.paragraphs))
        reviewParagraph(
          {
            attributes: paragraph.format?.attributes,
            children: paragraph.format?.children,
          },
          issues,
          label,
          true,
        )
    }
  }
  const name =
    String(object.name ?? `object-${object.shapeId ?? object.order}`).trim() ||
    `object-${object.order}`
  return {
    name,
    anchor: `${owner}-${object.shapeId ?? object.order}`,
    ...box,
    ...(fill ? { fill } : {}),
    ...(object.text?.plainText ? { text: object.text.plainText } : {}),
    ...(fontFamily && !fontFamily.startsWith('+') ? { fontFamily } : {}),
    ...(fontSize >= 1 && fontSize <= 4000 ? { fontSize } : {}),
    ...(textColor ? { color: textColor } : {}),
    ...(language === undefined ? {} : { language }),
    ...(alternativeLanguage === undefined ? {} : { alternativeLanguage }),
    ...(underline === undefined ? {} : { underline }),
    ...(strike === undefined ? {} : { strike }),
    ...(letterSpacing === undefined ? {} : { letterSpacing }),
    ...(baselinePercent === undefined ? {} : { baselinePercent }),
    ...(kerningThreshold === undefined ? {} : { kerningThreshold }),
    ...(capitalization === undefined ? {} : { capitalization }),
    ...(direction === undefined ? {} : { direction }),
  }
}

/** Consume analysis facts; never derive parentage from reverse registration lists. */
export function sourceNativeLayouts(analysis, decimalTabDeclaration) {
  if (decimalTabDeclaration !== undefined) validateDecimalTabDeclaration(decimalTabDeclaration, analysis?.sourceHash)
  const f = analysis?.extractedFeatures ?? {}
  const sourceObjects = list(f.sourceObjects).flatMap((entry) =>
    Array.isArray(entry.objects) ? entry.objects : [entry],
  )
  const masters = list(f.masterRelationships)
  const definitions = [],
    candidates = []
  const rawCanvas = f.canvas
  const canvas =
    rawCanvas &&
    [rawCanvas.widthEmu, rawCanvas.heightEmu].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
      ? { width: rawCanvas.widthEmu, height: rawCanvas.heightEmu }
      : undefined
  for (const [index, detail] of list(f.layouts).entries()) {
    const part = detail.id
    if (typeof part !== 'string' || !part) continue
    const analyzed = list(analysis.candidateLayouts).find(
      (entry) => entry.id === part,
    )
    const geometryPart = list(f.resolvedGeometry).find(
      (entry) => entry.part === part,
    )
    const parent =
      analyzed?.source?.master ??
      geometryPart?.master ??
      list(analysis.sourceGraph?.slides).find((slide) => slide.layout === part)
        ?.master
    const master = masters.find((entry) => entry.part === parent)
    const masterId = parent
      ? id(
          parent,
          Math.max(
            0,
            masters.findIndex((entry) => entry.part === parent),
          ),
        )
      : undefined
    const name = id(part, index),
      issues = [],
      placeholders = [],
      indices = new Set()
    if (!canvas) issues.push(`${part}: missing source canvas`)
    if (!parent) issues.push(`${part}: missing forward master relationship`)
    for (const sourcePart of [part, parent]) {
      const background = list(f.resolvedPartBackgroundAppearances).find(
        (entry) => entry.part === sourcePart,
      )
      if (
        background &&
        !['none', 'unspecified'].includes(background.kind) &&
        !(
          background.kind === 'solid' &&
          rgb(background.color?.value) === 'FFFFFF' &&
          (background.color.alpha ?? 1) === 1
        )
      )
        issues.push(
          `${sourcePart}: ${background.kind} background requires a native background contract`,
        )
    }
    for (const placeholder of list(detail.placeholders)) {
      const idx = /^\d+$/.test(String(placeholder.idx))
        ? Number(placeholder.idx)
        : NaN
      if (!Number.isSafeInteger(idx) || idx < 0 || indices.has(idx)) {
        issues.push(
          `${part}: invalid or duplicate placeholder index ${placeholder.idx}`,
        )
        continue
      }
      indices.add(idx)
      const resolved = locate(geometryPart?.placeholders, placeholder)
      const textEvidence = locate(
        list(f.resolvedObjectText).find((entry) => entry.part === part)
          ?.objects,
        placeholder,
      )
      const g = resolved?.geometry
      const box = g
        ? {
            x: Number(g.x),
            y: Number(g.y),
            width: Number(g.cx),
            height: Number(g.cy),
          }
        : undefined
      if (!resolved?.complete || !validGeometry(box)) {
        issues.push(
          `${part}#${placeholder.shapeId ?? idx}: incomplete placeholder geometry`,
        )
        continue
      }
      if (
        !['title', 'ctrTitle', 'subTitle', 'body', 'obj', 'pic'].includes(
          placeholder.type,
        )
      ) {
        issues.push(
          `${part}#${placeholder.shapeId ?? idx}: unsupported placeholder type ${placeholder.type}`,
        )
        continue
      }
      if (
        resolved.appearance?.fill ||
        resolved.appearance?.line ||
        (!textEvidence && list(resolved.appearance?.paragraphDefaults).length)
      )
        issues.push(
          `${part}#${placeholder.shapeId ?? idx}: placeholder appearance requires review`,
        )
      issues.push(
        ...list(resolved.appearance?.unsupported)
          .filter(
            (issue) =>
              !textEvidence ||
              issue !== 'Placeholder run style requires full text inheritance',
          )
          .map((issue) => `${part}#${placeholder.shapeId ?? idx}: ${issue}`),
      )
      const textStyle = placeholderTextStyle(
        textEvidence,
        issues,
        `${part}#${placeholder.shapeId ?? idx}`,
        decimalTabDeclaration?.decimalTab,
      )
      const textBody =
        placeholder.type === 'pic'
          ? undefined
          : placeholderTextBody(
              resolved.appearance?.textBody,
              issues,
              `${part}#${placeholder.shapeId ?? idx}`,
            )
      placeholders.push({
        index: idx,
        type: placeholder.type,
        ...box,
        ...(textStyle ? { textStyle } : {}),
        ...(textBody ? { textBody } : {}),
      })
    }
    const materialize = (sourcePart, scope) => {
      const names = new Set()
      const anchors = new Set()
      return sourceObjects
        .filter((object) => object.part === sourcePart && !object.placeholder)
        .flatMap((object) => {
          const geometryEntries = list(f.objectGeometry).find(
            (entry) => entry.part === sourcePart,
          )?.objects
          const colorEntries = list(f.resolvedObjectColors).find(
            (entry) => entry.part === sourcePart,
          )?.objects
          const fixed = fixedObject(
            object,
            locate(geometryEntries, object),
            locate(colorEntries, object),
            locate(
              list(f.resolvedObjectText).find(
                (entry) => entry.part === sourcePart,
              )?.objects,
              object,
            ),
            issues,
            `${scope}-${scope === 'master' ? masterId : name}`,
          )
          if (!fixed) return []
          if (names.has(fixed.name) || anchors.has(fixed.anchor)) {
            issues.push(
              `${sourcePart}: duplicate fixed object identity ${fixed.name}`,
            )
            return []
          }
          names.add(fixed.name)
          anchors.add(fixed.anchor)
          return [fixed]
        })
    }
    const masterObjects = parent ? materialize(parent, 'master') : []
    const fixedObjects = materialize(part, 'layout')
    const context = list(f.resolvedPartThemes).find(
      (entry) => entry.part === parent,
    )
    const family = context?.theme?.minorFonts?.latin?.typeface
    const colors = []
    for (let n = 1; n <= 6; n++) {
      const color = context?.colors?.[`accent${n}`]
      if (
        !rgb(color?.value) ||
        (color.alpha !== undefined && color.alpha !== 1)
      )
        break
      colors.push(rgb(color.value))
    }
    if (
      list(f.resolvedPartThemes).find((entry) => entry.part === part)
        ?.themeOverridePart !== context?.themeOverridePart
    )
      issues.push(
        `${part}: layout theme override cannot be collapsed into its shared master`,
      )
    const definition = {
      name,
      ...(masterId ? { masterId } : {}),
      ...(canvas ? { canvas } : {}),
      ...(family || colors.length
        ? {
            masterTheme: {
              ...(family ? { fontFamily: family } : {}),
              ...(colors.length ? { colors } : {}),
            },
          }
        : {}),
      ...(masterObjects.length
        ? { masterObjects: { canvas, objects: masterObjects } }
        : {}),
      ...(fixedObjects.length ? { fixedObjects } : {}),
      placeholders,
    }
    const complete = issues.length === 0
    const used = list(analysis.sourceGraph?.slides).some(
      (slide) => slide.layout === part,
    )
    candidates.push({
      id: part,
      name,
      source: {
        part,
        ...(parent ? { master: parent } : {}),
        ...(master?.theme ? { theme: master.theme } : {}),
        provenance: 'extracted',
      },
      ...(analyzed?.confidence === undefined
        ? {}
        : { confidence: analyzed.confidence }),
      semanticEvidence: [
        ...list(analyzed?.semanticEvidence),
        { kind: 'reachable-layout', value: String(used), sourcePart: part },
      ],
      ...(analyzed?.completeness
        ? { completeness: analyzed.completeness }
        : {}),
      generated: { status: complete ? 'complete' : 'partial', definition },
      issues: [...new Set([...list(analyzed?.issues), ...issues])],
      provenance: 'derived',
    })
    // Unused layouts remain evidence only; incomplete projections remain drafts.
    if (complete && used) definitions.push(definition)
  }
  return { sourceHash: analysis?.sourceHash, definitions, candidates }
}

function boxStyle(object, canvas) {
  return `position:absolute;left:${(object.x / canvas.width) * 100}%;top:${(object.y / canvas.height) * 100}%;width:${(object.width / canvas.width) * 100}%;height:${(object.height / canvas.height) * 100}%;box-sizing:border-box;padding:0;margin:0`
}

/** The browser and native writer consume the same coordinates and ownership. */
function languageAttributes(style) {
  return `${style?.language === undefined ? '' : ` lang="${escape(style.language)}"`}${style?.alternativeLanguage === undefined ? '' : ` data-fastppt-alt-lang="${escape(style.alternativeLanguage)}"`}`
}

export function sourceLayoutSfc(layout) {
  const canvas = layout.canvas
  const family = layout.masterTheme?.fontFamily
    ? JSON.stringify(layout.masterTheme.fontFamily)
        .replace(/</g, '\\3c ')
        .replace(/>/g, '\\3e ')
    : undefined
  const palette = list(layout.masterTheme?.colors)
  const groupStyle = [
    family ? `font-family:${family}` : '',
    ...palette.map(
      (color, index) => `--fastppt-master-accent-${index + 1}:#${color}`,
    ),
    palette[0] ? `--ext-primary:#${palette[0]}` : '',
    palette[1] ? `--ext-accent:#${palette[1]}` : '',
  ]
    .filter(Boolean)
    .join(';')
  const fixed = [
    ...list(layout.masterObjects?.objects).map((object) => ({
      object,
      scope: 'master',
      canvas: layout.masterObjects.canvas ?? canvas,
    })),
    ...list(layout.fixedObjects).map((object) => ({
      object,
      scope: 'layout',
      canvas,
    })),
  ]
    .map(({ object, scope, canvas }) => {
      const style = [
        boxStyle(object, canvas),
        'white-space:pre-wrap;line-height:1.2;font-kerning:normal;font-weight:400;font-style:normal;overflow:hidden;border:0',
        'text-align:left',
        `direction:${object.direction ?? 'ltr'}`,
        `text-decoration-line:${object.baselinePercent === undefined && object.kerningThreshold === undefined && object.capitalization === undefined ? textDecorationLine(object) : 'none'}`,
        `letter-spacing:${((object.letterSpacing ?? 0) * 12700 / canvas.width) * 100}cqw`,
        'text-decoration-style:solid;text-decoration-color:currentColor;text-decoration-skip-ink:none',
        object.fill ? `background:#${object.fill}` : 'background:transparent',
        object.color ? `color:#${object.color}` : '',
        object.fontFamily
          ? `font-family:${JSON.stringify(object.fontFamily).replace(/</g, '\\3c ').replace(/>/g, '\\3e ')}`
          : '',
        object.fontSize === undefined
          ? ''
          : `font-size:${((object.fontSize * 12700) / canvas.width) * 100}cqw`,
      ]
        .filter(Boolean)
        .join(';')
      return `<div v-pre${object.direction === undefined ? '' : ` dir="${object.direction}"`}${languageAttributes(object)} data-fastppt-group="${escape(object.anchor)}" data-fastppt-layout="${escape(layout.name)}" data-fastppt-layout-object="${escape(object.name)}" data-fastppt-object-scope="${scope}" style="${escape(style)}">${object.baselinePercent === undefined && object.kerningThreshold === undefined && object.capitalization === undefined ? escape(object.text ?? '') : `<span${object.capitalization === undefined ? '' : ` data-fastppt-text-capitalization-run="${escape(JSON.stringify(object.capitalization))}"`} data-fastppt-text-baseline-run="${object.baselinePercent ?? 0}"${object.kerningThreshold === undefined ? '' : ` data-fastppt-text-kerning="${escape(JSON.stringify({ threshold: object.kerningThreshold, canvasWidth: canvas.width }))}"`} style="${object.capitalization === undefined ? '' : `text-transform:${object.capitalization === 'all' ? 'uppercase' : 'none'};font-variant-caps:${object.capitalization === 'small' ? 'small-caps' : 'normal'};`}position:relative;top:${-(object.baselinePercent ?? 0) / 100}em;vertical-align:baseline;text-decoration-line:${textDecorationLine(object)};text-decoration-style:solid;text-decoration-color:currentColor;text-decoration-skip-ink:none">${escape(object.text ?? '')}</span>`}</div>`
    })
    .join('\n')
  const slots = layout.placeholders
    .map((slot) => {
      const text = slot.textStyle
      const body = slot.textBody
      const inset = (side, fallback) => body?.insets?.[side] ?? fallback
      const style = [
        boxStyle(slot, canvas),
        // Match DrawingML's default bodyPr insets when no local body contract
        // is present. Percentages resolve against this container's width.
        body
          ? `padding:${(inset('top', 45720) / canvas.height) * 100}cqh ${(inset('right', 91440) / canvas.width) * 100}cqw ${(inset('bottom', 45720) / canvas.height) * 100}cqh ${(inset('left', 91440) / canvas.width) * 100}cqw`
          : `padding:${(45720 / canvas.width) * 100}cqw ${(91440 / canvas.width) * 100}cqw`,
        text?.fontFamily
          ? `font-family:${JSON.stringify(text.fontFamily).replace(/</g, '\\3c ').replace(/>/g, '\\3e ')}`
          : '',
        text?.fontSize === undefined
          ? ''
          : `font-size:${((text.fontSize * 12700) / canvas.width) * 100}cqw`,
        text?.color ? `color:#${text.color}` : '',
        text
          ? `text-align:${text.paragraph?.align === 'right' ? 'right' : text.paragraph?.align === 'center' ? 'center' : text.paragraph?.align === 'justify' ? 'justify' : 'left'};line-height:1.2;letter-spacing:${((text.letterSpacing ?? 0) * 12700 / canvas.width) * 100}cqw;font-kerning:normal;direction:${text.paragraph?.direction ?? 'ltr'};white-space:pre-wrap;text-decoration:none`
          : '',
        text?.bold === undefined ? '' : `font-weight:${text.bold ? 700 : 400}`,
        text?.italic === undefined
          ? ''
          : `font-style:${text.italic ? 'italic' : 'normal'}`,
        ...(body
          ? [
              `display:flex;flex-direction:column;justify-content:${{ top: 'flex-start', middle: 'center', bottom: 'flex-end' }[body.verticalAlign ?? 'top']}`,
              `white-space:${body.wrap === false ? 'pre' : 'pre-wrap'}`,
            ]
          : []),
      ]
        .filter(Boolean)
        .join(';')
      const content = `<slot name="ph-${slot.index}" />`
      const fonts = text?.fontFamilies
      const hasParagraphContract = text?.levels || text?.paragraph || text?.underline !== undefined || text?.strike !== undefined || text?.letterSpacing !== undefined || text?.baselinePercent !== undefined || text?.kerningThreshold !== undefined || text?.capitalization !== undefined
      const rendered = hasParagraphContract
        ? `<ScriptFonts :text-style="${escape(JSON.stringify(text))}" :canvas-width="${canvas.width}">${content}</ScriptFonts>`
        : fonts
          ? `<ScriptFonts :fonts="${escape(JSON.stringify(fonts))}" :fallback="${escape(JSON.stringify(text.fontFamily ?? ''))}">${content}</ScriptFonts>`
          : content
      return `<div${text?.paragraph?.direction === undefined ? '' : ` dir="${text.paragraph.direction}"`}${languageAttributes(text)} data-fastppt-placeholder-index="${slot.index}"${body ? ' data-fastppt-source-text-frame=""' : ''} style="${escape(style)}${hasParagraphContract ? ';display:flex;flex-direction:column' : ''}">${rendered}</div>`
    })
    .join('\n')
  return `<script setup>\n${sourceKerningSetup}\n${layout.placeholders.some((slot) => slot.textStyle?.fontFamilies || slot.textStyle?.levels || slot.textStyle?.paragraph || slot.textStyle?.underline !== undefined || slot.textStyle?.strike !== undefined || slot.textStyle?.letterSpacing !== undefined || slot.textStyle?.baselinePercent !== undefined || slot.textStyle?.kerningThreshold !== undefined || slot.textStyle?.capitalization !== undefined) ? scriptFontsSetup : ''}\n</script>\n<template>
  <div ref="kerningRoot" class="slidev-layout source-layout" style="${escape(groupStyle)}">
    <section class="source-fixed">${fixed}</section>
    <section class="source-slots">${slots}</section>
    <div class="source-content"><slot /></div>
  </div>
</template>
<style scoped>
.source-layout { position:relative; container-type:size; padding:0; background:#fff; }
.source-fixed, .source-slots { position:absolute; inset:0; }
.source-fixed { z-index:0; pointer-events:none; }
.source-slots, .source-content { z-index:1; }
.source-content { position:relative; }
.source-slots :deep(p), .source-slots :deep(h1), .source-slots :deep(h2) { margin:0; }
${layout.placeholders.some((slot) => slot.textStyle) ? '.source-slots :deep(p), .source-slots :deep(h1), .source-slots :deep(h2), .source-slots :deep(h3) { font-family:inherit; font-size:inherit; font-weight:inherit; font-style:inherit; color:inherit; }' : ''}
${family ? `.source-content :deep(h1), .source-content :deep(h2), .source-content :deep(h3) { font-family:${family}; }` : ''}
</style>
`
}
