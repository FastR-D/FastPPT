#!/usr/bin/env node
import { preserveTextFrameTabs } from './lib/text-frame-tabs.mjs'
import { sourceNativeLayouts, sourceLayoutSfc } from './lib/source-layouts.mjs'
import { validateDecimalTabDeclaration } from './lib/text-tabs.mjs'
/**
 * Extract a visual theme from an existing `.pptx` and generate a FastPPT Slidev
 * theme package. This analyzer references the pptx-renderer parsing model:
 *   - theme color scheme (12 slots, sysClr lastClr) + master colorMap remap
 *   - schemeClr modifiers (tint / shade / lumMod / lumOff / satMod / alpha)
 *   - fmtScheme fill signature (gradient/solid that anchors the deck's look)
 *   - actual fonts used across slides (a:latin / a:ea, by frequency)
 *   - dominant colors used across slides (solid fills + gradient stops)
 *   - background resolution (slide -> layout -> master chain)
 *   - title/body typography scale from text runs
 * It then writes a buildable `slidev-theme-<slug>` under `themes/`.
 *
 * Usage:
 *   node scripts/extract-theme.mjs <input.pptx> --name <slug> [--out themes]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'

// jszip is a dependency of @fastppt/slidewave. Resolve it from the repo layout
// (dev) or the packaged CLI layout (dist/node_modules/@fastppt/slidewave).
async function resolveJszip() {
  const candidates = [
    new URL('../packages/slidewave/package.json', import.meta.url),
    new URL('../node_modules/@fastppt/slidewave/package.json', import.meta.url),
  ]
  for (const candidate of candidates) {
    try {
      return (await import(createRequire(candidate).resolve('jszip'))).default
    } catch {
      /* try next */
    }
  }
  throw new Error('Could not resolve jszip for theme extraction')
}
const JSZip = await resolveJszip()

function parseArgs(argv) {
  const args = { _: [], name: undefined, out: 'themes' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--name') args.name = argv[++i]
    else if (arg === '--out') args.out = argv[++i]
    else if (arg === '--analysis') args.analysis = argv[++i]
    else if (arg === '--decimal-tabs') {
      args.decimalTabs = argv[++i]
      if (!args.decimalTabs || args.decimalTabs.startsWith('--')) throw new Error('--decimal-tabs requires a declaration JSON path')
    }
    else args._.push(arg)
  }
  return args
}

// ---------- color helpers (pptx-renderer math) ----------

function hexToRgb(hex) {
  const value = hex.replace('#', '')
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  }
}

function rgbToHex(r, g, b) {
  const to = (v) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase()
}

function srgbToLinear(v) {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(v) {
  const c = Math.max(0, Math.min(1, v))
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}

function rgbToHsl(r, g, b) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h /= 6
  return { h, s, l }
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  }
}

/** Parse color modifiers from a color node's attribute + child markup. */
function collectModifiers(markup) {
  const mods = []
  const re =
    /<a:(tint|shade|lumMod|lumOff|satMod|satOff|alpha|hueMod|hueOff) val="(-?\d+)"/g
  let match
  while ((match = re.exec(markup))) {
    mods.push({ name: match[1], val: Number(match[2]) })
  }
  return mods
}

function applyModifiers(hex, mods) {
  let color = hex
  for (const mod of mods) {
    if (mod.name === 'tint') {
      const { r, g, b } = hexToRgb(color)
      const t = mod.val / 100000
      const rl = srgbToLinear(r),
        gl = srgbToLinear(g),
        bl = srgbToLinear(b)
      color = rgbToHex(
        linearToSrgb(rl * t + (1 - t)) * 255,
        linearToSrgb(gl * t + (1 - t)) * 255,
        linearToSrgb(bl * t + (1 - t)) * 255,
      )
    } else if (mod.name === 'shade') {
      const { r, g, b } = hexToRgb(color)
      const s = mod.val / 100000
      color = rgbToHex(
        linearToSrgb(srgbToLinear(r) * s) * 255,
        linearToSrgb(srgbToLinear(g) * s) * 255,
        linearToSrgb(srgbToLinear(b) * s) * 255,
      )
    } else if (mod.name === 'lumMod' || mod.name === 'lumOff') {
      const { r, g, b } = hexToRgb(color)
      const { h, s, l } = rgbToHsl(r, g, b)
      const newL =
        mod.name === 'lumMod' ? l * (mod.val / 100000) : l + mod.val / 100000
      const out = hslToRgb(h, s, Math.max(0, Math.min(1, newL)))
      color = rgbToHex(out.r, out.g, out.b)
    }
    // satMod / alpha / hue are not needed for palette extraction.
  }
  return color
}

/** Resolve a color element's inner XML to a hex string using the theme + master color map.
    `phClr` resolves against `phClrBase` (e.g. the bgRef's scheme color). */
function resolveColorInner(inner, colorMap, themeColors, phClrBase) {
  const srgbSelf = /<a:srgbClr val="([0-9A-Fa-f]{6})"([^>]*)\/>/.exec(inner)
  if (srgbSelf) {
    return applyModifiers(
      `#${srgbSelf[1].toUpperCase()}`,
      collectModifiers(srgbSelf[2]),
    )
  }
  const srgb =
    /<a:srgbClr val="([0-9A-Fa-f]{6})"([^>]*)\/?>([\s\S]*?)<\/a:srgbClr>/.exec(
      inner,
    )
  if (srgb) {
    return applyModifiers(
      `#${srgb[1].toUpperCase()}`,
      collectModifiers(srgb[2] + srgb[3]),
    )
  }
  const schemeSelf = /<a:schemeClr val="(\w+)"([^>]*)\/>/.exec(inner)
  if (schemeSelf) {
    if (schemeSelf[1].toLowerCase() === 'phclr' && phClrBase) {
      return applyModifiers(phClrBase, collectModifiers(schemeSelf[2]))
    }
    const mapped = colorMap[schemeSelf[1]] ?? schemeSelf[1]
    const base = themeColors[mapped] ?? themeColors[schemeSelf[1]]
    if (base) return applyModifiers(base, collectModifiers(schemeSelf[2]))
    return undefined
  }
  const scheme =
    /<a:schemeClr val="(\w+)"([^>]*)>([\s\S]*?)<\/a:schemeClr>/.exec(inner)
  if (scheme) {
    if (scheme[1].toLowerCase() === 'phclr' && phClrBase) {
      return applyModifiers(phClrBase, collectModifiers(scheme[2] + scheme[3]))
    }
    const mapped = colorMap[scheme[1]] ?? scheme[1]
    const base = themeColors[mapped] ?? themeColors[scheme[1]]
    if (base)
      return applyModifiers(base, collectModifiers(scheme[2] + scheme[3]))
    return undefined
  }
  const sys = /<a:sysClr[^>]*val="(\w+)"[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(
    inner,
  )
  if (sys) return `#${sys[2].toUpperCase()}`
  const sysPlain = /<a:sysClr[^>]*val="(\w+)"/.exec(inner)
  if (sysPlain) {
    const value = sysPlain[1]
    if (value === 'window') return '#FFFFFF'
    if (value === 'windowText') return '#000000'
    return '#000000'
  }
  return undefined
}

// ---------- theme scheme ----------

const COLOR_SLOTS = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
]

