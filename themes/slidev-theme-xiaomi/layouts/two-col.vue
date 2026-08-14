<template>
  <!-- 双栏正文：克制的 45/55 信息分栏，使用细灰线而非卡片堆叠。 -->
<div class="slidev-layout ext-two-col">
    <div class="col"><slot name="default" /></div>
    <div class="col"><slot name="right" /></div>
  </div>
</template>

<style scoped>
.ext-two-col { display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 52px; align-content: center; }
.ext-two-col .col + .col { border-left: 1px solid var(--ext-line); padding-left: 52px; }
.ext-two-col :deep(h1) { font-size: 46px; }
</style>
