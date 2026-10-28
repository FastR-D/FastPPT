<script setup lang="ts">
import { computed } from 'vue'
import { useSlideContext } from '@slidev/client'
import { sections } from '../utils/teaching.mjs'
import WhuBody from '../components/WhuBody.vue'
const { $slidev } = useSlideContext()
const groups = computed(() => sections($slidev.nav.slides))
</script>
<template>
  <WhuBody>
    <header class="whu-header"><slot /></header>
    <ol class="whu-toc">
      <li v-for="(group, i) in groups" :key="group.page">
        <button type="button" @click="$slidev.nav.go(group.page)">
          <span>{{ String(i + 1).padStart(2, '0') }}</span
          ><strong>{{ group.title }}</strong
          ><small>{{ String(group.page).padStart(2, '0') }}</small>
        </button>
      </li>
    </ol>
    <p v-if="!groups.length" class="whu-muted">
      使用 section 版式或 sectionStart: true 标记课程章节。
    </p>
  </WhuBody>
</template>
