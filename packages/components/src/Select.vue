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
    size?: 'xs' | 'sm' | 'md'
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
  const optionHeight = props.size === 'md' ? 34 : 30
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
    Math.max(rect.width, props.size === 'md' ? 168 : 132),
    window.innerWidth - viewportPadding * 2,
  )
  const left = Math.min(
    Math.max(viewportPadding, rect.left),
    window.innerWidth - viewportPadding - width,
  )
  const top = opensUp ? rect.top - gap - measuredHeight : rect.bottom + gap
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
    <svg class="app-select-chevron" viewBox="0 0 16 16" aria-hidden="true">
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
        :class="[`app-select-menu-${size}`, `app-select-menu-${menuPlacement}`]"
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
  gap: 8px;
  border: 1px solid var(--color-border-strong);
  border-radius: 6px;
  outline: none;
  background: var(--color-panel);
  color: var(--color-secondary);
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease;
}
.app-select-md {
  min-width: 140px;
  max-width: 220px;
  min-height: 36px;
  padding: 7px 10px;
  font-size: 13px;
}
.app-select-sm {
  min-width: 78px;
  max-width: 140px;
  min-height: var(--control-height-sm);
  padding: 4px 8px;
  font-size: 12px;
}
.app-select-xs {
  min-width: 78px;
  max-width: 140px;
  height: var(--control-height-xs);
  min-height: var(--control-height-xs);
  padding: 1px 6px;
  font-size: 11px;
  line-height: 1.4;
}
.app-select-label,
.app-select-option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-select-chevron,
.app-select-check {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  color: var(--color-muted);
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
  color: var(--color-placeholder);
}
.app-select:hover:not(:disabled),
.app-select-open {
  border-color: var(--color-accent-strong);
  background: var(--color-panel-raised);
}
.app-select-open .app-select-chevron {
  transform: rotate(180deg);
}
.app-select:focus-visible {
  box-shadow: var(--focus-ring);
  border-color: var(--color-accent-strong);
}
.app-select-menu {
  position: fixed;
  z-index: 1200;
  padding: 4px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  outline: none;
  background: var(--color-panel);
  box-shadow: var(--shadow-popover);
}
.app-select-menu > [role='option'] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--color-secondary);
  cursor: pointer;
}
.app-select-menu-md > [role='option'] {
  min-height: 34px;
  padding: 5px 10px;
  font-size: 12px;
}
.app-select-menu-sm > [role='option'],
.app-select-menu-xs > [role='option'] {
  min-height: 30px;
  padding: 4px 8px;
  font-size: 11px;
}
.app-select-check {
  color: var(--color-accent-strong);
}
.app-select-menu > [role='option'].is-active {
  background: var(--color-hover);
}
.app-select-menu > [role='option'].is-selected {
  color: var(--color-accent-strong);
  background: var(--color-selected);
}
.app-select-popover-enter-active,
.app-select-popover-leave-active {
  transition: opacity 150ms ease;
}
.app-select-popover-enter-from,
.app-select-popover-leave-to {
  opacity: 0;
}
</style>
