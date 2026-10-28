import type { NativeMasterLayoutSchema } from '@fastppt/protocol'
import type { z } from 'zod'

/** Include only fixed objects inherited by the selected layout and master group. */
export function withThemeAnchors<T extends { layout: string; anchors: string[]; animationTargets?: Array<{ anchor: string; role: string; static: boolean }> }>(slides: T[], definitions: z.infer<typeof NativeMasterLayoutSchema>[]): T[] {
  return slides.map(slide => {
    const layout = definitions.find(item => item.name === slide.layout)
    if (!layout) return slide
    const group = layout.masterId ?? 'default'
    const master = definitions.find(item => (item.masterId ?? 'default') === group && item.masterObjects)?.masterObjects
    const anchors = [...(layout.fixedObjects ?? []), ...(master?.objects ?? [])].flatMap(object => object.anchor ? [object.anchor] : [])
    return { ...slide, anchors: [...new Set([...slide.anchors, ...anchors])], animationTargets: [...(slide.animationTargets ?? []).filter(target => !anchors.includes(target.anchor)), ...anchors.map(anchor => ({ anchor, role: 'inherited', static: true }))] }
  })
}
