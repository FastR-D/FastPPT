<template>
  <div class="slidev-layout raft-quote">
    <div class="raft-quote-mark" aria-hidden="true">“</div>
    <div class="raft-quote-card">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.raft-quote {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.raft-quote-mark {
  position: absolute;
  top: 0.5rem;
  left: 2.5rem;
  font-size: 11rem;
  font-weight: 700;
  line-height: 1;
  color: var(--raft-pink);
  -webkit-text-stroke: 2px var(--raft-ink);
}

.raft-quote-card {
  background: var(--raft-white);
  border: var(--raft-border);
  box-shadow: var(--raft-shadow-lg);
  padding: 2rem 2.6rem;
  max-width: 74%;
  position: relative;
  z-index: 1;
}

.raft-quote-card :deep(h1),
.raft-quote-card :deep(p:first-child) {
  font-size: 1.8rem;
  font-weight: 700;
  line-height: 1.35;
  margin: 0;
}

.raft-quote-card :deep(p + p) {
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 0.95rem;
  margin: 1.2rem 0 0;
}
</style>