function extractThemeScheme(themeXml) {
  const scheme = /<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(
    themeXml,
  )?.[1]
  const colors = {}
  if (scheme) {
    for (const slot of COLOR_SLOTS) {
      const inner = new RegExp(`<a:${slot}>([\\s\\S]*?)</a:${slot}>`).exec(
        scheme,
      )?.[1]
      const srgb = inner && /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(inner)?.[1]
      const sysLast =
        inner && /<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(inner)?.[1]
      const sysVal =
        inner &&
        /<a:sysClr[^>]*val="(window|windowText|buttonFace|buttonText|highlightText|highlight)"/.exec(
          inner,
        )?.[1]
      if (srgb) colors[slot] = `#${srgb.toUpperCase()}`
      else if (sysLast) colors[slot] = `#${sysLast.toUpperCase()}`
      else if (sysVal === 'window' || sysVal === 'buttonFace')
        colors[slot] = '#FFFFFF'
      else if (sysVal === 'windowText' || sysVal === 'buttonText')
        colors[slot] = '#000000'
    }
  }
  const fonts = {
    major: 'Inter',
    minor: 'Inter',
    majorEa: 'Noto Sans SC',
    minorEa: 'Noto Sans SC',
  }
  const fontScheme = /<a:fontScheme[^>]*>([\s\S]*?)<\/a:fontScheme>/.exec(
    themeXml,
  )?.[1]
  if (fontScheme) {
    const major = /<a:majorFont>([\s\S]*?)<\/a:majorFont>/.exec(fontScheme)?.[1]
    const minor = /<a:minorFont>([\s\S]*?)<\/a:minorFont>/.exec(fontScheme)?.[1]
    fonts.major =
      /<a:latin typeface="([^"]*)"/.exec(major ?? '')?.[1] || fonts.major
    fonts.minor =
      /<a:latin typeface="([^"]*)"/.exec(minor ?? '')?.[1] || fonts.minor
    fonts.majorEa =
      /<a:ea typeface="([^"]*)"/.exec(major ?? '')?.[1] || fonts.majorEa
    fonts.minorEa =
      /<a:ea typeface="([^"]*)"/.exec(minor ?? '')?.[1] || fonts.minorEa
  }
  // fmtScheme signature: first fillStyle (often the deck's anchor gradient).
  const fillLst = /<a:fillStyleLst>([\s\S]*?)<\/a:fillStyleLst>/.exec(
    themeXml,
  )?.[1]
  let signature = undefined
  if (fillLst) {
    const first =
      /<(?:a:solidFill|a:gradFill)[^>]*>([\s\S]*?)<\/(?:a:solidFill|a:gradFill)>/.exec(
        fillLst,
      )?.[0]
    if (first) {
      if (/<a:solidFill>/.test(first)) {
        const inner = first.replace(/<a:solidFill>|<\/a:solidFill>/g, '')
        const color = resolveColorInner(inner, {}, colors)
        if (color) signature = { type: 'solid', color }
      } else if (/<a:gradFill/.test(first)) {
        const stops = [
          ...first.matchAll(/<a:gs pos="(\d+)">([\s\S]*?)<\/a:gs>/g),
        ]
          .map((m) => {
            const color = resolveColorInner(m[2], {}, colors)
            return color
              ? { position: Number(m[1]) / 100000, color }
              : undefined
          })
          .filter(Boolean)
        const angleMatch = /<a:lin[^>]*ang="(\d+)"/.exec(first)
        if (stops.length >= 2) {
          signature = {
            type: 'gradient',
            stops,
            angle: angleMatch ? (Number(angleMatch[1]) / 60000) % 360 : 0,
          }
        }
      }
    }
  }
  return { colors, fonts, signature }
}

function extractMasterColorMap(masterXml) {
  const map = {}
  if (!masterXml) return map
  const clrMap = /<p:clrMap[^>]*\/>/.exec(masterXml)?.[0]
  if (clrMap) {
    for (const attr of [
      'bg1',
      'tx1',
      'bg2',
      'tx2',
      'accent1',
      'accent2',
      'accent3',
      'accent4',
      'accent5',
      'accent6',
      'hlink',
      'folHlink',
    ]) {
      const value = new RegExp(`${attr}="(\\w+)"`).exec(clrMap)?.[1]
      if (value) map[attr] = value
    }
  }
  return map
}

// ---------- slide-level analysis ----------

function mapFont(family) {
  const name = (family ?? '').trim()
  const lower = name.toLowerCase()
  if (/yahei|微软雅黑/.test(lower)) return 'Noto Sans SC'
  if (
    name === 'Arial' ||
    name === 'Calibri' ||
    name === 'Helvetica' ||
    name === 'Arial Narrow'
  )
    return 'Inter'
  if (/song|simsun/.test(lower)) return 'Noto Serif SC'
  if (/times|georgia/.test(lower)) return 'Noto Serif SC'
  return name
}

/** Map OOXML theme-font placeholders to concrete theme font faces. */
function resolvePlaceholder(family, themeFonts) {
  const map = {
    '+mn-lt': themeFonts.minor,
    '+mn-ea': themeFonts.minorEa,
    '+mj-lt': themeFonts.major,
    '+mj-ea': themeFonts.majorEa,
  }
  return map[family] ?? family
}

/** Collect fonts + dominant colors + typography from all slides. */
function analyzeSlides(slideXmls, colorMap, themeColors, themeFonts) {
  const fonts = new Map() // family -> count
  const colors = new Map() // hex -> count
  const sizes = []
  let titleTotal = 0
  let titleCount = 0
  let bodyTotal = 0
  let bodyCount = 0

  const countColor = (hex) => {
    if (!hex) return
    const key = hex.toUpperCase()
    colors.set(key, (colors.get(key) ?? 0) + 1)
  }
  const countFont = (family) => {
    if (!family) return
    const resolved = resolvePlaceholder(family, themeFonts)
    fonts.set(resolved, (fonts.get(resolved) ?? 0) + 1)
  }

  for (const xml of slideXmls) {
    // Fonts: every a:latin / a:ea typeface.
    const fontRe = /<a:(?:latin|ea)\b[^>]*typeface="([^"]*)"/g
    let fm
    while ((fm = fontRe.exec(xml))) countFont(fm[1])

    // Solid fills (shapes + text).
    const fillRe = /<a:solidFill>([\s\S]*?)<\/a:solidFill>/g
    let fm2
    while ((fm2 = fillRe.exec(xml))) {
      countColor(resolveColorInner(fm2[1], colorMap, themeColors))
    }
    // Gradient stops.
    const stopRe = /<a:gsLst>([\s\S]*?)<\/a:gsLst>/g
    let sm
    while ((sm = stopRe.exec(xml))) {
      const inner = sm[1]
      const colorRe =
        /<a:schemeClr val="(\w+)"[^>]*>([\s\S]*?)<\/a:schemeClr>|<a:srgbClr val="([0-9A-Fa-f]{6})"/g
      let cm
      while ((cm = colorRe.exec(inner))) {
        if (cm[3]) countColor(`#${cm[3].toUpperCase()}`)
        else if (cm[1]) {
          const mapped = colorMap[cm[1]] ?? cm[1]
          const base = themeColors[mapped] ?? themeColors[cm[1]]
          if (base)
            countColor(applyModifiers(base, collectModifiers(cm[2] ?? '')))
        }
      }
    }

    // Typography: title runs (in a title-ish context: larger sz, first text) vs body.
    const szRe = /<a:rPr[^>]*sz="(\d+)"[^>]*>/g
    let szm
    while ((szm = szRe.exec(xml))) {
      sizes.push(Number(szm[1]))
    }
  }
  sizes.sort((a, b) => b - a)
  const titleSz = sizes.find((s) => s >= 1800) // >=18pt
  const bodySz = sizes.find((s) => s < 1800)
  if (titleSz) {
    titleTotal += titleSz
    titleCount = 1
  }
  if (bodySz) {
    bodyTotal += bodySz
    bodyCount = 1
  }

  const sortedColors = [...colors.entries()].sort((a, b) => b[1] - a[1])
  const sortedFonts = [...fonts.entries()].sort((a, b) => b[1] - a[1])

  // Per-slide content structure: which graphic types dominate each page.
  const slideContent = []
  for (const xml of slideXmls) {
    const pics = (xml.match(/<p:pic>/g) ?? []).length
    const tables = (xml.match(/<a:tbl>/g) ?? []).length
    const charts = (xml.match(/<c:chart>/g) ?? []).length
    const shapes = (xml.match(/<p:sp>/g) ?? []).length
    const twoCol = /<a:bodyPr[^>]*colCnt="[2-9]"/.test(xml)
    slideContent.push({ pics, tables, charts, shapes, twoCol })
  }
  const any = (fn) => slideContent.some(fn)
  const suggestedLayouts = ['cover', 'section', 'ending']
  if (any((c) => c.charts > 0 || c.tables > 0)) suggestedLayouts.push('data')
  if (
    any((c) => c.twoCol || (c.pics === 0 && c.tables === 0 && c.shapes <= 12))
  ) {
    if (!suggestedLayouts.includes('two-col')) suggestedLayouts.push('two-col')
  }
  if (any((c) => c.pics > 0)) suggestedLayouts.push('image-right')
  if (any((c) => c.shapes > 16 && c.charts === 0))
    suggestedLayouts.push('metrics')
  const suggestedComponents = []
  const calloutLike =
    /<a:prstGeom prst="(?:roundRect|rect)">[\s\S]*?<a:solidFill>[\s\S]*?<a:t>/g
  if (calloutLike.test(slideXmls.join('\n')))
    suggestedComponents.push('callout')
  if (/<a:t>\s*\d{2,}[.,]?\d*\s*<\/a:t>/.test(slideXmls.join('\n'))) {
    suggestedComponents.push('stat')
  }
  suggestedComponents.push('pill')

  return {
    fontUsage: sortedFonts.map(([family, count]) => ({ family, count })),
    dominantColors: sortedColors.map(([hex, count]) => ({ hex, count })),
    typography: {
      titleSizePt: titleCount ? Math.round(titleTotal / titleCount / 100) : 24,
      bodySizePt: bodyCount ? Math.round(bodyTotal / bodyCount / 100) : 16,
    },
    slideContent,
    suggestedLayouts,
    suggestedComponents,
  }
}

