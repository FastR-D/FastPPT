<template>
  <!-- 数据指标页：大号数字 + 标签的 KPI 行，数字用主/次色区分，支撑单页主张的数据证据。 -->
<div class="slidev-layout ext-metrics">
    <div class="ext-metrics-inner"><slot /></div>
  </div>
</template>

<style scoped>
.ext-metrics { display: flex; flex-direction: column; justify-content: center; background: var(--ext-text); color: white; }
.ext-metrics-inner :deep(h1) { color: white; font-size: 54px; }
.ext-metrics-inner :deep(strong) { color: var(--ext-primary); font-size: 1.5em; }
.ext-metrics-inner :deep(p) { color: #C9D0D4; }
</style>
