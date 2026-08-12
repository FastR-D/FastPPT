<script setup lang="ts">
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
  <section v-if="failure" class="fatal-error" role="alert">
    <div class="fatal-error-card">
      <p class="fatal-error-kicker">FastPPT</p>
      <h1>界面遇到未预期错误</h1>
      <p>工作区数据没有因此被删除。可以先重建界面；若问题持续，请刷新应用。</p>
      <div class="fatal-error-actions">
        <button type="button" @click="retry">重建界面</button>
        <button type="button" class="secondary" @click="reload">
          刷新应用
        </button>
      </div>
    </div>
  </section>
  <slot v-else :key="resetKey" />
</template>

<style scoped>
.fatal-error {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem;
  color: var(--color-text-primary);
  background: var(--color-bg-canvas);
}

.fatal-error-card {
  width: min(32rem, 100%);
  padding: 2rem;
  border: 1px solid var(--color-border-default);
  border-radius: 1rem;
  background: var(--color-bg-panel);
  box-shadow: var(--shadow-elevated);
}

.fatal-error-kicker {
  margin: 0 0 0.5rem;
  color: var(--color-accent);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.fatal-error-card h1 {
  margin: 0;
  font-size: 1.5rem;
}

.fatal-error-card p:not(.fatal-error-kicker) {
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.fatal-error-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.fatal-error-actions button {
  padding: 0.65rem 1rem;
  border: 1px solid var(--color-accent);
  border-radius: 0.55rem;
  color: var(--color-text-on-accent);
  background: var(--color-accent);
  cursor: pointer;
}

.fatal-error-actions .secondary {
  color: var(--color-text-primary);
  border-color: var(--color-border-default);
  background: transparent;
}
</style>
