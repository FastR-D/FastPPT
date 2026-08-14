<script setup lang="ts">
</script>

<template>
  <!-- 强调框：主色 #4472C4 左边框 + 浅色底，用于关键提醒/注意事项，不引入无关颜色。 -->
<div class="ext-xiaomi-callout"><strong class="ext-xiaomi-callout-tag"><slot name="tag" /></strong><div><slot /></div></div>
</template>

<style scoped>
.ext-xiaomi-callout { display: block; border-top: 4px solid var(--ext-accent); background: var(--ext-surface); padding: 1rem 1.2rem; }
.ext-xiaomi-callout-tag { display: block; color: var(--ext-primary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.2rem; }
</style>
