<script setup lang="ts">
import { computed, type PropType } from 'vue'

type NormalizedImageData = {
  src: string
  fit: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'
  position: string
  anchor: string
  x: string
  y: string
  zoom: number
  rotate: string
  color: string
  opacity: number
  backgroundColor: string
}

type ThemeMediaLayer = {
  image: NormalizedImageData
  render: {
    kind: 'img' | 'mask'
    decorative: boolean
    alt: string
    cssVars: Record<string, string>
  }
}

const props = defineProps({
  layer: {
    type: Object as PropType<ThemeMediaLayer | null>,
    default: null,
  },
})

const resolvedImage = computed(() => props.layer?.image ?? null)

const isMaskedDecor = computed(() => {
  return props.layer?.render.kind === 'mask'
})

const containerStyle = computed(() => {
  if (props.layer)
    return props.layer.render.cssVars

  return {}
})

const resolvedAlt = computed(() => props.layer?.render.alt ?? '')
const resolvedDecorative = computed(() => props.layer?.render.decorative ?? !resolvedAlt.value)

const imageRole = computed(() => {
  if (resolvedDecorative.value || !resolvedAlt.value)
    return undefined

  return 'img'
})

const imageAriaLabel = computed(() => {
  if (resolvedDecorative.value || !resolvedAlt.value)
    return undefined

  return resolvedAlt.value
})

const imageAriaHidden = computed(() => {
  return resolvedDecorative.value || !resolvedAlt.value ? 'true' : undefined
})
</script>

<template>
  <div v-if="resolvedImage" class="ImageRenderer" :style="containerStyle">
    <div v-if="isMaskedDecor"
         class="ImageRenderer-Decor"
         :role="imageRole"
         :aria-label="imageAriaLabel"
         :aria-hidden="imageAriaHidden" />
    <img v-else
         :src="resolvedImage.src"
         :alt="resolvedDecorative ? '' : resolvedAlt"
         class="ImageRenderer-Asset"
         :aria-hidden="imageAriaHidden" />
  </div>
</template>

<style scoped>
.ImageRenderer {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: inherit;
  background-color: var(--theme-image-background, transparent);
}

.ImageRenderer-Asset,
.ImageRenderer-Decor {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  opacity: var(--theme-image-opacity, 1);
  transform:
    translate(var(--theme-image-x, 0), var(--theme-image-y, 0))
    rotate(var(--theme-image-rotate, 0deg))
    scale(var(--theme-image-zoom, 1));
  transform-origin: var(--theme-image-origin, center);
}

.ImageRenderer-Asset {
  object-fit: var(--theme-image-fit, cover);
  object-position: var(--theme-image-position, center);
}

.ImageRenderer-Decor {
  background-color: var(--theme-image-color, currentColor);
  mask-image: var(--theme-image-mask);
  mask-repeat: no-repeat;
  mask-position: var(--theme-image-position, center);
  mask-size: var(--theme-image-mask-size, contain);
  -webkit-mask-image: var(--theme-image-mask);
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: var(--theme-image-position, center);
  -webkit-mask-size: var(--theme-image-mask-size, contain);
}
</style>
