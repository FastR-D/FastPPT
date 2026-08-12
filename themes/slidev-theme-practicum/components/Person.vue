<script setup lang="ts">
import Image from './Image.vue'
import Text from './Text.vue'

type PersonFlowAlign = 'start' | 'middle' | 'end'

const props = withDefaults(defineProps<{
  name: string
  title?: string
  avatar?: string
  avatarFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'
  avatarPosition?: string
  avatarAnchor?: string
  avatarX?: number | string
  avatarY?: number | string
  avatarZoom?: number | string
  align?: PersonFlowAlign
}>(), {
  title: '',
  avatar: '',
  avatarFit: 'cover',
  avatarPosition: 'center',
  avatarAnchor: '',
  avatarX: 0,
  avatarY: 0,
  avatarZoom: 1,
  align: 'start',
})
</script>

<template>
  <div class="Person"
       :class="{
         Person_align_start: props.align === 'start',
         Person_align_middle: props.align === 'middle',
         Person_align_end: props.align === 'end',
       }">
    <div v-if="props.avatar" class="Person-Avatar">
      <Image :src="props.avatar"
             :fit="props.avatarFit"
             :position="props.avatarPosition"
             :anchor="props.avatarAnchor"
             :x="props.avatarX"
             :y="props.avatarY"
             :zoom="props.avatarZoom" />
    </div>

    <div class="Person-Meta">
      <Text size="3">{{ props.name }}</Text>
      <Text v-if="props.title" size="1" color="text-muted">{{ props.title }}</Text>
    </div>
  </div>
</template>

<style scoped>
.Person {
  display: flex;
  align-items: start;
  gap: calc(var(--theme-grid-module) * 2);
}

.Person_align_start {
  margin-top: 0;
  margin-bottom: 0;
}

.Person_align_middle {
  margin-top: auto;
  margin-bottom: auto;
}

.Person_align_end {
  margin-top: auto;
}

.Person-Avatar {
  flex: 0 0 var(--theme-cell-width);
  width: var(--theme-cell-width);
  height: var(--theme-cell-width);
  overflow: hidden;
  border-radius: var(--theme-panel-radius);
}

.Person-Meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
</style>
