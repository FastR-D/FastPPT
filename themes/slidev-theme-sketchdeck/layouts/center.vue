<template>
  <div class="slidev-layout sk-center">
    <div class="sk-center-inner"><slot /></div>
  </div>
</template>

<style scoped>
.sk-center {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.sk-center-inner {
  max-width: 46ch;
}
</style>
