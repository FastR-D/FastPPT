import type { AnimationDocumentV1, DeckAnimationsDocument } from '@fastppt/protocol'

export const motionPresets = {
  static: { label: '静态', transition: 'none', effect: undefined, duration: 400, trigger: 'on-click' },
  business: { label: '克制商务', transition: 'fade', effect: 'entrance_fade', duration: 300, trigger: 'with-previous' },
  teaching: { label: '逐步教学', transition: 'none', effect: 'appear', duration: 1, trigger: 'on-click' },
  reveal: { label: '产品揭示', transition: 'fade', effect: 'entrance_fade', duration: 500, trigger: 'after-previous' },
} as const
export type MotionPreset = keyof typeof motionPresets
export interface PresetPage {
  slideId: string
  targets: Array<{ anchor: string; role: 'title' | 'content' | 'background' | 'logo' | 'page-number' | 'inherited' | 'unknown'; static?: boolean }>
}
/** User-authored pages are retained until the caller explicitly requests replacement. */
export function applyMotionPreset(document: DeckAnimationsDocument, pages: readonly PresetPage[], preset: MotionPreset, replaceUser = false): { document: DeckAnimationsDocument; preserved: string[] } {
  const recipe = motionPresets[preset]
  const animations = [...document.animations]
  const preserved: string[] = []
  for (const page of pages) {
    const index = animations.findIndex(item => item.slideId === page.slideId)
    if (index >= 0 && animations[index]!.source !== 'system' && !replaceUser) {
      preserved.push(page.slideId)
      continue
    }
    const targets = [...new Set(page.targets.filter(target => !target.static && ['title', 'content'].includes(target.role)).map(target => target.anchor))]
    const next: AnimationDocumentV1 = {
      version: 1, slideId: page.slideId, source: 'system', diagnostics: [],
      transition: { kind: recipe.transition, durationMs: recipe.duration },
      groups: recipe.effect ? targets.map((target, index) => ({
        id: target, label: target, static: false,
        effects: [{ id: `preset-${preset}-${index}`, target, kind: recipe.effect, trigger: recipe.trigger, durationMs: recipe.duration, delayMs: 0, params: {} }],
      })) : [],
    }
    if (index < 0) animations.push(next)
    else animations[index] = next
  }
  return { document: { ...document, animations }, preserved }
}

/** Sidecar edits win; otherwise expose meaningful animation declared in Markdown. */
export function mergeSourceAnimations(document: DeckAnimationsDocument, slides: readonly { animation?: AnimationDocumentV1 }[]): DeckAnimationsDocument {
  const present = new Set(document.animations.map(item => item.slideId))
  const inherited = slides.flatMap(slide => {
    const animation = slide.animation
    if (!animation || present.has(animation.slideId)) return []
    if (animation.transition.kind === 'none' && !animation.groups.some(group => group.effects.length > 0)) return []
    present.add(animation.slideId)
    return [{ ...animation, source: 'user' as const }]
  })
  return { ...document, animations: [...document.animations, ...inherited] }
}
