import {
  computed,
  onMounted,
  onUnmounted,
  shallowRef,
  type ShallowRef,
} from 'vue'

const STORAGE_KEY = 'fastppt.workspace-layout.v1'
const RAIL_WIDTH = 56
const HANDLE_WIDTH = 4
const MIN_SIDEBAR = 220
const MIN_EDITOR = 320
const MIN_PREVIEW = 360
type Panel = 'sidebar' | 'preview'
interface Layout {
  sidebar: number
  preview: number
}

// Keep the bounds usable when a saved layout comes from a larger display.
export function constrainWorkspaceLayout(
  layout: Layout,
  width: number,
  sidebarVisible = true,
): Layout {
  const available = Math.max(
    MIN_SIDEBAR + MIN_PREVIEW,
    width - RAIL_WIDTH - HANDLE_WIDTH * 2 - MIN_EDITOR,
  )
  const sidebar = Math.max(
    MIN_SIDEBAR,
    Math.min(layout.sidebar, available - MIN_PREVIEW),
  )
  const preview = Math.max(
    MIN_PREVIEW,
    Math.min(layout.preview, available - (sidebarVisible ? sidebar : 0)),
  )
  return { sidebar, preview }
}

export function useWorkspaceLayout(shell: ShallowRef<HTMLElement | undefined>) {
  const layout = shallowRef<Layout>({ sidebar: 260, preview: 480 })
  const sidebarVisible = shallowRef(true)
  let stopResize: (() => void) | undefined

  const gridTemplateColumns = computed(
    () =>
      `${RAIL_WIDTH}px ${sidebarVisible.value ? layout.value.sidebar : 0}px ${sidebarVisible.value ? HANDLE_WIDTH : 0}px minmax(0,1fr) ${HANDLE_WIDTH}px ${layout.value.preview}px`,
  )

  function constrain(): void {
    layout.value = constrainWorkspaceLayout(
      layout.value,
      shell.value?.clientWidth ?? window.innerWidth,
      sidebarVisible.value,
    )
  }
  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout.value))
    } catch {
      /* Layout remains usable when storage is unavailable. */
    }
  }
  function startResize(panel: Panel, event: PointerEvent): void {
    if (window.matchMedia('(max-width: 1100px)').matches) return
    event.preventDefault()
    stopResize?.()
    const startX = event.clientX
    const initial = layout.value[panel]
    const move = (moveEvent: PointerEvent) => {
      layout.value = {
        ...layout.value,
        [panel]:
          initial +
          (panel === 'sidebar' ? 1 : -1) * (moveEvent.clientX - startX),
      }
      constrain()
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.classList.remove('resizing-workspace')
      stopResize = undefined
      persist()
    }
    stopResize = stop
    document.body.classList.add('resizing-workspace')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }
  function handleResizeKey(panel: Panel, event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    layout.value = {
      ...layout.value,
      [panel]:
        layout.value[panel] +
        (panel === 'sidebar' ? direction : -direction) * 16,
    }
    constrain()
    persist()
  }
  onMounted(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? 'null',
      )
      if (
        saved &&
        typeof saved === 'object' &&
        'sidebar' in saved &&
        'preview' in saved &&
        typeof saved.sidebar === 'number' &&
        Number.isFinite(saved.sidebar) &&
        typeof saved.preview === 'number' &&
        Number.isFinite(saved.preview)
      )
        layout.value = { sidebar: saved.sidebar, preview: saved.preview }
    } catch {
      /* Ignore stale or inaccessible preferences. */
    }
    constrain()
    window.addEventListener('resize', constrain)
  })
  onUnmounted(() => {
    stopResize?.()
    window.removeEventListener('resize', constrain)
  })
  return { gridTemplateColumns, sidebarVisible, startResize, handleResizeKey }
}
