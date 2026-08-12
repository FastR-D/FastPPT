<script setup lang="ts">
interface Props {
  icon?: string // 接收 UnoCSS 图标类名，如 i-carbon-chart-multitype
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  size: 'sm',
})
const sizeMap = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
}
</script>

<template>
  <div
    class="whu-block inline-flex flex-col flex-center gap-1 p-2 rounded-xl border border-blue-200/50 bg-gradient-to-br from-blue-50/70 via-white/50 to-white shadow-sm backdrop-blur-sm"
  >
    <div v-if="props.icon" class="text-2xl text-whu-blue shrink-0 opacity-80">
      <div :class="props.icon" />
    </div>

    <div
      :class="sizeMap[props.size]"
      class="text-whu-blue leading-tight whitespace-nowrap flex flex-center text-center"
    >
      <slot />
    </div>
  </div>
</template>
