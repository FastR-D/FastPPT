import type { HtmlDeckSnapshot } from '../snapshot-types.js'
import type { WriteEditablePptxOptions } from './index.js'
import type { NativeMasterLayout } from './master-layout.js'

const key = (scope: string | undefined, name: string): string => JSON.stringify([scope ?? 'layout', name])
/** Isolate explicit page animations without changing the shared source master. */
export function fixedObjectOverrides(snapshot: HtmlDeckSnapshot, options: WriteEditablePptxOptions): {
  options: WriteEditablePptxOptions
  excluded: Map<number, Set<string>>
  identities: Map<string, { layout: string; master: string }>
} {
  const excluded = new Map<number, Set<string>>()
  const identities = new Map<string, { layout: string; master: string }>()
  if (options.master === false || !options.objectAnimations?.length) return { options, excluded, identities }
  const definitions = [...(options.masterLayoutDefinitions ?? [])]
  const selections = [...(options.slideLayouts ?? [])]
  const names = new Set([...definitions.map(layout => layout.name.trim()), ...(options.masterLayouts ?? [])])
  const groups = new Set(definitions.map(layout => layout.masterId?.trim() ?? 'default'))
  for (const [index, page] of snapshot.slides.entries()) {
    const name = options.slideLayouts?.[index]?.trim()
    const layout = options.masterLayoutDefinitions?.find(layout => layout.name.trim() === name)
    if (!layout) continue
    const group = layout.masterId?.trim() ?? 'default'
    const siblings = options.masterLayoutDefinitions!.filter(item => (item.masterId?.trim() ?? 'default') === group)
    const masterObjects = siblings.find(item => item.masterObjects)?.masterObjects
    const targets = new Set(options.objectAnimations.filter(effect => effect.slide === index + 1).map(effect => effect.target))
    const removed = new Set<string>()
    for (const element of page.elements) {
      const owner = element.source.nativeLayoutObject
      if (!owner || owner.layout !== name || !element.source.anchor || !targets.has(element.source.anchor)) continue
      const objects = owner.scope === 'master' ? masterObjects?.objects : layout.fixedObjects
      if (objects?.some(object => object.name === owner.name)) removed.add(key(owner.scope, owner.name))
    }
    if (!removed.size) continue
    excluded.set(index, removed)
    let variantName = `${name} · page ${index + 1} animation`
    while (names.has(variantName)) variantName += '_'
    names.add(variantName)
    let variantGroup = group
    const overridesMaster = masterObjects?.objects.some(object => removed.has(key('master', object.name))) ?? false
    if (overridesMaster) {
      variantGroup = `${group} · page ${index + 1} animation`
      while (groups.has(variantGroup)) variantGroup += '_'
      groups.add(variantGroup)
    }
    const variant: NativeMasterLayout = {
      ...layout, name: variantName, masterId: variantGroup,
      fixedObjects: layout.fixedObjects?.filter(object => !removed.has(key('layout', object.name))),
      ...(overridesMaster && masterObjects ? { masterObjects: { ...masterObjects, objects: masterObjects.objects.filter(object => !removed.has(key('master', object.name))) } } : {}),
      ...(overridesMaster ? { masterTheme: siblings.find(item => item.masterTheme)?.masterTheme } : {}),
    }
    identities.set(variantName, { layout: name!, master: group })
    definitions.push(variant)
    selections[index] = variantName
  }
  return { excluded, options: excluded.size ? { ...options, masterLayoutDefinitions: definitions, slideLayouts: selections } : options, identities }
}
export function isFixedObjectOverridden(excluded: Map<number, Set<string>>, index: number, owner: { scope?: string; name: string }): boolean {
  return excluded.get(index)?.has(key(owner.scope, owner.name)) ?? false
}
