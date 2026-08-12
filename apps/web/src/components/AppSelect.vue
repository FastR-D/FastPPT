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
  minWidth: string
  maxHeight: string
}>()

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
  const gap = 6
  const menuHeight = Math.min(240, window.innerHeight - 16)
  const opensUp = rect.bottom + gap + menuHeight > window.innerHeight - 8
  const top = opensUp ? rect.top - gap - menuHeight : rect.bottom + gap
  menuStyle.value = {
    top: `${Math.max(8, top)}px`,
    left: `${Math.max(8, rect.left)}px`,
    minWidth: `${rect.width}px`,
    maxHeight: `${menuHeight}px`,
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
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      :id="listboxId"
      ref="listboxMenu"
      role="listbox"
      tabindex="-1"
      class="app-select-menu"
      :class="`app-select-menu-${size}`"
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
        {{ option.label }}
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.app-select {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 8px;
  outline: none;
  background:
    linear-gradient(45deg, transparent 50%, var(--color-accent) 50%)
      calc(100% - 15px) 52% / 5px 5px no-repeat,
    linear-gradient(135deg, var(--color-accent) 50%, transparent 50%)
      calc(100% - 10px) 52% / 5px 5px no-repeat,
    linear-gradient(180deg, rgb(255 255 255 / 7%), transparent),
    var(--color-panel-raised);
  color: var(--color-text);
  font-weight: 650;
  box-shadow: inset 0 1px rgb(255 255 255 / 5%);
  cursor: pointer;
}

.app-select-md {
  min-width: 140px;
  max-width: 220px;
  padding: 7px 32px 7px 11px;
  font-size: 12px;
}

.app-select-sm {
  min-width: 72px;
  max-width: 140px;
  padding: 6px 28px 6px 9px;
  font-size: 11px;
}

.app-select-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-select-label.is-placeholder {
  color: var(--color-muted);
}

.app-select:hover:not(:disabled),
.app-select:focus-visible,
.app-select-open {
  border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
}

.app-select:focus-visible {
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--color-accent) 18%, transparent),
    inset 0 1px rgb(255 255 255 / 5%);
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
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel-raised);
  box-shadow: 0 10px 30px rgb(0 0 0 / 50%);
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
  overflow: hidden;
  padding: 6px 10px;
  border-radius: 6px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
  cursor: pointer;
}

.app-select-menu-md > [role='option'] {
  font-size: 12px;
}

.app-select-menu-sm > [role='option'] {
  font-size: 11px;
}

.app-select-menu > [role='option'].is-active {
  background: rgb(255 255 255 / 8%);
}

.app-select-menu > [role='option'].is-selected {
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
}

.app-select-menu > [role='option'].is-selected.is-active {
  background: color-mix(in srgb, var(--color-accent) 22%, transparent);
}
</style>
