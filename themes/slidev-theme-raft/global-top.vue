<template>
  <div v-if="$slidev.nav.currentLayout !== 'cover'" class="raft-page-chip">
    {{ $slidev.nav.currentPage }} / {{ $slidev.nav.total }}
  </div>
</template>

<style scoped>
.raft-page-chip {
  position: absolute;
  right: 1.1rem;
  bottom: 0.9rem;
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 0.7rem;
  color: var(--raft-ink);
  background: var(--raft-white);
  border: var(--raft-border);
  box-shadow: var(--raft-shadow-sm);
  padding: 0.1rem 0.5rem;
}
</style>
