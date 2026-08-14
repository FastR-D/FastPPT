<script setup lang="ts">
import { computed, ref, useSlots, watch } from 'vue'
import { useSlideContext } from '@slidev/client'
import { useCitationStore } from './store'

const props = defineProps<{
  doi: string
}>()

const slots = useSlots()
const { $page } = useSlideContext()
const citationStore = useCitationStore()
const citationNumber = ref(0)

function vnodeToText(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return ''
  }

  const typed = node as { children?: unknown }

  if (typeof typed.children === 'string') {
    return typed.children
  }

  if (Array.isArray(typed.children)) {
    return typed.children.map((child) => vnodeToText(child)).join('')
  }

  return ''
}

const displayName = computed(() => {
  const nodes = slots.default ? slots.default() : []
  const text = nodes.map((node) => vnodeToText(node)).join('').trim()
  return text || props.doi
})

watch(
  [() => props.doi, $page, displayName],
  () => {
    citationNumber.value = citationStore.addCitation($page.value, props.doi, displayName.value)
  },
  { immediate: true }
)
</script>

<template>
  <span class="inline-flex items-baseline">
    <span class="border-b-1.5 border-whu-green pb-0.5 leading-none">
      <slot />
    </span>

    <sup v-if="citationNumber > 0" class="text-current text-[0.72em] ml-[0.04em] ml-0.5 text-primary ">
      [{{ citationNumber }}]
    </sup>
  </span>
</template>

<style scoped>

</style>
