import {
  compileLayoutAuthoring,
  createLayoutSlotPlanState,
  type CompiledLayoutAuthoring,
  type LayoutAuthoringInput,
} from './layout-authoring'
import type { LayoutShorthandComponents } from './layout-shorthands'
import {
  createSlotPlacementSession,
  type SlotPlacementSession,
} from './slot-placement'

export type SlideLayoutInput = Omit<LayoutAuthoringInput, 'components' | 'slotPlanState'>
export type CompiledSlideLayout = CompiledLayoutAuthoring

export type SlideLayout = SlotPlacementSession & {
  compile(input: SlideLayoutInput): CompiledSlideLayout
}

export function createSlideLayout(input: {
  components: LayoutShorthandComponents
}): SlideLayout {
  const slotPlanState = createLayoutSlotPlanState()
  let current: CompiledSlideLayout | null = null
  const placement = createSlotPlacementSession({
    layout: () => current?.slotPlan ?? null,
  })

  return {
    compile(authoringInput) {
      const compiled = compileLayoutAuthoring({
        ...authoringInput,
        components: input.components,
        slotPlanState,
      })

      current = compiled
      return compiled
    },
    register: placement.register,
    snapshot: placement.snapshot,
  }
}
