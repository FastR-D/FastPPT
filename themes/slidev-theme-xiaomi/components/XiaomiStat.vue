<script setup lang="ts">
</script>

<template>
  <!-- 数字统计：大号 MiSans 数字 + 单位标签，主/次色可选，用于单页主张下的关键指标。 -->
<span class="ext-xiaomi-stat"><strong class="ext-xiaomi-stat-value"><slot name="value" /></strong><small class="ext-xiaomi-stat-label"><slot /></small></span>
</template>

<style scoped>
.ext-xiaomi-stat { display: inline-grid; gap: 2px; }
.ext-xiaomi-stat-value { color: var(--ext-primary); font-size: 3.2rem; font-weight: 600; line-height: 1; letter-spacing: -0.05em; }
.ext-xiaomi-stat-label { color: var(--ext-muted); font-size: 0.85rem; }
</style>