/** Resolve a bgFillStyleLst child (from the theme fmtScheme) by bgRef index.
    The bgRef's own scheme color is the phClr base for the referenced fill. */
function resolveBgRef(idx, bgFillStyles, colorMap, themeColors, refInner) {
  const index = Number(idx) - 1001
  const markup = bgFillStyles[index]
  if (!markup) return undefined
  let phClrBase
  const refScheme = /<a:schemeClr val="(\w+)"/.exec(refInner ?? '')
  if (refScheme) {
    const mapped = colorMap[refScheme[1]] ?? refScheme[1]
    phClrBase = themeColors[mapped] ?? themeColors[refScheme[1]]
  }
  if (/<a:blipFill/.test(markup)) return { type: 'image' }
  if (/<a:solidFill>/.test(markup)) {
    const inner = markup.replace(/<a:solidFill>|<\/a:solidFill>/g, '')
    const color = resolveColorInner(inner, {}, {}, phClrBase)
    return color ? { type: 'solid', color } : undefined
  }
  if (/<a:gradFill/.test(markup)) {
    const stops = [...markup.matchAll(/<a:gs pos="(\d+)">([\s\S]*?)<\/a:gs>/g)]
      .map((m) => {
        const color = resolveColorInner(m[2], {}, {}, phClrBase)
        return color ? { position: Number(m[1]) / 100000, color } : undefined
      })
      .filter(Boolean)
    if (stops.length >= 2) return { type: 'gradient', stops }
  }
  return undefined
}

function extractBackground(
  slideXml,
  layoutXmls,
  masterXml,
  bgFillStyles,
  colorMap,
  themeColors,
) {
  const candidate = (xml, kind) => {
    const bg = new RegExp(`<${kind}:bg>([\\s\\S]*?)</${kind}:bg>`).exec(
      xml ?? '',
    )?.[1]

    if (!bg) return undefined
    const ref = /<p:bgRef[^>]*idx="(\d+)">([\s\S]*?)<\/p:bgRef>/.exec(bg)

    if (ref)
      return resolveBgRef(ref[1], bgFillStyles, colorMap, themeColors, ref[2])
    const fill =
      /<(?:a:solidFill|a:gradFill|a:blipFill)>([\s\S]*?)<\/(?:a:solidFill|a:gradFill|a:blipFill)>/.exec(
        bg,
      )?.[0]
    if (!fill) return undefined
    if (/<a:blipFill/.test(fill)) return { type: 'image' }
    if (/<a:solidFill>/.test(fill)) {
      const inner = fill.replace(/<a:solidFill>|<\/a:solidFill>/g, '')
      const color = resolveColorInner(inner, {}, {})
      return color ? { type: 'solid', color } : undefined
    }
    return undefined
  }
  return (
    candidate(slideXml, 'p', colorMap, themeColors) ??
    candidate(layoutXmls.at(-1) ?? '', 'p', colorMap, themeColors) ??
    candidate(masterXml, 'p', colorMap, themeColors)
  )
}

function slideSize(presentationXml) {
  const size = /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(presentationXml)
  if (!size) return { width: 1280, height: 720, ratio: '16/9' }
  const width = Math.round(Number(size[1]) / 9525)
  const height = Math.round(Number(size[2]) / 9525)
  const ratio =
    Math.abs(width / height - 16 / 9) < 0.05
      ? '16/9'
      : Math.abs(width / height - 4 / 3) < 0.05
        ? '4/3'
        : `${width}/${height}`
  return { width, height, ratio }
}

