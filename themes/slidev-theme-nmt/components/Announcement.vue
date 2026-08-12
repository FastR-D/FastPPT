<template>
  <div :class="containerClasses" :role="ariaRole">
    <div class="w-6 flex">
      <slot name="icon">
        <i :class="iconClasses" aria-hidden="true"></i>
      </slot>
    </div>
    <span class="self-center">
   <template v-if="title">
    <strong class="mr-1">{{ title }}:</strong>
   </template>
   <slot/>
  </span>

    <span class="hidden
        bg-zinc-600 text-zinc-400         bg-zinc-700 text-zinc-300        bg-zinc-800 text-zinc-200       bg-zinc-900 text-zinc-100
        bg-red-600 text-red-400           bg-red-700 text-red-300          bg-red-800 text-red-200         bg-red-900 text-red-100
        bg-rose-600 text-rose-400           bg-rose-700 text-rose-300          bg-rose-800 text-rose-200         bg-rose-900 text-rose-100
        bg-amber-600 text-amber-400       bg-amber-700 text-amber-300      bg-amber-800 text-amber-200     bg-amber-900 text-amber-100
        bg-sky-600 text-sky-400           bg-sky-700 text-sky-300          bg-sky-800 text-sky-200         bg-sky-900 text-sky-100
        bg-blue-600 text-blue-400         bg-blue-700 text-blue-300        bg-blue-800 text-blue-200       bg-blue-900 text-blue-100
        bg-green-600 text-green-400       bg-green-700 text-green-300      bg-green-800 text-green-200     bg-green-900 text-green-100
        bg-teal-600 text-teal-400         bg-teal-700 text-teal-300        bg-teal-800 text-teal-200       bg-teal-900 text-teal-100
        bg-violet-600 text-violet-400     bg-violet-700 text-violet-300    bg-violet-800 text-violet-200   bg-violet-900 text-violet-100
        bg-pink-600 text-pink-400         bg-pink-700 text-pink-300        bg-pink-800 text-pink-200       bg-pink-900 text-pink-100
        bg-slate-600 text-slate-400       bg-slate-700 text-slate-300      bg-slate-800 text-slate-200     bg-slate-900 text-slate-100
        bg-zinc-600 text-zinc-400         bg-zinc-700 text-zinc-300        bg-zinc-800 text-zinc-200       bg-zinc-900 text-zinc-100
        bg-stone-600 text-stone-400       bg-stone-700 text-stone-300      bg-stone-800 text-stone-200     bg-stone-900 text-stone-100
        bg-neutral-600 text-neutral-400   bg-neutral-700 text-neutral-300  bg-neutral-800 text-neutral-200 bg-neutral-900 text-neutral-100
    "></span>

  </div>
</template>

<script setup lang="ts">

import {computed} from 'vue'

const props = defineProps({
  type: {
    type: String,
    default: 'default',
    validator: (v) => [
        'default', 'error', 'warning', 'info', 'duration', 'important',
        'priority', 'idea', 'brainstorm', 'joke'
    ].includes(v),
  },
  role: {
    type: String,
    default: '',
  },
  /**
   * Compact variant (smaller)
   */
  compact: {
    type: Boolean,
    default: false,
  },
  /**
   * Label shown before the slot content (optional)
   */
  title: {
    type: String,
    default: '',
  },
  /**
   * Layout control - inline=false|true - default false
   */
  inline: {
    type: Boolean,
    default: false,
  },
  /**
   * Width control - fit|full - default: fit
   */
  width: {
    type: String,
    default: 'fit',
    validator: (v:string) => ['fit', 'full'].includes(v),
  },

})

/** Colours + Iconify icon names (via UnoCSS Icons) */
const map = {
  default: {
    classes: 'bg-zinc-800 text-zinc-300',
    iconClass: 'i-fa-solid-clipboard text-[1.0rem] mx-1',
  },
  error: {
    classes: 'bg-red-800 text-red-300 m-0.5',
    iconClass: 'i-fa-solid-poo-storm text-[1.0rem] mx-1',
  },
  warning: {
    classes: 'bg-amber-800 text-amber-300 m-0.5',
    iconClass: 'i-fa-solid-exclamation text-[1.0rem] mx-1',
  },
  info: {
    classes: 'bg-sky-800 text-sky-300 m-0.5',
    iconClass: 'i-fa-solid-info text-[1.0rem] mx-1',
  },
  duration: {
    classes: 'bg-blue-800 text-blue-300 m-0.5',
    iconClass: 'i-fa-solid-hourglass-half text-[1.0rem] mx-1',
  },
  important: {
    classes: 'bg-green-800 text-green-300 m-0.5',
    iconClass: 'i-fa-solid-star text-[1.0rem] mx-1',
  },
  idea: {
    classes: 'bg-teal-800 text-teal-300 m-0.5',
    iconClass: 'i-fa-solid-lightbulb text-[1.0rem] mx-1',
  },
  priority: {
    classes: 'bg-violet-800 text-violet-300 m-0.5',
    iconClass: 'i-fa-solid-bolt text-[1.0rem] mx-1',
  },
  brainstorm: {
    classes: 'bg-pink-800 text-pink-300 m-0.5',
    iconClass: 'i-fa-solid-brain text-[1.0rem] mx-1',
  },
  joke: {
    classes: 'bg-yellow-500 text-black m-0.5',
    iconClass: 'i-fa-solid-grin text-[1.0rem] mx-1',
  },
}

const current = computed(() => map[props.type] ?? map.default)

const containerClasses = computed(() => {
  const padding = props.compact ? 'pl-1 pr-3 py-1.5' : 'pl-2 pr-3 py-1'
  const minH = props.compact ? 'min-h-[1.5rem]' : 'min-h-[2rem]'
  const display = props.inline ? 'inline-flex' : 'flex'
  const width = props.width === 'full' ? 'w-full' : 'w-fit'
  const inlineSpacing = props.inline ? 'mr-2 last:mr-0' : 'mb-2 last:mb-0'

  return [
    display,
    'items-stretch gap-3 rounded leading-5 font-normal',
    width,
    padding,
    minH,
    inlineSpacing,
    current.value.classes,
  ].join(' ')
})

const iconClasses = computed(() => {
  const insets = props.compact ? 'my-0.5' : 'my-1'
  return [
    current.value.iconClass,
    insets,
    'self-stretch aspect-square inline-block mx-auto',
  ].join(' ')
})

const ariaRole = computed(() => {
  if (props.role) return props.role
  return ['error', 'warning', 'priority'].includes(props.type) ? 'alert' : 'status'
})
</script>
