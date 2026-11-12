<script setup lang="ts">
import { Box, Frame, Text } from '@fastrd/ui-vue'
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue'
import { resolveGatewayUrl } from '../../api/useGatewayClient.js'

const props = defineProps<{ id: string; title: string; revision: string }>()
const host = useTemplateRef<HTMLElement>('host')
const visible = ref(false)
const foreground = ref(!document.hidden)
const source = computed(
  () =>
    `${resolveGatewayUrl()}/api/v1/animations/preview/${encodeURIComponent(props.id)}?v=${encodeURIComponent(props.revision)}&autoplay=1&loop=1`,
)
let observer: IntersectionObserver | undefined
function visibilityChanged(): void {
  foreground.value = !document.hidden
}
onMounted(() => {
  document.addEventListener('visibilitychange', visibilityChanged)
  if (!('IntersectionObserver' in window)) {
    visible.value = true
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      visible.value = entries.some((entry) => entry.isIntersecting)
    },
    { rootMargin: '80px' },
  )
  if (host.value) observer.observe(host.value)
})
onUnmounted(() => {
  observer?.disconnect()
  document.removeEventListener('visibilitychange', visibilityChanged)
})
</script>

<template>
  <Box ref="host" class="animation-preview">
    <Frame
      v-if="visible && foreground"
      :src="source"
      sandbox="allow-scripts"
      :title="`${title} 动效演示`"
    />
    <Text v-else class="preview-placeholder">动效预览</Text>
  </Box>
</template>

<style scoped>
.animation-preview {
  width: 100%;
  height: 100%;
}
iframe {
  width: 100%;
  height: 100%;
  border: 0;
}
.preview-placeholder {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--color-muted);
  font-size: 12px;
}
</style>
