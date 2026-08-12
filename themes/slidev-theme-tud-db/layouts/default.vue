<script setup lang="ts">
import { useLogo } from '../scripts/logo'

// "Titel und Inhalt": title + single content column. Chrome via DbFrame.
// `codeSize` frontmatter (optional) overrides the code font size for the slide.
const props = defineProps({
  codeSize: { type: String, default: '' },
})

useLogo({ ddrg: 'color', footer: true })
</script>

<template>
  <DbFrame :code-size="props.codeSize">
    <slot />
  </DbFrame>
</template>
