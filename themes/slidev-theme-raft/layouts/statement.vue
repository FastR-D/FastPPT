<template>
  <div class="slidev-layout raft-statement">
    <div class="raft-statement-inner">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.raft-statement {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.raft-statement-inner :deep(h1) {
  font-size: 3rem;
  line-height: 1.2;
  margin: 0;
}

.raft-statement-inner :deep(mark),
.raft-statement-inner :deep(strong) {
  display: inline-block;
  background: var(--raft-yellow);
  border: var(--raft-border);
  box-shadow: var(--raft-shadow-sm);
  padding: 0 0.3em;
  line-height: 1.2;
  vertical-align: baseline;
}
</style>
