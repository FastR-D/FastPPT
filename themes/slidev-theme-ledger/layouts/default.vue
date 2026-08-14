<template>
  <div class="slidev-layout led-default">
    <div class="led-toprule" />
    <div class="led-default-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.led-default {
  display: flex;
  flex-direction: column;
}
.led-default .led-toprule {
  flex: 0 0 auto;
}
.led-default-body {
  flex: 1;
  display: flex;
  flex-direction: column;
}
</style>