async function extractTheme(inputPath, sourceAnalysis, decimalTabDeclaration) {
  const bytes = await readFile(inputPath)
  if (
    sourceAnalysis &&
    sourceAnalysis.sourceHash !==
      createHash('sha256').update(bytes).digest('hex')
  )
    throw new Error('Source analysis hash does not match the input PPTX')
  if (decimalTabDeclaration !== undefined) {
    if (!sourceAnalysis?.sourceGraph) throw new Error('--decimal-tabs requires structured source analysis via --analysis')
    validateDecimalTabDeclaration(decimalTabDeclaration, sourceAnalysis.sourceHash)
  }
  const zip = await JSZip.loadAsync(bytes)

  const graph = sourceAnalysis?.sourceGraph
  const first = graph?.slides?.[0]
  const primaryTheme =
    first?.theme ?? graph?.masters?.find((master) => master.theme)?.theme
  const themeXml =
    await zip.files[primaryTheme ?? 'ppt/theme/theme1.xml'].async('string')
  const presentationXml =
    await zip.files[graph?.presentationPart ?? 'ppt/presentation.xml'].async(
      'string',
    )

  // Background chain: slide -> layout -> master.
  const slideNames = graph
    ? graph.slides.map((slide) => slide.part)
    : Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort()
  const slideXmls = []
  for (const name of slideNames)
    slideXmls.push(await zip.files[name].async('string'))
  const masterName =
    first?.master ??
    graph?.masters?.[0]?.part ??
    Object.keys(zip.files).find((name) =>
      /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name),
    )
  const masterXml = masterName
    ? await zip.files[masterName].async('string')
    : undefined
  const layoutNames = graph
    ? first?.layout
      ? [first.layout]
      : []
    : Object.keys(zip.files)
        .filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name))
        .sort()
  const layoutXmls = []
  for (const name of layoutNames)
    layoutXmls.push(await zip.files[name].async('string'))

  const scheme = extractThemeScheme(themeXml)
  const tokenEvidence = []
  const tokenLimitations = []
  const definition = sourceAnalysis?.extractedFeatures?.themeDefinitions?.find(
    (theme) => theme.part === primaryTheme,
  )
  // Prefer the importer’s typed, relationship-aware values when available.
  // The legacy XML fallback below keeps this standalone script useful for
  // callers that do not provide an ImportAnalysis document.
  const typedTheme =
    sourceAnalysis?.extractedFeatures?.resolvedSlideThemeColors?.find(
      (entry) => entry.part === first?.part,
    ) ??
    sourceAnalysis?.extractedFeatures?.resolvedThemeColors?.find(
      (entry) => entry.part === primaryTheme,
    )
  if (definition) {
    if (typedTheme?.colors) {
      for (const [role, resolved] of Object.entries(typedTheme.colors)) {
        if (!resolved?.value) continue
        scheme.colors[role] = resolved.value
        tokenEvidence.push({
          kind: 'color',
          role,
          part: resolved.source?.sourcePart ?? typedTheme.themePart ?? definition.part,
          value: resolved.value,
          source: resolved.source,
          transforms: resolved.transforms,
        })
      }
      for (const role of typedTheme.unresolved ?? []) {
        delete scheme.colors[role]
        tokenLimitations.push(
          `Unresolved source color ${role}; generated semantic fallback may be used.`,
        )
      }
    } else {
      for (const color of definition.colors ?? []) {
        const raw =
          color.kind === 'srgbClr'
            ? color.attributes?.val
            : color.kind === 'sysClr'
              ? color.attributes?.lastClr
              : undefined
        const transforms = color.transforms ?? []
        if (
          !/^[0-9a-f]{6}$/i.test(raw ?? '') ||
          transforms.some(
            (transform) =>
              !['tint', 'shade', 'lumMod', 'lumOff'].includes(transform.kind) ||
              !Number.isFinite(Number(transform.attributes?.val)),
          )
        ) {
          delete scheme.colors[color.role]
          tokenLimitations.push(
            `Unresolved source color ${color.role}; generated semantic fallback may be used.`,
          )
          continue
        }
        scheme.colors[color.role] = applyModifiers(
          `#${raw.toUpperCase()}`,
          transforms.map((transform) => ({
            name: transform.kind,
            val: Number(transform.attributes.val),
          })),
        )
        tokenEvidence.push({
          kind: 'color',
          role: color.role,
          part: definition.part,
          value: scheme.colors[color.role],
        })
      }
    }
    for (const [collection, latinKey, eastAsianKey] of [
      [definition.majorFonts, 'major', 'majorEa'],
      [definition.minorFonts, 'minor', 'minorEa'],
    ]) {
      if (!collection) continue
      const latin = collection.latin?.typeface
      const eastAsian =
        collection.eastAsian?.typeface ||
        collection.scripts?.find((font) => font.script === 'Hans')?.typeface
      if (latin) {
        scheme.fonts[latinKey] = latin
        tokenEvidence.push({
          kind: 'font',
          role: latinKey,
          part: definition.part,
          value: latin,
        })
      }
      if (eastAsian) {
        scheme.fonts[eastAsianKey] = eastAsian
        tokenEvidence.push({
          kind: 'font',
          role: eastAsianKey,
          part: definition.part,
          value: eastAsian,
        })
      }
    }
  }
  const colorMap =
    sourceAnalysis?.extractedFeatures?.resolvedColorMaps?.find(
      (map) => map.part === first?.part,
    )?.mapping ?? extractMasterColorMap(masterXml)
  const bgLst = /<a:bgFillStyleLst>([\s\S]*?)<\/a:bgFillStyleLst>/.exec(
    themeXml,
  )?.[1]
  const bgFillStyles = bgLst
    ? [
        ...bgLst.matchAll(
          /<(?:a:solidFill|a:gradFill|a:blipFill)[^>]*>([\s\S]*?)<\/(?:a:solidFill|a:gradFill|a:blipFill)>/g,
        ),
      ].map((m) => m[0])
    : []
  const slides = analyzeSlides(slideXmls, colorMap, scheme.colors, scheme.fonts)
  const typedBackground =
    sourceAnalysis?.extractedFeatures?.resolvedBackgroundAppearances?.find(
      (entry) => entry.part === first?.part,
    )
  const background = typedBackground?.kind === 'solid' && typedBackground.color?.value
    ? { type: 'solid', color: typedBackground.color.value }
    : extractBackground(
    slideXmls[0],
    layoutXmls,
    masterXml,
    bgFillStyles,
    colorMap,
    scheme.colors,
  )

  const canvas = sourceAnalysis?.extractedFeatures?.canvas
  const size = canvas
    ? {
        width: canvas.widthEmu / 9525,
        height: canvas.heightEmu / 9525,
        ratio: `${canvas.widthEmu}/${canvas.heightEmu}`,
      }
    : slideSize(presentationXml)
  if (
    ![size.width, size.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error('Invalid analyzed canvas dimensions')

  const nativeLayoutArtifacts = sourceNativeLayouts(sourceAnalysis, decimalTabDeclaration)

  return {
    scheme,
    colorMap,
    slides,
    background,
    size,
    nativeLayoutArtifacts,
    sourceSelection: graph
      ? {
          sourceHash: sourceAnalysis.sourceHash,
          ...(sourceAnalysis.decimalTabConvention ? { decimalTabConvention: sourceAnalysis.decimalTabConvention } : {}),
          ...(decimalTabDeclaration === undefined ? {} : { decimalTabDeclaration }),
          canvas,
          tokenEvidence,
          tokenLimitations,
          presentation: graph.presentationPart,
          primaryTheme,
          firstSlide: first?.part,
          firstLayout: first?.layout,
          firstMaster: masterName,
          limitations:
            [
              ...new Set(
                graph.slides.map((slide) => slide.theme).filter(Boolean),
              ),
            ].length > 1
              ? [
                  'Multiple source themes exist; this generated candidate uses the first page theme as its primary brand.',
                ]
              : [],
        }
      : undefined,
  }
}

function slugify(value, fallback) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug || fallback
}

// ---------- theme generation ----------

