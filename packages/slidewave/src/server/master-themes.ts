import { posix } from 'node:path'
import type JSZip from 'jszip'
import { parseXml } from './slide-xml.js'
import type { NativeMasterLayout } from './master-layout.js'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const escape = (text: string) => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const targetPath = (source: string, target: string) => target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(posix.dirname(source), target))
async function relation(zip: JSZip, part: string, role: string) {
  const path = `${posix.dirname(part)}/_rels/${posix.basename(part)}.rels`
  const xml = await zip.file(path)!.async('string')
  const node = parseXml(xml).children.find(node => node.attributes.Type === `${REL}${role}` && node.attributes.TargetMode !== 'External')
  if (!node) throw new Error(`Missing ${role} relation for ${part}`)
  return { path, xml, node, target: targetPath(part, node.attributes.Target!) }
}
export async function materializeMasterThemes(zip: JSZip, layouts: readonly NativeMasterLayout[], paths: Map<string, string>): Promise<void> {
  const themes = new Map<string, { layout: NativeMasterLayout; signature: string }>()
  for (const layout of layouts) {
    if (!layout.masterTheme) continue
    const theme = layout.masterTheme
    if (theme.fontFamily !== undefined && !theme.fontFamily.trim()) throw new Error('Master font must not be empty.')
    if (theme.colors && (theme.colors.length > 6 || theme.colors.some(color => !/^[0-9a-fA-F]{6}$/.test(color)))) throw new Error('Invalid master accent colors.')
    const group = layout.masterId?.trim() ?? 'default'
    const signature = JSON.stringify({ fontFamily: theme.fontFamily, colors: theme.colors?.map(color => color.toUpperCase()) })
    if (themes.has(group) && themes.get(group)!.signature !== signature) throw new Error(`Conflicting theme definitions for master ${group}`)
    themes.set(group, { layout, signature })
  }
  let number = Math.max(0, ...Object.keys(zip.files).map(path => Number(/^ppt\/theme\/theme(\d+)\.xml$/.exec(path)?.[1] ?? 0))) + 1
  for (const { layout } of themes.values()) {
    const master = await relation(zip, paths.get(layout.name.trim())!, 'slideMaster')
    const themeRelation = await relation(zip, master.target, 'theme')
    let xml = await zip.file(themeRelation.target)!.async('string')
    const edits: Array<{ start: number; end: number; text: string }> = []
    const elements = parseXml(xml).children.find(node => node.namespace === DRAWING && node.local === 'themeElements')!
    const scheme = elements.children.find(node => node.local === 'clrScheme')!
    for (const [index, color] of (layout.masterTheme!.colors ?? []).entries()) {
      const accent = scheme.children.find(node => node.local === `accent${index + 1}`)
      if (!accent) throw new Error(`Missing theme accent ${index + 1}`)
      edits.push({ start: accent.openEnd, end: accent.closeStart, text: `<srgbClr xmlns="${DRAWING}" val="${color.toUpperCase()}"/>` })
    }
    const font = layout.masterTheme!.fontFamily
    if (font) {
      const fonts = elements.children.find(node => node.local === 'fontScheme')!
      for (const group of fonts.children.filter(node => ['majorFont', 'minorFont'].includes(node.local)))
        for (const face of group.children.filter(node => ['latin', 'ea', 'cs'].includes(node.local)))
          edits.push({ start: face.start, end: face.end, text: `<${face.name} typeface="${escape(font)}"/>` })
    }
    for (const edit of edits.sort((a, b) => b.start - a.start)) xml = xml.slice(0, edit.start) + edit.text + xml.slice(edit.end)
    const themePath = `ppt/theme/theme${number++}.xml`
    zip.file(themePath, xml)
    const replacement = `<${themeRelation.node.name} Id="${escape(themeRelation.node.attributes.Id!)}" Type="${REL}theme" Target="../theme/${posix.basename(themePath)}"/>`
    zip.file(themeRelation.path, themeRelation.xml.slice(0, themeRelation.node.start) + replacement + themeRelation.xml.slice(themeRelation.node.end))
    const types = await zip.file('[Content_Types].xml')!.async('string')
    zip.file('[Content_Types].xml', types.replace('</Types>', `<Override PartName="/${themePath}" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`))
  }
}
