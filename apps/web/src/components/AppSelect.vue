<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from 'vue'

export interface SelectOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    /** Currently selected value; undefined falls back to `placeholder`. */
    value: string | undefined
    options: readonly SelectOption[]
    placeholder?: string
    disabled?: boolean
    size?: 'sm' | 'md'
  }>(),
  {
    placeholder: '',
    disabled: false,
    size: 'md',
  },
)

const emit = defineEmits<{
  /** Fired when the user picks an option; parent updates `value`. */
  change: [value: string]
}>()

const listboxId = useId()
const trigger = ref<HTMLButtonElement>()
const listboxMenu = ref<HTMLDivElement>()
const open = ref(false)
const activeIndex = ref(0)
const menuStyle = ref<{
  top: string
  left: string
  width: string
  maxHeight: string
  transformOrigin: string
}>()
const menuPlacement = ref<'top' | 'bottom'>('bottom')

const hasSelection = computed(() =>
  props.options.some((option) => option.value === props.value),
)
const selectedLabel = computed(
  () =>
    props.options.find((option) => option.value === props.value)?.label ??
    props.placeholder,
)
const activeOptionId = computed(() =>
  open.value && props.options.length > 0
    ? `${listboxId}-opt-${activeIndex.value}`
    : undefined,
)

watch(open, (isOpen) => {
  if (isOpen) {
    const selected = props.options.findIndex(
      (option) => option.value === props.value,
    )
    activeIndex.value = selected >= 0 ? selected : 0
    document.addEventListener('pointerdown', onOutsidePointerDown, true)
    void nextTick(() => {
      listboxMenu.value?.focus()
      positionMenu()
    })
  } else {
    document.removeEventListener('pointerdown', onOutsidePointerDown, true)
  }
})

watch(activeIndex, () => {
  if (!open.value) return
  listboxMenu.value
    ?.querySelector(`[data-index="${activeIndex.value}"]`)
    ?.scrollIntoView({ block: 'nearest' })
})

