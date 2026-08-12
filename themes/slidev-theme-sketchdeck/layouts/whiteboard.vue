<template>
  <div class="slidev-layout grid-paper sk-whiteboard">
    <div class="sk-wb-head">
      <slot name="title" />
      <slot />
    </div>
    <div class="sk-wb-body">
      <slot name="board">
        <SketchPlaceholder label="[ full-bleed diagram ]" :tilt="0" />
      </slot>
    </div>
  </div>
</template>

<style scoped>
.sk-whiteboard {
  padding: 3.3%;
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
  position: relative;
}

.sk-wb-head {
  display: flex;
  align-items: center;
  gap: 1.2rem;
  flex-wrap: wrap;
}

.sk-wb-head :deep(h1),
.sk-wb-head :deep(h2) {
  font-size: 3.8rem;
  margin: 0;
}

.sk-wb-body {
  flex: 1;
  min-height: 0;
}
</style>
