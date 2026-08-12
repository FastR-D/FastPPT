<script setup lang="ts">
const props = defineProps<{ accent?: string }>()
const accent = props.accent ?? 'var(--raft-yellow)'
</script>

<template>
  <div class="slidev-layout raft-cover">
    <div class="raft-cover-deco" aria-hidden="true">
      <span class="deco deco-a" />
      <span class="deco deco-b" />
      <span class="deco deco-c" />
    </div>
    <div class="raft-cover-body">
      <div class="raft-cover-card" :style="{ background: accent }">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.raft-cover {
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.raft-cover-body {
  position: relative;
  z-index: 1;
}

.raft-cover-card {
  display: inline-block;
  max-width: 78%;
  border: var(--raft-border);
  box-shadow: var(--raft-shadow-lg);
  padding: 2rem 2.4rem;
}

.raft-cover-card :deep(h1) {
  font-size: 3.2rem;
  margin-bottom: 0.6rem;
}

.raft-cover-card :deep(p) {
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 1rem;
  margin: 0;
}

.deco {
  position: absolute;
  border: var(--raft-border);
  box-shadow: var(--raft-shadow);
}

.deco-a {
  width: 7rem;
  height: 7rem;
  background: var(--raft-pink);
  right: 9%;
  top: 12%;
  transform: rotate(8deg);
}

.deco-b {
  width: 4.5rem;
  height: 4.5rem;
  background: var(--raft-cyan);
  right: 22%;
  bottom: 16%;
  transform: rotate(-6deg);
}

.deco-c {
  width: 3rem;
  height: 3rem;
  background: var(--raft-lime);
  right: 7%;
  bottom: 34%;
  transform: rotate(3deg);
}
</style>
