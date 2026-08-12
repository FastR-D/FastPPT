<script setup lang="ts">
import BodyLayout from '../components/BodyLayout.vue'

withDefaults(
  defineProps<{
    cards?: Array<{ title: string; body?: string; eyebrow?: string }>
    columns?: 2 | 3 | 4
  }>(),
  {
    cards: () => [],
    columns: 3,
  },
)
</script>

<template>
  <BodyLayout>
    <slot />
    <div
      class="cobalt-cards"
      :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
    >
      <article v-for="(card, index) in cards" :key="card.title">
        <span>{{ card.eyebrow || String(index + 1).padStart(2, '0') }}</span>
        <h2>{{ card.title }}</h2>
        <p v-if="card.body">{{ card.body }}</p>
      </article>
      <slot name="cards" />
    </div>
  </BodyLayout>
</template>

<style scoped>
.cobalt-cards {
  display: grid;
  gap: 0.8rem;
}
.cobalt-cards article {
  min-height: 8.5rem;
  padding: 1rem;
  border: 1px solid #c8d4df;
  border-radius: 0.75rem;
  background: linear-gradient(145deg, #ffffff, #edf4f8);
}
.cobalt-cards span {
  color: #27759b;
  font-size: 0.67rem;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.cobalt-cards h2 {
  margin: 0.5rem 0 0.4rem;
  color: #173b53;
  font-size: 1.05rem;
}
.cobalt-cards p {
  margin: 0;
  color: #475569;
  font-size: 0.78rem;
  line-height: 1.45;
}
</style>
