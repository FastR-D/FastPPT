<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'

const props = defineProps<{
  open: boolean
  path: string
  page: number
  sending: boolean
}>()

const emit = defineEmits<{
  close: []
  submit: [instruction: string]
}>()

const instruction = shallowRef('')
watch(() => props.open, (open) => { if (open) instruction.value = '' })
const canSubmit = computed(() => instruction.value.trim() && !props.sending)
</script>

<template>
  <div v-if="open" class="dialog-backdrop" @click.self="emit('close')">
    <section class="page-dialog" role="dialog" aria-modal="true">
      <header><div><small>单页修改对话</small><h2>{{ path }} · 第 {{ page }} 页</h2></div><button @click="emit('close')">×</button></header>
      <textarea v-model="instruction" rows="6" placeholder="描述这一页需要怎样修改。Agent 只应修改目标页，并保持其他页面不变。"></textarea>
      <footer>
        <button type="button" class="secondary" @click="emit('close')">取消</button>
        <button type="button" class="primary" :disabled="!canSubmit" @click="emit('submit', instruction.trim())">{{ sending ? '创建中…' : '创建修改对话' }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: fixed; inset: 0; z-index: 1100; display: grid; place-items: center; padding: 24px; background: rgb(5 10 20 / .72); backdrop-filter: blur(7px); }
.page-dialog { width: min(620px, 100%); border: 1px solid var(--color-border); border-radius: 14px; background: var(--color-panel); box-shadow: 0 24px 70px rgb(0 0 0 / .5); }
header, footer { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; }
header { border-bottom: 1px solid var(--color-border); } footer { justify-content: flex-end; gap: 8px; border-top: 1px solid var(--color-border); }
h2 { margin: 3px 0 0; font-size: 15px; } small { color: var(--color-muted); }
header button { border: 0; background: transparent; color: var(--color-muted); font-size: 22px; }
textarea { width: calc(100% - 36px); margin: 18px; resize: vertical; border: 1px solid var(--color-border); border-radius: 9px; padding: 12px; background: var(--color-panel-raised); color: var(--color-text); box-sizing: border-box; }
footer button { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 7px; }
.primary { background: var(--color-accent); color: #071612; } .secondary { background: transparent; color: var(--color-text); }
</style>
