<template>
  <div v-if="$slidev.nav.currentLayout !== 'cover'" class="mag-page-num">
    {{ $slidev.nav.currentPage }} / {{ $slidev.nav.total }}
  </div>
</template>

<style scoped>
.mag-page-num {
  position: absolute;
  right: 2rem;
  bottom: 0.9rem;
  font-family: 'Inter', sans-serif;
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  color: var(--mag-gray);
}
</style>
