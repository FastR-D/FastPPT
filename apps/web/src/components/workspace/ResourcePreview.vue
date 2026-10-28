<script setup lang="ts">
import { Box, Frame, Text } from '@fastppt/components'
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue'
import { resolveGatewayUrl } from '../../api/useGatewayClient.js'

const props = defineProps<{
  id: string
  title: string
  revision?: string | undefined
  aspect?: number | undefined
  eager?: boolean
}>()
const host = useTemplateRef<HTMLElement>('host')
const visible = ref(false)
let observer: IntersectionObserver | undefined
const url = computed(
  () =>
    `${resolveGatewayUrl()}/api/v1/resources/preview/${encodeURIComponent(props.id)}?v=${encodeURIComponent(props.revision ?? '1')}`,
)
onMounted(() => {
  if (props.eager || !('IntersectionObserver' in window)) {
    visible.value = true
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        visible.value = true
        observer?.disconnect()
      }
    },
    { rootMargin: '240px' },
  )
  if (host.value) observer.observe(host.value)
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <Box
    ref="host"
    class="resource-live-preview"
    :style="{ aspectRatio: aspect ?? 16 / 9 }"
  >
    <Frame
      v-if="visible"
      :key="url"
      :src="url"
      sandbox=""
      tabindex="-1"
      :title="title"
    ></Frame>
    <Text v-else class="preview-placeholder">现场渲染</Text>
  </Box>
</template>

<style scoped>
.resource-live-preview {
  position: relative;
  width: 100%;
  overflow: hidden;
  background: var(--color-preview-shell);
}
iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  pointer-events: none;
}
.preview-placeholder {
  display: grid;
  position: absolute;
  inset: 0;
  place-items: center;
  color: var(--color-muted);
  font-size: 12px;
}
</style>
