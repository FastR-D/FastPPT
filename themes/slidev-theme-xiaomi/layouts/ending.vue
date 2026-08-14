<template>
  <!-- 收尾页：感谢/结论居中展示，橙色强调收束，与 cover 形成对称收尾。 -->
<div class="slidev-layout ext-ending">
    <div class="ext-ending-inner"><slot /></div>
  </div>
</template>

<style scoped>
.ext-ending { display: flex; align-items: center; justify-content: center; text-align: center; }
.ext-ending-inner :deep(h1) { font-size: 2.4rem; margin: 0; }
.ext-ending-inner :deep(p) { color: var(--ext-muted); }
</style>