async function generateTheme(slug, analysis, outDir, sourceName) {
  const dir = join(resolve(outDir), `slidev-theme-${slug}`)
  await mkdir(join(dir, 'components'), { recursive: true })
  await mkdir(join(dir, 'styles'), { recursive: true })
  await mkdir(join(dir, 'layouts'), { recursive: true })
  await mkdir(join(dir, 'agent'), { recursive: true })

  const version = '0.1.0-extracted.1'
  const c = analysis.scheme.colors
  const d = analysis.slides.dominantColors
  const dominant = d.map((entry) => entry.hex)

  // Semantic palette: primary from the most-used saturated accent among the
  // dominant colors, falling back to the theme accent slots.
  const isNeutral = (hex) => {
    const { r, g, b } = hexToRgb(hex)
    return Math.abs(r - g) < 24 && Math.abs(g - b) < 24
  }
  const midToneDominant = dominant.find((hex) => {
    if (isNeutral(hex)) return false
    const { r, g, b } = hexToRgb(hex)
    const { l } = rgbToHsl(r, g, b)
    return l >= 0.25 && l <= 0.85
  })
  const primary = midToneDominant ?? c.accent1 ?? c.dk2 ?? '#1f2937'
  const secondary = c.accent2 ?? c.accent6 ?? c.dk2 ?? '#374151'
  const bg = analysis.background?.color ?? c.lt1 ?? '#ffffff'
  const text =
    c.dk1 ?? dominant.find((hex) => isNeutral(hex) && hex !== bg) ?? '#111111'
  const neutralDominant = dominant.find(
    (hex) => isNeutral(hex) && hex !== bg && hex !== text,
  )
  const accent =
    dominant.find(
      (hex, index) =>
        index > 0 && !isNeutral(hex) && hex.toLowerCase() !== bg.toLowerCase(),
    ) ??
    c.accent4 ??
    c.accent3 ??
    '#6b7280'
  const muted =
    c.lt2 ?? neutralDominant ?? (c.dk2 && c.dk2 !== text ? c.dk2 : '#6b7280')
  const surface =
    c.accent3 ??
    c.accent5 ??
    dominant.find((hex) => isNeutral(hex) && hex !== bg && hex !== text) ??
    '#f3f4f6'

  // Fonts: prefer actual slide fonts, fall back to theme minor/major.
  const actualSans = analysis.slides.fontUsage.find(
    (f) => !/mono|courier/i.test(f.family),
  )?.family
  const actualMono = analysis.slides.fontUsage.find((f) =>
    /mono|courier/i.test(f.family),
  )?.family
  const sans = mapFont(actualSans ?? analysis.scheme.fonts.minor)
  const serif = mapFont(analysis.scheme.fonts.major)
  const mono = mapFont(actualMono ?? 'Fira Code')
  const cjk =
    analysis.scheme.fonts.minorEa === analysis.scheme.fonts.minor
      ? 'Noto Sans SC'
      : mapFont(analysis.scheme.fonts.minorEa)
  const sansStack = sans === cjk ? sans : `${sans},${cjk}`
  const serifStack =
    serif === 'Noto Serif SC' ? serif : `${serif},Noto Serif SC`

  const titleSize = analysis.slides.typography.titleSizePt
  const bodySize = analysis.slides.typography.bodySizePt

  // Full palette tokens (extracted scheme) + semantic tokens.
  const palettePairs = COLOR_SLOTS.map((slot) =>
    c[slot] ? `--ext-${slot}: ${c[slot]}` : null,
  ).filter(Boolean)
  const tokenBlock = `${palettePairs.join(';\n  ')}${palettePairs.length ? ';' : ''}`
  const nativeLayoutArtifacts = analysis.nativeLayoutArtifacts ?? {
    definitions: [],
    candidates: [],
  }

  const gradientCss =
    analysis.scheme.signature?.type === 'gradient'
      ? analysis.scheme.signature.stops
          .map((stop) => `  ${stop.color} ${Math.round(stop.position * 100)}%`)
          .join(',\n')
      : undefined

  const packageJson = {
    name: `slidev-theme-${slug}`,
    version,
    private: true,
    type: 'module',
    description: `Extracted from an existing PPTX (${sourceName}).`,
    keywords: ['slidev-theme', 'slidev', slug],
    license: 'MIT',
    files: ['agent', 'layouts', 'components', 'styles', 'setup', 'global-top.vue', 'README.md'],
    engines: { node: '>=20.12.0', slidev: '>=52.0.0' },
    slidev: {
      defaults: {
        aspectRatio: analysis.size.ratio,
        canvasWidth: analysis.size.width,
        transition: 'none',
        fonts: {
          sans: sansStack,
          serif: serifStack,
          mono,
          weights: '400,600,700',
          local: `${sans},${cjk},${serif},Noto Serif SC,${mono}`,
        },
      },
      colorSchema: 'light',
    },
    scripts: {
      test: 'node ../../scripts/theme-smoke.mjs .',
      build: 'node ../../scripts/theme-build.mjs .',
    },
    dependencies: { '@fastppt/fonts': 'workspace:*' },
  }

  const manifest = {
    id: `slidev-theme-${slug}`,
    packageName: `slidev-theme-${slug}`,
    displayName: slug[0].toUpperCase() + slug.slice(1),
    version,
    description: '从现有 PPTX 提取的主题（含主导色与字体分析）。',
    repositoryUrl: 'https://github.com/FastR-D/FastPPT',
    rootDir: '.',
    rulesFile: 'agent/theme-rules.md',
    machineRulesFile: 'agent/theme-rules.json',
    skill: { id: `fastppt-theme-${slug}`, sourceDir: 'agent', version },
    layouts: [
      { id: 'cover', label: 'Cover' },
      { id: 'default', label: 'Default' },
      { id: 'section', label: 'Section' },
      { id: 'end', label: 'End' },
      ...nativeLayoutArtifacts.definitions.map((layout) => ({
        id: layout.name,
        label: `Source ${layout.name}`,
        description: '来自源 PPTX 的可编辑母版候选。',
      })),
    ],
    defaultAspectRatio: analysis.size.ratio,
    supportedFeatures: [
      {
        id: 'extracted-palette',
        label: '提取配色',
        description: `从源 PPTX 提取的调色板，主导色 ${primary}。`,
      },
      {
        id: 'extracted-fonts',
        label: '提取字体',
        description: `正文 ${sans}，标题 ${serif}。`,
      },
    ],
  }

  const registeredLayouts = manifest.layouts
    .map((layout) => `- \`${layout.id}\``)
    .join('\n')
  const skill = `---
name: fastppt-theme-${slug}
description: Create, edit, review, and validate ${slug} Slidev decks — a theme extracted from an existing PPTX with its dominant palette (primary ${primary}), actual fonts (${sans}), and title/body type scale. For decks that select the slidev-theme-${slug} theme.
metadata:
  id: fastppt-theme-${slug}
  version: ${version}
---

# FastPPT ${slug} theme

Use this Skill when a deck selects \`theme: slidev-theme-${slug}\`.

## Visual contract

Use the extracted palette. Primary ${primary}, secondary ${secondary}, canvas ${bg} with ${text} text. Titles ${serif} at ~${titleSize}px, body ${sans} at ~${bodySize}px. Keep one claim per slide and the extracted color hierarchy; do not introduce unrelated hues.

## Registered layouts

${registeredLayouts}

## Authoring workflow

1. State the deck's single argument spine.
2. Map each slide to a registered layout.
3. Keep to the extracted palette and type scale; verify sources and units on-slide.
4. Run FastPPT preview and overflow checks; visually review every layout.

## Minimal setup

\`\`\`yaml
---
theme: slidev-theme-${slug}
---
\`\`\`

The common FastPPT Skill owns workspace safety, MCP, Harness, and export.
`

  const rules = `# ${slug} theme rules
- 使用提取调色板：主色 ${primary}、次色 ${secondary}、画布 ${bg}、正文 ${text}。
- 标题 ${serif} ~${titleSize}px，正文 ${sans} ~${bodySize}px。
- 每页一个主张，短片段，不引入无关颜色。
- 通用布局可用 cover 开头、section 转场、default 正文、end 收尾；源布局使用审查通过的来源结构，不按文件序号猜测用途。
- 选用 source-* 布局时，先阅读 source-layouts.md；按 ph-<index> 命名槽位放置内容，并用显式对象锚点绑定 fastpptPlaceholders。不要将页面默认 slot 当作源占位符。
- 引用、单位、来源落在证据所在页面；不虚构来源。
`

  const baseCss = `:root {
  ${tokenBlock}
  --ext-primary: ${primary};
  --ext-secondary: ${secondary};
  --ext-accent: ${accent};
  --ext-bg: ${bg};
  --ext-text: ${text};
  --ext-muted: ${muted};
  --ext-surface: ${surface};
}

.slidev-layout {
  height: 100%;
  background: var(--ext-bg);
  color: var(--ext-text);
  font-family: ${sansStack
    .split(',')
    .map((family) => `'${family}'`)
    .join(', ')}, system-ui, sans-serif;
  font-size: ${Math.max(14, Math.round(bodySize))}px;
  line-height: 1.55;
  padding: 2.4rem 3rem;
}

.slidev-layout h1, .slidev-layout h2, .slidev-layout h3, .slidev-layout h4 {
  font-family: ${serifStack
    .split(',')
    .map((family) => `'${family}'`)
    .join(', ')}, serif;
  color: var(--ext-primary);
  line-height: 1.25;
}
.slidev-layout h1 { font-size: ${Math.max(20, Math.round(titleSize))}px; margin: 0 0 1rem; }
.slidev-layout h2 { font-size: ${Math.max(16, Math.round(titleSize * 0.72))}px; margin: 0 0 0.6rem; }
.slidev-layout h3 { font-size: ${Math.max(14, Math.round(titleSize * 0.58))}px; margin: 0 0 0.4rem; }
.slidev-layout strong { color: var(--ext-text); }
.slidev-layout mark { background: var(--ext-surface); }
${
  gradientCss
    ? `.ext-hero {
  background: linear-gradient(${analysis.scheme.signature.angle}deg,
${gradientCss});
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
`
    : ''
}`

  const layoutsCss = `.ext-rule {
  border-bottom: 2px solid var(--ext-primary);
  margin: 0 0 1.2rem;
}
.ext-pill {
  display: inline-block;
  color: var(--ext-primary);
  border-bottom: 2px solid var(--ext-accent);
  padding-bottom: 0.15rem;
  margin-bottom: 0.6rem;
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
`

  const indexTs = `import '@fastppt/fonts/noto-sans-sc'\nimport '@fastppt/fonts/noto-serif-sc'\nimport '@fastppt/fonts/fira-code'\nimport './base.css'\nimport './layouts.css'\n`

  const layoutDefault = `<template>
  <div class="slidev-layout ext-default">
    <div class="ext-rule" />
    <slot />
  </div>
</template>

<style scoped>
.ext-default { display: flex; flex-direction: column; }
.ext-rule { flex: 0 0 auto; }
</style>
`
  const layoutCover = `<template>
  <div class="slidev-layout ext-cover">
    <div class="ext-cover-inner">
      <span class="ext-pill">${slug}</span>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ext-cover { display: flex; align-items: center; }
.ext-cover-inner { max-width: 76%; }
.ext-cover-inner :deep(h1) { font-size: 3rem; margin: 0.4rem 0 0; }
.ext-cover-inner :deep(p) { color: var(--ext-muted); font-size: 1.1rem; }
</style>
`
  const layoutSection = `<template>
  <div class="slidev-layout ext-section">
    <div class="ext-section-inner"><slot /></div>
  </div>
</template>

<style scoped>
.ext-section { display: flex; align-items: center; justify-content: center; }
.ext-section-inner :deep(h1) { font-size: 2.8rem; margin: 0; }
.ext-section-inner :deep(p) { color: var(--ext-muted); }
</style>
`
  const layoutEnd = `<template>
  <div class="slidev-layout ext-end">
    <div class="ext-end-inner"><slot /></div>
  </div>
</template>

<style scoped>
.ext-end { display: flex; align-items: center; justify-content: center; text-align: center; }
.ext-end-inner :deep(h1) { font-size: 2.4rem; margin: 0; }
.ext-end-inner :deep(p) { color: var(--ext-muted); }
</style>
`

  await writeFile(
    join(dir, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  )
  await writeFile(
    join(dir, 'agent/theme-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  await writeFile(
    join(dir, 'agent/theme-rules.json'),
    `${JSON.stringify(
      {
        version: 1,
        rules: [
          {
            id: 'proposal.registered-layouts',
            kind: 'allowed-layouts',
            layouts: manifest.layouts.map((layout) => layout.id),
            severity: 'warning',
            provenance: 'generated',
            message: 'Review custom layouts against the imported theme.',
          },
          {
            id: 'proposal.first-cover',
            kind: 'first-layout',
            layout: 'cover',
            severity: 'warning',
            provenance: 'generated',
            message: 'Imported themes normally open with a cover layout.',
          },
          {
            id: 'proposal.last-end',
            kind: 'last-layout',
            layout: 'end',
            severity: 'warning',
            provenance: 'generated',
            message: 'Imported themes normally close with an end layout.',
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(dir, 'agent/native-layouts.json'),
    `${JSON.stringify(nativeLayoutArtifacts.definitions, null, 2)}\n`,
  )
  await writeFile(
    join(dir, 'agent/layout-candidates.json'),
    `${JSON.stringify({ version: 1, sourceHash: nativeLayoutArtifacts.sourceHash, candidates: nativeLayoutArtifacts.candidates }, null, 2)}\n`,
  )
  await writeFile(join(dir, 'agent/SKILL.md'), skill)
  await writeFile(join(dir, 'agent/theme-rules.md'), rules)
  // Standalone themes must preserve tabs before Vue condenses static HTML text.
  await mkdir(join(dir, 'setup'), { recursive: true })
  await writeFile(join(dir, 'setup/vite-plugins.ts'), `${preserveTextFrameTabs.toString()}
export default () => [{ name: 'fastppt-source-text-tabs', enforce: 'pre', transform(code, id) { if (/\\.(md|vue)(?:$|\\?)/.test(id) && code.includes('<template')) return preserveTextFrameTabs(code) } }]
`)
  await writeFile(join(dir, 'agent/source-layouts.md'), `# Source layout contract\n\nOnly materialized, reachable source layouts are listed below. Geometry is shared with native-layouts.json; font/style fidelity and target-application editing still require review. Partial candidates remain in layout-candidates.json.\n\n${nativeLayoutArtifacts.definitions.map(layout => `- ${layout.name}: ${layout.placeholders.map(slot => `ph-${slot.index} (${slot.type})`).join(', ') || 'no placeholders'}`).join('\n')}\n\nFor each text placeholder, use a named Slidev slot and a unique content anchor. Bind that anchor explicitly with geometry: layout; preserve page text formatting unless the native placeholder provides textStyle defaults. A binding target must export as one native shape. Script fonts in textStyle.fontFamilies (latin/ea/cs) are projected into ordinary slot text; generated font spans remain one captured text object per authored text run. Paragraph defaults and sparse textStyle.levels overrides are independent for levels 1–9; nested lists select their depth, and data-fastppt-level on p/headings/li selects an explicit level. Empty paragraphs retain a line. textStyle.language and alternativeLanguage preserve independent lang/altLang declarations, including an empty string for unknown language; omitted fields inherit. Source slot text uses lang and data-fastppt-alt-lang, with authored ancestor or inline attributes overriding template defaults. A layout binding removes only language groups explicitly declared by the corresponding level. Uniform fixed text supports the same fields; mixed run languages remain partial. Language identifiers do not control decimal-tab separators or establish target-application typography support. textStyle.underline and strike independently use true for a single line, false for explicit cancellation, and omission for inheritance. Source runs use solid current-color continuous lines; decorations are applied to leaf text spans so cancellation works. Use data-fastppt-underline and data-fastppt-strike with true/false on authored paragraphs or inline elements to override template defaults. Paragraph and soft-break metadata preserve defaults without drawing ancestor decoration; ordinary HTML u/s keep their CSS propagation. Empty paragraphs and soft breaks retain independent native flags. Uniform fixed text supports the same fields. textStyle: layout removes only decoration properties owned by the corresponding level; page retains local cancellation. Capture rejects malformed declarations and mismatched line styles, colors or geometry. Double/wavy lines and custom underline fill/line properties remain located partial. Native decoration semantics have a 12-page LibreOffice probe; browser pixel equivalence and other target applications remain unverified. textStyle.letterSpacing is additional character advance in points: omission inherits, zero clears, and negative values condense text. It scales with the source canvas width, including independent levels and uniform fixed text. Finite values between -4000 and 4000 points are accepted, and native spc is rounded to hundredths of a point. Use ordinary inline CSS for page overrides; letter-spacing:0 cancels a template value. Explicit zero is restored after writer serialization, and paragraph, empty-line and soft-break defaults remain independent. textStyle: layout removes only a declared spacing field; page retains captured run values. Nonzero spacing carries text-letter-spacing-compatibility: the 18-page LibreOffice probe has 15 matches and 3 known Latin/CJK boundary differences even with installed fonts. Review mixed-script spacing and wrapping in the target application. textStyle.baselinePercent is a percentage of the declared font size: positive raises text, omission inherits, and zero clears. Ratios do not scale with the canvas; declared font sizes do. Source integer baseline values use thousandths of a percent, with native rounding to that unit. Use data-fastppt-baseline="30" or "0" for authored overrides in source layouts. Generated leaf spans preserve declared sizes and line boxes, and capture validates the measured offset before retaining the native percentage. Paragraph, empty-line and BR defaults are separate; BR also retains its declared font size. Uniform fixed text moves its inner text, preserving the outer object box. Invalid metadata, inconsistent CSS, rotated/nonuniform text and unmodeled sup/sub remain blocked. Native export carries text-baseline-compatibility: LibreOffice 7.3.7.2 shrinks tested nonzero-baseline text to about 58%, truncates fractional percentages, and can alter line placement/wrapping. Source preservation is not browser/application pixel equivalence; verify the actual output. textStyle.kerningThreshold is the minimum font size in points for kerning, from DrawingML kern in hundredths of a point. Omission inherits and zero enables kerning at all sizes; accepted range is 0–4000 points. Threshold and font size scale together with the source canvas width. Use data-fastppt-kerning-threshold="20" for an authored override. Generated layouts embed a standalone runtime that evaluates measured font sizes on mount, font loading, resizing and CSS edits before tab geometry is captured; fixed text is included. Capture retains the threshold and rejects inconsistent CSS, conflicting font feature settings, unmodeled stretch/variation and disabled source kerning without a threshold contract. Runs, BR, empty paragraphs and paragraph ends preserve independent defaults; layout binding clears only its declared kern field. Declared thresholds carry text-kerning-compatibility: a 20-page LibreOffice probe has 10 matches, 9 known cases where kerning stays enabled below the threshold, and one missing-font observation without a source metric claim. Review actual target typography. textStyle.capitalization preserves DrawingML cap as none/all/small; omission inherits and none explicitly cancels. It changes display only: editable text remains the original Unicode string, including sharp s, ligatures and language-dependent characters. Use data-fastppt-capitalization="none" (or all/small) on authored source paragraphs or inline elements. Generated leaves use validated text-transform/font-variant-caps metadata; capture keeps source text and actual DOM widths. Paragraph, BR, empty-line and paragraph-end defaults remain independent, and layout policy removes only its declared cap. Uniform fixed text supports the same fields. Uncontracted transformed source text, conflicting CSS, extra font features or small-cap synthesis overrides block capture; a single source grapheme spanning multiple line boxes requires an explicit text frame. Tabs and automatic lines retain original UTF-16 ranges. Font embedding keeps full relevant face coverage for uppercase expansion and small-cap substitutions; variable fonts still instantiate the declared weight, and size limits can prevent embedding. all/small carry text-capitalization-compatibility: the 36-page LibreOffice report preserves every source string but observes capital sharp s instead of SS, retained Greek accents, truncated ligature expansion and small caps drawn as full capitals. The generic Chrome reference distinguishes synthetic small caps from actual smcp font features; neither it nor display-text matches establishes cross-application pixel equivalence. For one native placeholder containing several paragraphs or inline styles, place the content inside a div with a unique id and data-fastppt-text-box in a source slot with paragraph/levels defaults. This explicit text frame preserves paragraphs, soft breaks, empty paragraphs, character styles and links as one native shape. Do not put separate anchors on its children. Images, effects, clipping, complex positioning, uncontracted bullets, unsupported numbering schemes, unmeasured tab layouts, RTL and unsupported content inside the frame produce a located capture error and block export. Without this marker, multiple authored nodes still export separately and cannot share one placeholder binding. textStyle: page retains inline emphasis; textStyle: layout removes every local override declared by the layout. Source textBody defaults carry insets, vertical alignment, wrapping and no-autofit. Set textBody: layout explicitly to inherit declared body properties; this policy is independent of geometry and textStyle. An explicit text box that is the only direct content of a source slot captures the complete frame and its measured insets. Character and automatic-number paragraphs require this explicit text frame. paragraph.bullet selects none, character, or auto-number (scheme plus optional template startAt); bulletFont, bulletSize and bulletColor independently select explicit values or follow the first visible run. Browser measurement covers left/center/right/justified LTR bullets, including nonnegative indents and markers wider than the hanging gutter. First-line occupancy is max(0, source indent + measured marker advance); continuation lines retain the paragraph margin. Empty inline baseline probes preserve long-word breaking and align the marker with the first line without adding body characters. Capture verifies marker structure, font, size, color, position, baseline and first-line occupancy, then exports the original source indent. A prefix consuming the whole paragraph and unsupported break rules remain blocked. Tabs still require a left-aligned paragraph. Native rendering may use different marker fonts, sizes or emphasis; text-bullet-compatibility reports the measured LibreOffice limitations. Empty paragraphs retain their bullet contract but show no marker. Use data-fastppt-no-bullet on a paragraph or list item for local cancellation, and textStyle: page to retain it. Markers remain separate from body text and export as native paragraph properties; changing a marker inconsistently blocks export. Automatic numbering supports arabic Period/ParenR/ParenBoth/Plain and alphaLc/alphaUc/romanLc/romanUc with Period/ParenR/ParenBoth (1–32767). Counters are independent per text frame and recomputed in DOM order. Nonempty parent list items reset child counters; plain interruptions and empty paragraphs do not consume numbers. Use data-fastppt-start-at on p or li for an explicit local restart; it is separate from the template starting value. A li restart applies to its first projected paragraph. textStyle: layout may override local numbering, so use page to retain restart intent. Restarts or changed starting values within an existing sequence, and empty-paragraph restarts, carry a numbering-compatibility warning: LibreOffice can ignore a restart at 1 or adjacent equal starts. Target-application typography and numbering still require review. Paragraph defaultTabSize and tabStops independently preserve inherited, zero, and explicit empty-list intent; positions are EMU from the paragraph left margin. Source browser measurement supports left, center, right and explicitly declared decimal stops in left-aligned LTR paragraphs inside explicit text frames. Literal tabs or HTML &#9; are retained across runs, consecutive stops, soft breaks, edits and canvas resizing; generated setup/vite-plugins.ts preserves them before Vue compilation. Keep setup in the installed theme. Fields extend through inline runs and end at the next tab or explicit soft break. Center/right alignment measures the entire field; a field too long to align uses a zero-width tab gap without jumping to a different stop. Default stops after the explicit list are left-aligned. Pre-wrap paragraphs with ordinary word breaks measure automatic lines, including long words. Tab spacers are iterated until their line positions stabilize, reselecting stops after a line move. Captured tabLayout records original UTF-16 ranges, authored versus automatic breaks, tab offsets and measured bounds; automatic lines never become extra native breaks. Unsupported whitespace/break rules, unstable or invalid spacers, undeclared decimal conventions and zero default spacing without a following explicit stop block capture. Font metrics at an exact boundary can still change native wrapping; the export warning requires actual target review. Tabs remain native characters with defTabSz/tabLst in one shape. Export reports text-tab-compatibility because LibreOffice 7.3.7.2 can reset stops with explicit indent and ignore custom default spacing or empty-list clearing. Decimal alignment requires textStyle.paragraph.decimalTab (or the corresponding level override): separator, user-declared provenance, a reason, and a measured targetProfile. Null clears an inherited declaration. Supported measurement profiles are libreoffice-7.3.7.2-linux-en-US (period), -de-DE and -fr-FR (comma); they pin diagnostic evidence, not successful native compatibility. Import with --decimal-tabs <source-bound-declaration.json> alongside --analysis to apply an explicit convention; SOURCE_SELECTION.json keeps the extracted unknown state and user declaration separately. Browser measurement aligns the first separator glyph edge or the field end when absent. DrawingML preserves dec but cannot store the separator or enforce a locale; keep this sidecar and review actual output. A run language alone does not determine decimal alignment. Target-application review is still required.\n\n\`\`\`markdown\n---\nlayout: <reviewed-source-layout>\nfastpptPlaceholders:\n  source-title:\n    index: 0\n    geometry: layout\n---\n\n::ph-0::\n\n<h1 id="source-title">Your title</h1>\n\`\`\`\n`)
  await writeFile(join(dir, 'styles/index.ts'), indexTs)
  await writeFile(join(dir, 'styles/base.css'), baseCss)
  await writeFile(join(dir, 'styles/layouts.css'), layoutsCss)
  await writeFile(join(dir, 'layouts/cover.vue'), layoutCover)
  await writeFile(join(dir, 'layouts/default.vue'), layoutDefault)
  await writeFile(join(dir, 'layouts/section.vue'), layoutSection)
  await writeFile(join(dir, 'layouts/end.vue'), layoutEnd)
  await Promise.all(
    nativeLayoutArtifacts.definitions.map((layout) =>
      writeFile(
        join(dir, 'layouts', `${layout.name}.vue`),
        sourceLayoutSfc(layout),
      ),
    ),
  )
  await writeFile(join(dir, 'global-top.vue'), '<template><div /></template>\n')
  await writeFile(
    join(dir, 'README.md'),
    `# slidev-theme-${slug}\n\nExtracted from an existing PPTX.\n`,
  )
  await writeFile(
    join(dir, 'THIRD_PARTY_NOTICES.md'),
    `# Third-party notices\n\nPalette, fonts, and type scale extracted from the source PPTX's Office theme and slides.\n`,
  )

  // Human-readable extraction analysis (design data, not an integrity manifest).
  const report = [
    `# ${slug} 提取分析`,
    ``,
    `| 项目 | 值 |`,
    `| --- | --- |`,
    `| 画布 | ${analysis.size.width}×${analysis.size.height} (${analysis.size.ratio}) |`,
    `| 主色 | ${primary} |`,
    `| 次色 | ${secondary} |`,
    `| 背景 | ${bg} |`,
    `| 正文色 | ${text} |`,
    `| 标题字体 | ${serif} |`,
    `| 正文字体 | ${sans} |`,
    `| 标题字号 | ~${titleSize}px |`,
    `| 正文字号 | ~${bodySize}px |`,
    `| 背景类型 | ${analysis.background?.type ?? '未检测'}${analysis.background?.color ? ` (${analysis.background.color})` : ''} |`,
    analysis.scheme.signature?.type === 'gradient'
      ? `| 渐变签名 | ${analysis.scheme.signature.stops.map((s) => `${s.color} ${Math.round(s.position * 100)}%`).join(' → ')} |`
      : analysis.scheme.signature?.type === 'solid'
        ? `| 填充签名 | ${analysis.scheme.signature.color} |`
        : null,
    ``,
    `## 幻灯片字体使用（按频率）`,
    ...analysis.slides.fontUsage
      .slice(0, 8)
      .map((f) => `- \`${f.family}\` ×${f.count}`),
    ``,
    `## 建议布局（供 harness 设计参考）`,
    ...analysis.slides.suggestedLayouts.map((role) => `- ${role}`),
    ``,
    `## 建议组件（供 harness 设计参考）`,
    ...analysis.slides.suggestedComponents.map((name) => `- ${name}`),
    ``,
    `## 幻灯片内容结构`,
    ...analysis.slides.slideContent.map(
      (c, i) =>
        `- slide${i + 1}: pics=${c.pics} tables=${c.tables} charts=${c.charts} shapes=${c.shapes} 2col=${c.twoCol ? 'yes' : 'no'}`,
    ),
    ``,
    `## 主导色（按频率）`,
    ...analysis.slides.dominantColors
      .slice(0, 10)
      .map((c) => `- \`${c.hex}\` ×${c.count}`),
  ]
    .filter((line) => line !== null)
    .join('\n')
  await writeFile(
    join(dir, 'EXTRACTION_ANALYSIS.md'),
    report +
      (analysis.sourceSelection
        ? `\n\n## 结构化来源限制\n${[...analysis.sourceSelection.limitations, ...analysis.sourceSelection.tokenLimitations].map((limitation) => `- ${limitation}`).join('\n') || '- 当前所用 token 无新增解析限制；这不代表完整布局或跨应用保真已验证。'}\n`
        : ''),
  )
  if (analysis.sourceSelection)
    await writeFile(
      join(dir, 'SOURCE_SELECTION.json'),
      `${JSON.stringify(analysis.sourceSelection, null, 2)}\n`,
    )

  return { dir, analysis }
}

// ---- main ----
const input = process.argv[2]
if (!input) {
  process.exitCode = 2
} else {
  const args = parseArgs(process.argv.slice(2))
  const inputPath = resolve(process.cwd(), input)
  const sourceAnalysis = args.analysis
    ? JSON.parse(await readFile(resolve(args.analysis), 'utf8'))
    : undefined
  const decimalTabDeclaration = args.decimalTabs ? JSON.parse(await readFile(resolve(args.decimalTabs), 'utf8')) : undefined
  const analysis = await extractTheme(inputPath, sourceAnalysis, decimalTabDeclaration)
  const slug = slugify(args.name, basename(input).replace(/\.pptx?$/i, ''))
  const { dir } = await generateTheme(slug, analysis, args.out, basename(input))
  const d = analysis.slides.dominantColors
  console.log(
    `Extracted theme -> ${dir}\n` +
      `  canvas ${analysis.size.width}x${analysis.size.height} (${analysis.size.ratio})\n` +
      `  palette slots ${Object.keys(analysis.scheme.colors).length} | dominant colors ${d.length}\n` +
      `  primary ${d.find((x) => x.hex !== analysis.scheme.colors.lt1)?.hex ?? analysis.scheme.colors.accent1 ?? 'n/a'} | fonts ${analysis.slides.fontUsage[0]?.family ?? analysis.scheme.fonts.minor}\n` +
      `  title/body ${analysis.slides.typography.titleSizePt}/${analysis.slides.typography.bodySizePt}px` +
      (analysis.scheme.signature?.type === 'gradient'
        ? ` | gradient signature`
        : ''),
  )
}
