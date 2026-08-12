<script setup lang="ts">
import BodyLayout from '../components/BodyLayout.vue'

withDefaults(
  defineProps<{
    items?: string[]
    active?: number
  }>(),
  {
    items: () => [],
    active: 1,
  },
)
</script>

<template>
  <BodyLayout>
    <slot />
    <ol class="frankfurt-agenda">
      <li
        v-for="(item, index) in items"
        :key="item"
        :class="{ active: index + 1 === active }"
      >
        <span>{{ String(index + 1).padStart(2, '0') }}</span>
        <strong>{{ item }}</strong>
      </li>
    </ol>
  </BodyLayout>
</template>

<style scoped>
.frankfurt-agenda {
  display: grid;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.frankfurt-agenda li {
  display: grid;
  grid-template-columns: 3.2rem 1fr;
  align-items: center;
  min-height: 2.7rem;
  border-left: 0.32rem solid #cbd5e1;
  background: #f8fafc;
  color: #64748b;
}
.frankfurt-agenda li.active {
  border-left-color: #0f4c81;
  background: #eaf2f8;
  color: #0f3557;
}
.frankfurt-agenda span {
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
