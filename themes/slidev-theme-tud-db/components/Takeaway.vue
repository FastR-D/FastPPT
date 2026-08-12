<script setup lang="ts">
import { computed } from 'vue'

// F1-style callout: a coloured left rule + a small uppercase eyebrow label, no
// fill, no symbol, upright (non-italic) body text. Knobs:
//   label  the eyebrow text ("Key Takeaway", "Question", "Problem"…); label=""
//          hides it and leaves a bare ruled aside.
//   color  the rule + label colour: a brand keyword (below) or any CSS colour,
//          so e.g. problems read red while takeaways stay blue.
//   size   optional overall scale — body text matches the slide's default text
//          size by default; set e.g. size="1.1em" (or a bare number "1.1") to
//          enlarge the whole callout. All spacing is em-based, so it stays
//          vertically balanced at any size.
// Authoring (MDC block, needs `mdc: true`):
//   ::takeaway{label="Problem" color="red"}
//   A question can hide the fact that nothing was proven.
//   ::
const props = defineProps({
  label: { type: String, default: 'Key Takeaway' },
  color: { type: String, default: 'blue' },
  size: { type: String, default: '' },
})

// Brand-colour keywords -> theme tokens; anything else is used as a raw CSS colour.
const TOKENS: Record<string, string> = {
  blue: 'var(--db-heading-blue)',
  navy: 'var(--db-navy)',
  teal: 'var(--db-accent3)',
  green: 'var(--db-accent1)',
  yellow: 'var(--db-accent4)',
  red: 'var(--db-accent5)',
  orange: 'var(--db-accent5)',
  purple: 'var(--db-accent6)',
}
const accent = computed(() => TOKENS[props.color?.toLowerCase()] ?? props.color)

// A bare number ("1.1") is treated as an em multiplier; otherwise used verbatim.
const fontSize = computed(() =>
  !props.size ? undefined : /^[\d.]+$/.test(props.size) ? `${props.size}em` : props.size,
)
</script>

<template>
  <div class="db-takeaway" :style="{ '--tk-accent': accent, fontSize }">
    <div v-if="label" class="db-takeaway__label">{{ label }}</div>
    <div class="db-takeaway__body"><slot /></div>
  </div>
</template>
