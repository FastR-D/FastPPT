<script setup lang="ts">
import { computed } from 'vue'
import { useSlideContext } from '@slidev/client'
import Logo from '../components/Logo.vue'
import { useThemeConfig } from '../composables/use-theme-config'

const props = defineProps({
  variant: {
    type: String as () => 'default' | 'cover',
    default: 'default',
  },
  inverted: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: '',
  },
})

const { $page } = useSlideContext()
const { deckTitle, showPageNumber } = useThemeConfig()

const resolvedTitle = computed(() => props.title || deckTitle.value)
const shouldShowPage = computed(() => props.variant !== 'cover' && showPageNumber.value)
const isInverted = computed(() => props.inverted)
</script>

<template>
  <header class="Header"
          :class="{
            Header_variant_cover: variant === 'cover',
            Header_inverted: inverted,
          }">
    <div class="Header-Logo">
      <Logo v-if="variant === 'cover'"
            size="full"
            :title="resolvedTitle || 'Theme logo'"
            :foreground="isInverted ? 'var(--theme-color-light-0)' : 'var(--theme-color-dark-0)'"
            :contrast="isInverted ? 'var(--theme-color-dark-0)' : 'var(--theme-color-light-0)'"
            class="Header-LogoImage" />
      <Logo v-else
            size="short"
            :title="resolvedTitle || 'Theme logo'"
            :background="isInverted ? 'var(--theme-color-light-0)' : 'var(--theme-color-dark-0)'"
            :foreground="isInverted ? 'var(--theme-color-dark-0)' : 'var(--theme-color-light-0)'"
            class="Header-LogoImage" />
    </div>

    <div v-if="resolvedTitle"
         class="Header-DeckTitle">
      <span>{{ resolvedTitle }}</span>
    </div>

    <div v-if="shouldShowPage"
         class="Header-Page">
      <span>{{ $page }}</span>
    </div>
  </header>
</template>

<style scoped>
.Header {
  display: grid;
  grid-template-columns: repeat(var(--theme-grid-columns), minmax(0, 1fr));
  column-gap: var(--theme-grid-gap);
  align-items: start;
  width: 100%;
  padding-top: calc(var(--theme-grid-module) * 3);
  color: var(--theme-text-muted);
}

.Header-Logo {
  grid-column: 1 / 4;
  display: flex;
  align-items: flex-start;
}

.Header-LogoImage {
  display: block;
  height: calc(var(--theme-grid-module) * 5);
  width: auto;
}

.Header_variant_cover .Header-LogoImage {
  height: calc(var(--theme-grid-module) * 6);
}

.Header-DeckTitle {
  grid-column: 7 / 12;
  justify-self: stretch;
  text-align: left;
  color: inherit;
  font-size: var(--theme-text-size-1);
  line-height: var(--theme-text-line-1);
  min-width: 0;
}

.Header-DeckTitle > span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Header-Page {
  grid-column: 12 / 13;
  justify-self: end;
  text-align: right;
  color: inherit;
  font-size: var(--theme-text-size-0);
  line-height: var(--theme-text-line-0);
}

.Header_variant_cover .Header-DeckTitle,
.Header_variant_cover .Header-Page {
  display: none;
}

.Header_inverted {
  color: var(--theme-text-muted-on-contrast);
}
</style>
