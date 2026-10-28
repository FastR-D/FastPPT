import { nextTick, onUnmounted, watch, type ShallowRef } from 'vue'

/** Focus is scoped to the active dialog and restored to its caller on dismissal. */
export function useDialogFocus(
  dialog: ShallowRef<HTMLElement | undefined>,
  isOpen: () => boolean,
  close: () => void,
) {
  let returnFocus: HTMLElement | null = null
  watch(
    isOpen,
    async (open) => {
      if (!open) {
        returnFocus?.focus()
        return
      }
      returnFocus = document.activeElement as HTMLElement | null
      await nextTick()
      dialog.value
        ?.querySelector<HTMLElement>(
          'input:not(:disabled), textarea:not(:disabled), button:not(:disabled)',
        )
        ?.focus()
    },
    { immediate: true },
  )
  onUnmounted(() => returnFocus?.focus())

  function onDialogKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return
    const nestedDialog = (event.target as HTMLElement | null)?.closest(
      'dialog[open]',
    )
    if (nestedDialog && nestedDialog !== dialog.value) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const nodes = [
      ...(dialog.value?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
      ) ?? []),
    ].filter((node) => node.getClientRects().length > 0)
    const first = nodes[0],
      last = nodes.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
  return { onDialogKeydown }
}
