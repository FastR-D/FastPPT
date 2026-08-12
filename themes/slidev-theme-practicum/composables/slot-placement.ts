import { inject, provide } from 'vue'
import {
  resolveGridPlacement,
  type GridCursor,
  type GridPlacedItem,
  type GridPlacementInput,
  type GridPlacementStyle,
  type GridRect,
} from './grid-placement'
import type { LayoutSlotPlan, ResolvedLayoutSlot } from './layout-authoring'
import type { ThemeLayoutRole, ThemeLayoutSlotSpec } from './layout-recipes'
import { createSlotRules } from './slot-rules'

export type GridFootprint = {
  cols: number
  rows: number
  label: string
}

export type SlotPlacementInput = {
  id: string
  label?: string
  role?: ThemeLayoutRole | ''
  area?: string
  col?: string
  row?: string
  overrides?: Partial<ThemeLayoutSlotSpec>
}

export type ResolvedSlotPlacement = {
  rect: GridRect
  style: GridPlacementStyle
  footprint: GridFootprint
  layoutSlot: ResolvedLayoutSlot | null
}

export type SlotPlacementHandle = {
  update(input: SlotPlacementInput): void
  dispose(): void
}

export type SlotPlacementSnapshot = {
  placements: readonly (ResolvedSlotPlacement & { id: string, label: string })[]
}

export type SlotPlacementSession = {
  register(input: SlotPlacementInput, onResolve: (result: ResolvedSlotPlacement) => void): SlotPlacementHandle
  snapshot(): SlotPlacementSnapshot
}

type SlotPlacementEntry = {
  input: SlotPlacementInput
  onResolve: (result: ResolvedSlotPlacement) => void
  order: number
}

const SlotPlacementSessionKey = Symbol('theme-slot-placement-session')
const slotRules = createSlotRules({ Slot: null })

function resolveEntry(input: SlotPlacementInput, layout: LayoutSlotPlan | null) {
  const intent = slotRules.normalize(input, { layoutActive: Boolean(layout) })

  if (intent.kind === 'manual') {
    return {
      label: intent.label,
      layoutSlot: null,
      placement: {
        area: intent.area,
        col: intent.col,
        row: intent.row,
        label: intent.label,
      } satisfies GridPlacementInput,
    }
  }

  const layoutSlot = layout!.resolveRoleSlot({
    id: intent.id,
    role: intent.role,
    overrides: intent.overrides,
    label: intent.label,
  })

  return {
    label: intent.label,
    layoutSlot,
    placement: {
      area: layoutSlot.area,
      label: intent.label,
    } satisfies GridPlacementInput,
  }
}

function footprintFromRect(rect: GridRect, label: string): GridFootprint {
  return {
    cols: rect.colEnd - rect.colStart,
    rows: rect.rowEnd - rect.rowStart,
    label,
  }
}

export function createSlotPlacementSession(input: {
  layout: () => LayoutSlotPlan | null
}): SlotPlacementSession {
  const entries = new Map<string, SlotPlacementEntry>()
  let nextOrder = 0
  let currentSnapshot: SlotPlacementSnapshot = { placements: [] }

  function recompute() {
    const layout = input.layout()
    const occupied: GridPlacedItem[] = []
    let cursor: GridCursor = { row: 1, col: 1 }
    const placements: (ResolvedSlotPlacement & { id: string, label: string })[] = []

    const orderedEntries = [...entries.values()].sort((a, b) => a.order - b.order)

    for (const entry of orderedEntries) {
      const resolved = resolveEntry(entry.input, layout)
      const result = resolveGridPlacement(resolved.placement, {
        occupied,
        cursor,
        label: resolved.label,
      })
      const placement = {
        rect: result.rect,
        style: result.style,
        footprint: footprintFromRect(result.rect, resolved.label),
        layoutSlot: resolved.layoutSlot,
      }

      occupied.push({
        id: entry.input.id,
        label: resolved.label,
        ...result.rect,
      })

      entry.onResolve(placement)
      placements.push({
        id: entry.input.id,
        label: resolved.label,
        ...placement,
      })
      cursor = result.nextCursor
    }

    currentSnapshot = { placements }
  }

  return {
    register(placementInput, onResolve) {
      entries.set(placementInput.id, {
        input: placementInput,
        onResolve,
        order: nextOrder++,
      })
      recompute()

      return {
        update(nextInput) {
          const current = entries.get(placementInput.id)
          if (!current)
            return

          entries.set(placementInput.id, {
            ...current,
            input: nextInput,
          })
          recompute()
        },
        dispose() {
          input.layout()?.unregisterRoleSlot(placementInput.id)
          if (!entries.delete(placementInput.id))
            return

          recompute()
        },
      }
    },
    snapshot() {
      return currentSnapshot
    },
  }
}

export function provideSlotPlacementSession(session: SlotPlacementSession) {
  provide(SlotPlacementSessionKey, session)
}

export function useSlotPlacementSession() {
  const session = inject<SlotPlacementSession | null>(SlotPlacementSessionKey, null)

  if (!session)
    throw new Error('[Slot] Slot должен находиться внутри Slide.')

  return session
}
