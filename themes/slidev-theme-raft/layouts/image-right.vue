<script setup lang="ts">
const props = defineProps<{ image?: string }>()
</script>

<template>
  <div class="slidev-layout raft-image-right">
    <div class="col-text">
      <slot />
    </div>
    <div class="col-image">
      <div class="raft-image-frame">
        <img v-if="props.image" :src="props.image" alt="" />
        <slot v-else name="image" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.raft-image-right {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 2rem;
  align-items: center;
}

.raft-image-right :deep(h1) {
  display: inline-block;
  background: var(--raft-cyan);
  border: var(--raft-border);
  box-shadow: var(--raft-shadow);
  padding: 0.25rem 1rem;
  font-size: 1.9rem;
}

.raft-image-frame {
  border: var(--raft-border);
  box-shadow: var(--raft-shadow-lg);
  background: var(--raft-white);
  padding: 0.5rem;
  transform: rotate(1.2deg);
}

/* :deep so the constraint hits both the prop-rendered <img> and any <img>
   passed through the named slot (slot content carries the parent scope id). */
.raft-image-frame :deep(img) {
  display: block;
  width: 100%;
  /* Portrait sources must not blow past the 16:9 canvas — crop, don't overflow. */
  max-height: 22rem;
  object-fit: cover;
  border: 1.5px solid var(--raft-ink);
}
</style>
