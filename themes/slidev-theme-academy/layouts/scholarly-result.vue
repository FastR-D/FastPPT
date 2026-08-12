<script setup lang="ts">
import { computed } from 'vue'
import BodyLayout from '../components/BodyLayout.vue'

const props = withDefaults(
  defineProps<{
    result?: string
    evidence?: string[]
    implication?: string
    tone?: 'primary' | 'positive' | 'caution'
  }>(),
  {
    result: '',
    evidence: () => [],
    implication: '',
    tone: 'primary',
  },
)

const accent = computed(() =>
  props.tone === 'positive'
    ? '#17805c'
    : props.tone === 'caution'
      ? '#b45309'
      : '#0f4c81',
)
</script>

<template>
  <BodyLayout>
    <slot />
    <div class="scholarly-result" :style="{ '--result-accent': accent }">
      <section class="result-claim">
        <div class="result-label">Primary result</div>
        <strong>{{ result }}</strong>
      </section>
      <section class="result-evidence">
        <div class="result-label">Evidence</div>
        <ul v-if="evidence.length">
          <li v-for="item in evidence" :key="item">{{ item }}</li>
        </ul>
        <slot v-else name="evidence" />
      </section>
      <section v-if="implication" class="result-implication">
        <div class="result-label">Implication</div>
        <p>{{ implication }}</p>
      </section>
    </div>
  </BodyLayout>
</template>

<style scoped>
.scholarly-result {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  gap: 1rem;
}
.scholarly-result section {
  padding: 1rem 1.1rem;
  border: 1px solid #d8e0e8;
  border-radius: 0.55rem;
  background: #fff;
}
.result-claim {
  border-left: 0.32rem solid var(--result-accent) !important;
}
.result-claim strong {
  display: block;
  color: var(--result-accent);
  font-size: 1.45rem;
  line-height: 1.25;
}
.result-label {
  margin-bottom: 0.45rem;
  color: #64748b;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.result-evidence ul {
  margin: 0;
}
.result-implication {
  grid-column: 1 / -1;
  background: #f7fafc !important;
}
.result-implication p {
  margin: 0;
}
</style>
