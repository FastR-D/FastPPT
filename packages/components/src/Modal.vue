<script setup lang="ts">
import { shallowRef } from 'vue'
import { useDialogFocus } from './use-dialog-focus.js'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    open: boolean
    label?: string | undefined
    labelledby?: string | undefined
    size?: 'md' | 'lg' | 'xl'
    dismissible?: boolean
  }>(),
  { label: undefined, labelledby: undefined, size: 'md', dismissible: true },
)
const emit = defineEmits<{ close: [] }>()
const surface = shallowRef<HTMLElement>()
function close(): void {
  if (props.dismissible) emit('close')
}
const { onDialogKeydown } = useDialogFocus(surface, () => props.open, close)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fp-modal-backdrop" @click.self="close">
      <section
        ref="surface"
        v-bind="$attrs"
        class="fp-modal"
        :class="`fp-modal--${size}`"
        role="dialog"
        aria-modal="true"
        :aria-label="label"
        :aria-labelledby="labelledby"
        tabindex="-1"
        @keydown="onDialogKeydown"
      >
        <slot />
      </section>
    </div>
  </Teleport>
</template>
