<template>
  <div class="slidev-layout raft-two-cols">
    <div class="col">
      <slot name="default" />
    </div>
    <div class="col">
      <slot name="right" />
    </div>
  </div>
</template>

<style scoped>
.raft-two-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.6rem;
  align-content: start;
}

.raft-two-cols :deep(h1) {
  display: inline-block;
  background: var(--raft-yellow);
  border: var(--raft-border);
  box-shadow: var(--raft-shadow);
  padding: 0.25rem 1rem;
  font-size: 1.9rem;
}

.col > :deep(h2:first-child),
.col > :deep(h3:first-child) {
  display: inline-block;
  background: var(--raft-lavender);
  border: var(--raft-border);
  box-shadow: var(--raft-shadow-sm);
  padding: 0.1rem 0.7rem;
}
</style>
