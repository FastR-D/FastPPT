import { onMounted, onUnmounted, shallowRef, type ShallowRef } from 'vue'

/** Native details semantics with viewport bounds and outside/Escape dismissal. */
export function useDetailsMenu(
  details: ShallowRef<HTMLDetailsElement | undefined>,
  preferredWidth = 280,
) {
  const menuStyle = shallowRef<Record<string, string>>()
  function closeMenu(): void {
    details.value?.removeAttribute('open')
  }
  function position(): void {
    if (!details.value) return
    const rect = details.value.getBoundingClientRect()
    const width = Math.min(preferredWidth, window.innerWidth - 24)
    const top = rect.bottom + 6
    menuStyle.value = {
      position: 'fixed',
      left: `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`,
      right: 'auto',
      top: `${top}px`,
      width: `${width}px`,
      maxHeight: `${Math.max(60, window.innerHeight - top - 12)}px`,
    }
  }
  function dismiss(event: Event): void {
    if (event instanceof KeyboardEvent) {
      if (
        event.key !== 'Escape' ||
        !details.value?.open ||
        event.defaultPrevented
      )
        return
      closeMenu()
      details.value.querySelector('summary')?.focus()
    } else if (!details.value?.contains(event.target as Node)) closeMenu()
  }
  onMounted(() => {
    position()
    details.value?.addEventListener('toggle', position)
    window.addEventListener('resize', position)
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', dismiss)
  })
  onUnmounted(() => {
    details.value?.removeEventListener('toggle', position)
    window.removeEventListener('resize', position)
    window.removeEventListener('pointerdown', dismiss)
    window.removeEventListener('keydown', dismiss)
  })
  return { menuStyle, closeMenu }
}
