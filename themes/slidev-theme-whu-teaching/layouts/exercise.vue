<script setup lang="ts">
import WhuBody from '../components/WhuBody.vue'
withDefaults(defineProps<{ questionLabel?: string; answerLabel?: string }>(), {
  questionLabel: '思考题',
  answerLabel: '分析与讨论',
})
</script>
<template>
  <WhuBody>
    <header class="whu-header"><slot /></header>
    <div class="whu-exercise-body">
      <div class="whu-exercise-question">
        <div class="whu-exercise-label">{{ questionLabel }}</div>
        <slot name="question" />
      </div>
      <div class="whu-exercise-answer">
        <div class="whu-exercise-label">{{ answerLabel }}</div>
        <slot name="answer" />
      </div>
    </div>
  </WhuBody>
</template>
