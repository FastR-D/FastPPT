<template>
  <div v-if="$slidev.nav.currentLayout !== 'cover'" class="stg-page-chip">
    {{ $slidev.nav.currentPage }} / {{ $slidev.nav.total }}
  </div>
</template>

<style scoped>
.stg-page-chip {
  position: absolute;
  right: 1.2rem;
  bottom: 0.8rem;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  color: var(--stg-muted);
}
</style>
