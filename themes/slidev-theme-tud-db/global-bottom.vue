<script setup lang="ts">
import { useSlideContext } from '@slidev/client'
import { computed } from 'vue'
import { slideLogos } from './scripts/logo'

import ddrgColor from './assets/ddrg-color.svg'
import ddrgWhite from './assets/ddrg-white.svg'
import tudWhite from './assets/tud-white.svg'
import tudBlack from './assets/tud-black.svg'

const { $nav } = useSlideContext()
const logos = computed(() => slideLogos[$nav.value.currentPage] ?? {})
</script>

<template>
  <div class="absolute inset-0 z-100 pointer-events-none">
    <div class="absolute flex flex-row-reverse items-start gap-[45px] top-[25px] right-[35px]">
      <div class="relative h-[45px]">
        <img
          :class="{ 'opacity-0': logos.ddrg !== 'color' }"
          class="h-full transition-opacity duration-500"
          :src="ddrgColor"
          alt="Dresden Database Research Group"
        />
        <img
          :class="{ 'opacity-0': logos.ddrg !== 'white' }"
          class="absolute inset-0 h-full transition-opacity duration-500"
          :src="ddrgWhite"
          alt="Dresden Database Research Group"
        />
      </div>
      <img
        :class="{ 'opacity-0': !logos.tud }"
        class="h-[45px] transition-opacity duration-500"
        :src="tudWhite"
        alt="TU Dresden"
      />
    </div>

    <footer
      :class="{ 'opacity-0': !logos.footer }"
      class="db-footer absolute inset-x-0 bottom-0 h-[40px] px-[30px] flex items-center justify-between bg-[var(--db-footer-bg)] pointer-events-auto transition-opacity duration-500"
    >
      <img class="h-[25px]" :src="tudBlack" alt="TU Dresden" />
      <span class="text-[12px] text-[var(--db-text)]">
        <span class="font-bold">{{ $nav.currentPage }}</span>
        <template v-if="$nav.clicksTotal > 0">
          <span class="text-[0.7em]">.{{ $nav.clicks + 1 }}</span>
        </template>
      </span>
    </footer>
  </div>
</template>
