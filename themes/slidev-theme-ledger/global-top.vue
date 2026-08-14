<template>
  <div v-if="$slidev.nav.currentLayout !== 'cover'" class="led-footer">
    <span class="run"><slot name="running-title" /></span>
    <span class="rule" />
    <span class="page">{{ $slidev.nav.currentPage }} / {{ $slidev.nav.total }}</span>
  </div>
</template>
