<script setup lang="ts">
import { Box, Button, Heading, Panel, Text } from '@fastrd/ui-vue'
import { onErrorCaptured, ref } from 'vue'

const failure = ref(false)
const resetKey = ref(0)

onErrorCaptured(() => {
  failure.value = true
  return false
})

function retry(): void {
  failure.value = false
  resetKey.value += 1
}

function reload(): void {
  window.location.reload()
}
</script>

<template>
  <Panel v-if="failure" class="fatal-error" role="alert">
    <Box class="fatal-error-card">
      <Text as="p" class="fatal-error-kicker">FastPPT</Text>
      <Heading as="h1">界面遇到未预期错误</Heading>
      <Text as="p"
      >
        工作区数据没有因此被删除。可以先重建界面；若问题持续，请刷新应用。
      </Text
      >
      <Box class="fatal-error-actions">
        <Button variant="secondary" type="button" @click="retry"
        >
          重建界面
        </Button
        >
        <Button
          variant="secondary"
          type="button"
          class="secondary"
          @click="reload"
        >
          刷新应用
        </Button>
      </Box>
    </Box>
  </Panel>
  <slot v-else :key="resetKey" />
</template>

<style scoped>
.fatal-error {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem;
  color: var(--color-text);
  background: var(--color-canvas);
}

.fatal-error-card {
  width: min(32rem, 100%);
  padding: 2rem;
  border: 1px solid var(--color-border);
  border-radius: 1rem;
  background: var(--color-panel);
  box-shadow: var(--shadow-modal);
}

.fatal-error-kicker {
  margin: 0 0 0.5rem;
  color: var(--color-accent-strong);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.fatal-error-card h1 {
  margin: 0;
  font-size: 1.5rem;
}

.fatal-error-card p:not(.fatal-error-kicker) {
  color: var(--color-secondary);
  line-height: 1.6;
}

.fatal-error-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
}
</style>
