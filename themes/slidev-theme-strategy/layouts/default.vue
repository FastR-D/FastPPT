<template>
  <div class="slidev-layout stg-default">
    <div class="stg-stripe"><span class="bar" /><span class="ticks" /></div>
    <div class="stg-default-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.stg-default {
  display: flex;
  flex-direction: column;
}
.stg-default .stg-stripe {
  margin-top: 0;
  margin-bottom: 1.6rem;
  width: 100%;
}
.stg-default-body {
  flex: 1;
}
</style>
