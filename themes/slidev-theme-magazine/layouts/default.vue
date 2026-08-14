<template>
  <div class="slidev-layout mag-default mag-hairline--top mag-hairline--bottom">
    <div class="mag-default-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.mag-default {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--mag-black);
  border-bottom: 1px solid var(--mag-black);
}
.mag-default-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
</style>
