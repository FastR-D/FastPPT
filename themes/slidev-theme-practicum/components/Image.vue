<script setup lang="ts">
import { computed, type PropType } from 'vue'
import { createThemeMedia } from '../composables/theme-media.mjs'
import ImageRenderer from './ImageRenderer.vue'

type ImageFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'

const props = defineProps({
  src: {
    type: String,
    default: '',
  },
  alt: {
    type: String,
    default: '',
  },
  fit: {
    type: String as PropType<ImageFit>,
    default: 'cover',
  },
  position: {
    type: String,
    default: 'center',
  },
  anchor: {
    type: String,
    default: '',
  },
  x: {
    type: [Number, String],
    default: 0,
  },
  y: {
    type: [Number, String],
    default: 0,
  },
  zoom: {
    type: [Number, String],
    default: 1,
  },
  rotate: {
    type: [Number, String],
    default: 0,
  },
  color: {
    type: String,
    default: '',
  },
  opacity: {
    type: [Number, String],
    default: 1,
  },
  backgroundColor: {
    type: String,
    default: '',
  },
})

const media = createThemeMedia()

const layer = computed(() =>
  media.resolveImage({
    src: props.src,
    alt: props.alt,
    fit: props.fit,
    position: props.position,
    anchor: props.anchor,
    x: props.x,
    y: props.y,
    zoom: props.zoom,
    rotate: props.rotate,
    color: props.color,
    opacity: props.opacity,
    backgroundColor: props.backgroundColor,
  }, 'image'),
)
</script>

<template>
  <ImageRenderer v-if="layer"
                 :layer="layer" />
</template>
