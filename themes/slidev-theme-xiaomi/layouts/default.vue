<template>
  <div class="slidev-layout ext-default">
    <div class="ext-rule" />
    <slot />
  </div>
</template>

<style scoped>
.ext-default { display: flex; flex-direction: column; }
.ext-rule { flex: 0 0 auto; }
</style>
