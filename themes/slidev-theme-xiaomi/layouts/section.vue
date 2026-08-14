<template>
  <!-- 章节转场：左对齐超大标题，以小米橙短线建立节奏。 -->
<div class="slidev-layout ext-section">
    <div class="ext-section-inner"><slot /></div>
  </div>
</template>

<style scoped>
.ext-section { display: flex; align-items: center; }
.ext-section-inner { max-width: 900px; border-left: 8px solid var(--ext-primary); padding-left: 36px; }
.ext-section-inner :deep(h1) { font-size: 68px; margin: 0; }
.ext-section-inner :deep(p) { color: var(--ext-muted); }
</style>
