<script setup lang="ts">
</script>

<template>
  <!-- 胶囊标签：圆角小标签，次色 #ED7D31 点缀，用于分类/阶段标记。 -->
<span class="ext-xiaomi-pill"><slot /></span>
</template>

<style scoped>
.ext-xiaomi-pill { display: inline-flex; align-items: center; padding: 0.1rem 0.7rem; border: 1px solid var(--ext-accent); border-radius: 999px; color: var(--ext-text); font-size: 0.75rem; }
</style>
