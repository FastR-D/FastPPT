<script setup lang="ts">
import { Box, Button, RichText } from '@fastppt/components'
import { computed, shallowRef } from 'vue'
import { renderMessageMarkdown } from '../../workspace/message-markdown.js'
const props = defineProps<{ content: string }>()
const rendered = computed(() => renderMessageMarkdown(props.content))
const copyStatus = shallowRef('')
async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.content)
    copyStatus.value = '已复制'
  } catch {
    copyStatus.value = '复制失败，请手动选择文字'
  }
}
</script>
<template>
  <Box class="message-body">
    <!-- Only markdown-it output with html:false, validated links and disabled images. -->
    <RichText class="message-markdown" :html="rendered" />
    <Button
      variant="quiet"
      class="copy-message"
      type="button"
      aria-label="复制消息"
      @click="copy"
    >
      {{ copyStatus || '复制' }}
    </Button
    >
  </Box>
</template>
<style scoped>
.message-body {
  min-width: 0;
}
.message-markdown {
  line-height: 1.75;
  overflow-wrap: anywhere;
  font-size: 13px;
}
.message-markdown
  :deep(:is(h1, h2, h3, h4, p, ul, ol, blockquote, pre, table)) {
  margin: 0 0 12px;
}
.message-markdown :deep(:last-child) {
  margin-bottom: 0;
}
.message-markdown :deep(h1) {
  font-size: 1.3em;
}
.message-markdown :deep(h2) {
  font-size: 1.18em;
}
.message-markdown :deep(h3) {
  font-size: 1.08em;
}
.message-markdown :deep(:is(ul, ol)) {
  padding-left: 1.6em;
}
.message-markdown :deep(li + li) {
  margin-top: 5px;
}
.message-markdown :deep(blockquote) {
  padding: 4px 0 4px 13px;
  border-left: 3px solid var(--color-accent);
  color: var(--color-muted);
}
.message-markdown :deep(a) {
  color: var(--color-accent-strong);
  text-underline-offset: 3px;
}
.message-markdown :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--color-canvas);
  border-radius: 4px;
  padding: 2px 4px;
}
.message-markdown :deep(pre) {
  max-width: 100%;
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-canvas);
  line-height: 1.6;
}
.message-markdown :deep(pre code) {
  padding: 0;
  white-space: pre;
}
.message-markdown :deep(table) {
  display: block;
  max-width: 100%;
  overflow: auto;
  border-collapse: collapse;
  font-size: 12px;
}
.message-markdown :deep(:is(th, td)) {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  text-align: left;
}
.message-markdown :deep(th) {
  background: var(--color-panel-raised);
}
.message-markdown :deep(hr) {
  border: 0;
  border-top: 1px solid var(--color-border);
  margin: 18px 0;
}
.copy-message {
  margin-top: 9px;
}
</style>
