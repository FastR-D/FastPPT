<script setup lang="ts">
import { Box, Text } from '@fastrd/ui-vue'
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { regionFromPoints } from '../../workspace/visual-edit.js'
import type { SlideRegion } from '@fastppt/protocol'
const props = defineProps<{
  enabled: boolean
  page: number
  revision: number
  deckId: string | undefined
}>()
const emit = defineEmits<{ select: [region: SlideRegion]; cancel: [] }>()
const surface = useTemplateRef<HTMLElement>('surface')
watch(
  () => props.enabled,
  async (enabled) => {
    if (enabled) {
      await nextTick()
      surface.value?.focus()
    }
  },
)
const start = shallowRef<{ x: number; y: number }>()
const end = shallowRef<{ x: number; y: number }>()
const region = computed(() =>
  start.value && end.value
    ? regionFromPoints(start.value, end.value)
    : undefined,
)
function point(event: PointerEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  }
}
function down(event: PointerEvent): void {
  if (event.button !== 0) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  start.value = point(event)
  end.value = start.value
}
function move(event: PointerEvent): void {
  if (start.value) end.value = point(event)
}
function up(event: PointerEvent): void {
  if (!start.value) return
  end.value = point(event)
  if (region.value) emit('select', region.value)
  start.value = undefined
  end.value = undefined
}
function reset(): void {
  start.value = undefined
  end.value = undefined
}
watch(() => [props.enabled, props.page, props.revision, props.deckId], reset)
</script>
<template>
  <Box
    v-if="enabled"
    ref="surface"
    class="region-selector"
    tabindex="0"
    role="application"
    aria-label="在幻灯片上拖动框选修改区域；Escape 取消"
    @pointerdown.prevent="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="reset"
    @keydown.esc.stop="emit('cancel')"
  >
    <Text class="hint">拖动选择要修改的区域 · Esc 取消</Text>
    <Box
      v-if="region"
      class="selection"
      :style="{
        left: `${region.x * 100}%`,
        top: `${region.y * 100}%`,
        width: `${region.width * 100}%`,
        height: `${region.height * 100}%`,
      }"
    ></Box>
  </Box>
</template>
<style scoped>
.region-selector {
  position: absolute;
  inset: 0;
  z-index: 4;
  cursor: crosshair;
  touch-action: none;
  border: 2px solid var(--color-accent);
  outline: none;
  background: color-mix(in srgb, var(--color-accent) 4%, transparent);
}
.selection {
  position: absolute;
  border: 2px solid var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 16%, transparent);
  box-shadow: 0 0 0 100vmax #0002;
  pointer-events: none;
}
.hint {
  position: absolute;
  left: 50%;
  top: 8px;
  transform: translateX(-50%);
  padding: 5px 10px;
  border-radius: 6px;
  background: var(--color-accent-fill);
  color: var(--color-on-accent);
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
}
</style>
