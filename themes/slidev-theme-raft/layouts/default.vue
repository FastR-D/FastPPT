<template>
  <div class="slidev-layout raft-default">
    <slot />
  </div>
</template>

<style scoped>
.raft-default :deep(h1) {
  display: inline-block;
  background: var(--raft-yellow);
  border: var(--raft-border);
  box-shadow: var(--raft-shadow);
  padding: 0.25rem 1rem;
  font-size: 1.9rem;
}
</style>