function positionMenu(): void {
  const el = trigger.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const viewportPadding = 10
  const gap = 8
  const optionHeight = props.size === 'sm' ? 30 : 34
  const estimatedHeight = Math.min(
    props.options.length * optionHeight + 12,
    264,
  )
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
  const spaceAbove = rect.top - viewportPadding
  const opensUp = spaceBelow < estimatedHeight + gap && spaceAbove > spaceBelow
  const availableHeight = Math.max(
    optionHeight + 12,
    Math.min(264, (opensUp ? spaceAbove : spaceBelow) - gap),
  )
  const measuredHeight = Math.min(
    listboxMenu.value?.scrollHeight ?? estimatedHeight,
    availableHeight,
  )
  const width = Math.min(
    Math.max(rect.width, props.size === 'sm' ? 132 : 168),
    window.innerWidth - viewportPadding * 2,
  )
  const left = Math.min(
    Math.max(viewportPadding, rect.left),
    window.innerWidth - viewportPadding - width,
  )
  const top = opensUp
    ? rect.top - gap - measuredHeight
    : rect.bottom + gap
  menuPlacement.value = opensUp ? 'top' : 'bottom'
  menuStyle.value = {
    top: `${Math.max(viewportPadding, top)}px`,
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${availableHeight}px`,
    transformOrigin: opensUp ? 'bottom center' : 'top center',
  }
}

function onViewportChange(): void {
  if (open.value) positionMenu()
}

function onOutsidePointerDown(event: PointerEvent): void {
  const target = event.target as Node
  if (
    !trigger.value?.contains(target) &&
    !listboxMenu.value?.contains(target)
  ) {
    open.value = false
  }
}

function toggle(): void {
  if (props.disabled) return
  open.value = !open.value
}

function select(index: number): void {
  const option = props.options[index]
  if (!option) return
  open.value = false
  trigger.value?.focus()
  if (option.value !== props.value) emit('change', option.value)
}

/** Keydown while the menu is focused: move / pick / dismiss. */
function onListboxKeydown(event: KeyboardEvent): void {
  const count = props.options.length
  if (count === 0) return
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      activeIndex.value = (activeIndex.value + 1) % count
      break
    case 'ArrowUp':
      event.preventDefault()
      activeIndex.value = (activeIndex.value - 1 + count) % count
      break
    case 'Home':
      event.preventDefault()
      activeIndex.value = 0
      break
    case 'End':
      event.preventDefault()
      activeIndex.value = count - 1
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      select(activeIndex.value)
      break
    case 'Escape':
      event.preventDefault()
      open.value = false
      trigger.value?.focus()
      break
    case 'Tab':
      open.value = false
      break
  }
}

/**
 * Keydown on the closed trigger: open with arrows / Enter / Space.
 * ArrowLeft/Right are deliberately left unhandled so callers can hook them
 * (PreviewPanel uses them to flip the preview pages).
 */
function onTriggerKeydown(event: KeyboardEvent): void {
  if (
    event.key === 'ArrowDown' ||
    event.key === 'ArrowUp' ||
    event.key === 'Enter' ||
    event.key === ' '
  ) {
    if (event.altKey) return
    event.preventDefault()
    open.value = true
  }
}

onMounted(() => {
  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
  document.removeEventListener('pointerdown', onOutsidePointerDown, true)
})
</script>

<template>
  <button
    ref="trigger"
    v-bind="$attrs"
    type="button"
    class="app-select"
    :class="[`app-select-${size}`, { 'app-select-open': open }]"
    :disabled="disabled"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-controls="open ? listboxId : undefined"
    @click="toggle"
    @keydown="onTriggerKeydown"
  >
    <span class="app-select-label" :class="{ 'is-placeholder': !hasSelection }">
      {{ selectedLabel }}
    </span>
    <svg
      class="app-select-chevron"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="m4.25 6.25 3.75 3.5 3.75-3.5" />
    </svg>
  </button>

  <Teleport to="body">
    <Transition name="app-select-popover">
      <div
        v-if="open"
        :id="listboxId"
        ref="listboxMenu"
        role="listbox"
        tabindex="-1"
        class="app-select-menu"
        :class="[
          `app-select-menu-${size}`,
          `app-select-menu-${menuPlacement}`,
        ]"
        :style="menuStyle"
        :aria-activedescendant="activeOptionId"
        @keydown="onListboxKeydown"
      >
        <div
          v-for="(option, index) in options"
          :id="`${listboxId}-opt-${index}`"
          :key="option.value"
          :data-index="index"
          role="option"
          :aria-selected="option.value === value"
          :class="{
            'is-active': index === activeIndex,
            'is-selected': option.value === value,
          }"
          @pointermove="activeIndex = index"
          @pointerdown.prevent="select(index)"
        >
          <span class="app-select-option-label">{{ option.label }}</span>
          <svg
            v-if="option.value === value"
            class="app-select-check"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path d="m3.25 8.15 3.05 3.1 6.45-6.5" />
          </svg>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-select {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid color-mix(in srgb, var(--color-border-strong) 78%, transparent);
  border-radius: 10px;
  outline: none;
  background: linear-gradient(180deg, rgb(255 255 255 / 6%), transparent 68%),
    color-mix(in srgb, var(--color-panel-raised) 92%, black);
  color: var(--color-text);
  font-weight: 600;
  letter-spacing: 0.01em;
  box-shadow:
    inset 0 1px rgb(255 255 255 / 6%),
    0 1px 2px rgb(0 0 0 / 22%);
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background-color 140ms ease,
    box-shadow 140ms ease,
    transform 140ms ease;
}

.app-select-md {
  min-width: 140px;
  max-width: 220px;
  min-height: 31px;
  padding: 5px 9px 5px 11px;
  font-size: 12px;
}

.app-select-sm {
  min-width: 72px;
  max-width: 140px;
  min-height: 27px;
  padding: 3px 8px 3px 9px;
  font-size: 11px;
}

.app-select-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-select-chevron {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: var(--color-muted);
  transition:
    color 140ms ease,
    transform 180ms cubic-bezier(0.2, 0.75, 0.25, 1);
}

.app-select-chevron path,
.app-select-check path {
  fill: none;
  stroke: currentcolor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

.app-select-label.is-placeholder {
  color: var(--color-muted);
}

.app-select:hover:not(:disabled),
.app-select:focus-visible,
.app-select-open {
  border-color: color-mix(in srgb, var(--color-accent) 52%, var(--color-border));
  background-color: color-mix(in srgb, var(--color-panel-raised) 88%, var(--color-accent));
}

.app-select:hover:not(:disabled) .app-select-chevron,
.app-select-open .app-select-chevron {
  color: var(--color-accent);
}

.app-select-open .app-select-chevron {
  transform: rotate(180deg);
}

.app-select:focus-visible {
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--color-accent) 14%, transparent),
    inset 0 1px rgb(255 255 255 / 6%);
}

.app-select:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.app-select-menu {
  position: fixed;
  z-index: 1000;
  padding: 4px;
  overflow-y: auto;
  border: 1px solid color-mix(in srgb, var(--color-border-strong) 82%, transparent);
  border-radius: 12px;
  outline: none;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 5%), transparent 40%),
    color-mix(in srgb, var(--color-panel-raised) 94%, black);
  box-shadow:
    0 20px 50px rgb(0 0 0 / 46%),
    0 4px 14px rgb(0 0 0 / 35%),
    inset 0 1px rgb(255 255 255 / 7%);
  backdrop-filter: blur(18px) saturate(1.2);
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

.app-select-menu::-webkit-scrollbar {
  width: 8px;
}

.app-select-menu::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--color-border-strong);
}

.app-select-menu > [role='option'] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
  cursor: pointer;
  transition:
    color 100ms ease,
    background-color 100ms ease,
    border-color 100ms ease;
}

.app-select-menu-md > [role='option'] {
  min-height: 32px;
  padding: 5px 9px 5px 10px;
  font-size: 12px;
}

.app-select-menu-sm > [role='option'] {
  min-height: 28px;
  padding: 4px 8px 4px 9px;
  font-size: 11px;
}

.app-select-option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-select-check {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: var(--color-accent);
}

.app-select-menu > [role='option'].is-active {
  border-color: rgb(255 255 255 / 5%);
  background: rgb(255 255 255 / 7%);
}

.app-select-menu > [role='option'].is-selected {
  color: color-mix(in srgb, var(--color-accent) 88%, white);
  font-weight: 650;
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}

.app-select-menu > [role='option'].is-selected.is-active {
  border-color: color-mix(in srgb, var(--color-accent) 18%, transparent);
  background: color-mix(in srgb, var(--color-accent) 17%, transparent);
}

.app-select-popover-enter-active,
.app-select-popover-leave-active {
  transition:
    opacity 120ms ease,
    transform 150ms cubic-bezier(0.2, 0.75, 0.25, 1);
}

.app-select-popover-enter-from,
.app-select-popover-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.975);
}

.app-select-menu-top.app-select-popover-enter-from,
.app-select-menu-top.app-select-popover-leave-to {
  transform: translateY(4px) scale(0.975);
}

@media (prefers-reduced-motion: reduce) {
  .app-select,
  .app-select-chevron,
  .app-select-menu,
  .app-select-menu > [role='option'] {
    transition: none;
  }
}
</style>
