<script setup lang="ts">
import {
  computed,
  defineComponent,
  h,
  isVNode,
  shallowRef,
  type PropType,
  type VNode,
} from 'vue'
import { createTextFitRuntime } from '../composables/text-fit-runtime'
import { useTextFitScope } from '../composables/text-fit-scope'

const textFit = createTextFitRuntime()

const props = defineProps<{
  fitGroup: string
}>()

const TextFitGroupContent = defineComponent({
  name: 'TextFitGroupContent',
  props: {
    fitGroup: {
      type: String as PropType<string>,
      required: true,
    },
  },
  setup(props, { slots }) {
    const groupElement = shallowRef<HTMLElement | null>(null)
    const textFitScope = useTextFitScope()
    const sharedKey = computed(() => {
      if (!props.fitGroup)
        return ''

      return `${textFitScope}:${props.fitGroup}`
    })
    let currentChildren: VNode[] = []
    const { apply } = textFit.useGroup({
      target: groupElement,
      nodes: () => currentChildren,
      sharedKey,
    })

    return () => {
      const children = (slots.default?.() ?? []).filter(isVNode)
      currentChildren = children

      return h('div', {
        ref: groupElement,
        class: 'TextFitGroup',
      }, apply(children))
    }
  },
})
</script>

<template>
  <TextFitGroupContent :fit-group="props.fitGroup">
    <slot />
  </TextFitGroupContent>
</template>

<style scoped>
.TextFitGroup {
  min-width: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: inherit;
}
</style>
