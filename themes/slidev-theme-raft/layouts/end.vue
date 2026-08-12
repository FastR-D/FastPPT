<template>
  <div class="slidev-layout raft-end">
    <div class="raft-end-deco" aria-hidden="true">
      <span class="deco deco-a" />
      <span class="deco deco-b" />
      <span class="deco deco-c" />
    </div>
    <div class="raft-end-card">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.raft-end {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.raft-end-card {
  background: var(--raft-ink);
  color: var(--raft-cream);
  border: var(--raft-border);
  box-shadow: var(--raft-shadow-lg);
  padding: 3rem 4.5rem;
  min-width: 62%;
  text-align: center;
  position: relative;
  z-index: 1;
}

.raft-end-card :deep(h1) {
  color: var(--raft-yellow);
  font-size: 3.4rem;
  margin: 0;
}

.raft-end-card :deep(p) {
  color: var(--raft-cream);
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 1rem;
  margin: 1rem 0 0;
}

.deco {
  position: absolute;
  border: var(--raft-border);
  box-shadow: var(--raft-shadow);
}

.deco-a {
  width: 6rem;
  height: 6rem;
  background: var(--raft-lavender);
  left: 8%;
  top: 14%;
  transform: rotate(-7deg);
}

.deco-b {
  width: 4rem;
  height: 4rem;
  background: var(--raft-orange);
  right: 10%;
  top: 18%;
  transform: rotate(5deg);
}

.deco-c {
  width: 5rem;
  height: 5rem;
  background: var(--raft-cyan);
  right: 16%;
  bottom: 12%;
  transform: rotate(-4deg);
}
</style>
