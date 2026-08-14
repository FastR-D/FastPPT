<template>
  <!-- 小米式产品封面：左下信息锚点，大面积留白或产品主视觉。 -->
<div class="slidev-layout ext-cover">
    <div class="ext-cover-inner">
      <span class="ext-pill">XIAOMI</span>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ext-cover { display: flex; align-items: flex-end; padding-bottom: 72px; }
.ext-cover::after { content: ''; position: absolute; right: 72px; top: 56px; width: 14px; height: 14px; background: var(--ext-primary); }
.ext-cover-inner { max-width: 70%; }
.ext-cover-inner :deep(h1) { font-size: 72px; margin: 0; }
.ext-cover-inner :deep(p) { color: var(--ext-muted); font-size: 22px; max-width: 720px; }
</style>
