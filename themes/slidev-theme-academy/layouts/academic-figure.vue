<script setup lang="ts">
import BodyLayout from '../components/BodyLayout.vue'

withDefaults(
  defineProps<{
    caption?: string
    credit?: string
    figureWidth?: string
  }>(),
  {
    caption: '',
    credit: '',
    figureWidth: '48%',
  },
)
</script>

<template>
  <BodyLayout>
    <slot />
    <div
      class="academic-figure-grid"
      :style="{ gridTemplateColumns: `1fr ${figureWidth}` }"
    >
      <div class="academic-figure-copy"><slot name="content" /></div>
      <figure class="academic-figure-media">
        <slot name="figure" />
        <figcaption v-if="caption || credit">
          <span>{{ caption }}</span>
          <small v-if="credit">{{ credit }}</small>
        </figcaption>
      </figure>
    </div>
  </BodyLayout>
</template>

<style scoped>
.academic-figure-grid {
  display: grid;
  gap: 1.4rem;
  align-items: center;
  min-height: 0;
}
.academic-figure-copy,
.academic-figure-media {
  min-width: 0;
}
.academic-figure-media {
  margin: 0;
  text-align: center;
}
.academic-figure-media :deep(img),
.academic-figure-media :deep(svg) {
  max-width: 100%;
  max-height: 390px;
  object-fit: contain;
}
figcaption {
  margin-top: 0.55rem;
  color: #425466;
  font-size: 0.72rem;
  line-height: 1.35;
}
figcaption small {
  display: block;
  margin-top: 0.18rem;
  color: #6b7280;
}
</style>
