<script setup lang="ts">
interface Props {
  icon?: string
  title?: string
  content?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  content: '',
})
</script>

<template>
  <!-- 有icon的布局：左侧icon，右侧标题和内容竖排 -->
  <div
    v-if="props.icon"
    class="whu-card inline-flex flex-row items-start gap-1 p-3 rounded-2xl border border-whu-blue/25 bg-gradient-to-br from-whu-blue/10 via-white/70 to-whu-sky/5 shadow-sm backdrop-blur-sm"
  >
    <div class="text-2xl text-whu-blue shrink-0 opacity-90">
      <div :class="props.icon" />
    </div>

    <div class="flex flex-col">
      <div v-if="props.title" class="text-md font-bold text-whu-deepblue">
        {{ props.title }}
      </div>

      <div v-if="props.content" class="text-sm text-whu-blue/90">
        {{ props.content }}
      </div>
    </div>
  </div>

  <!-- 无icon的布局：标题和内容竖排 -->
  <div
    v-else
    class="whu-card inline-flex flex-col gap-2 p-3 rounded-2xl border border-whu-blue/25 bg-gradient-to-br from-whu-blue/10 via-white/70 to-whu-sky/5 shadow-sm backdrop-blur-sm"
  >
    <div v-if="props.title" class="text-md font-bold text-whu-deepblue">
      {{ props.title }}
    </div>

    <div v-if="props.content" class="text-sm text-whu-blue/90">
      {{ props.content }}
    </div>
  </div>
</template>
