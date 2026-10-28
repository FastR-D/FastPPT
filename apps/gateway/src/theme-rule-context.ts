import type { NativeMasterLayout } from '@fastppt/slidewave/server'
import type { ThemeRuleSlide } from '@fastppt/theme-registry'

export interface RuleMeasurement {
  slide: number
  textLines: number
  density: number
  tokens: string[]
}

/** Definitions are authoritative for inheritance; rendered metrics are separate
 * evidence and must be tied to the same revision by the caller. */
export function themeRuleSlides(
  slides: readonly { layout: string; slideId: string }[],
  definitions: readonly NativeMasterLayout[] | undefined,
  animations: readonly {
    slideId: string
    groups: readonly {
      id: string
      static?: boolean
      effects: readonly unknown[]
    }[]
  }[] = [],
  measurements: readonly RuleMeasurement[] = [],
): ThemeRuleSlide[] {
  return slides.map((slide, index) => {
    const layout = definitions?.find((entry) => entry.name === slide.layout)
    const masterId = layout?.masterId ?? 'default'
    const master = definitions?.find(
      (entry) =>
        (entry.masterId ?? 'default') === masterId && entry.masterObjects,
    )?.masterObjects
    const overrides = new Set(
      animations
        .find((entry) => entry.slideId === slide.slideId)
        ?.groups.filter((group) => !group.static && group.effects.length)
        .map((group) => group.id),
    )
    const measurement = measurements.find((entry) => entry.slide === index + 1)
    return {
      index: index + 1,
      layout: slide.layout,
      ...(layout
        ? {
            master: masterId,
            placeholders: layout.placeholders,
            fixedObjects: [
              ...(master?.objects ?? []).map((object) => ({
                name: object.name,
                owner: 'master' as const,
                overridden: Boolean(
                  object.anchor && overrides.has(object.anchor),
                ),
              })),
              ...(layout.fixedObjects ?? []).map((object) => ({
                name: object.name,
                owner: 'layout' as const,
                overridden: Boolean(
                  object.anchor && overrides.has(object.anchor),
                ),
              })),
            ],
          }
        : {}),
      ...(measurement
        ? {
            textLines: measurement.textLines,
            density: measurement.density,
            tokens: measurement.tokens,
          }
        : {}),
    }
  })
}
