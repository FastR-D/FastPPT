<script setup lang="ts">
import { computed } from 'vue'

import FileTree from '../files/FileTree.vue'

import type { FileNode } from '@fastppt/protocol'

const props = defineProps<{
  activity: 'files' | 'slidev'
  files: readonly FileNode[]
  selectedPath: string | undefined
  markdown: string
  selectedPage: number
  loading: boolean
}>()

const emit = defineEmits<{
  selectActivity: [activity: 'files' | 'slidev']
  selectFile: [path: string]
  retryFiles: []
  selectPage: [page: number]
  editPage: [page: number]
}>()

function slideChunks(source: string): string[] {
  const delimiter = /\r?\n---\r?\n/g
  const chunks: string[] = []
  let start = 0
  let match: RegExpExecArray | null
  let frontmatter = source.startsWith('---\n') || source.startsWith('---\r\n')
  while ((match = delimiter.exec(source))) {
    if (frontmatter) {
      frontmatter = false
      continue
    }
    chunks.push(source.slice(start, match.index).trim())
    start = match.index + match[0].length
    const lineEnd = source.indexOf('\n', start)
    const next = source.slice(start, lineEnd < 0 ? source.length : lineEnd).trim()
    frontmatter = /^(layout|class|clicks|background|transition):/.test(next)
  }
  chunks.push(source.slice(start).trim())
  return chunks.filter(Boolean)
}

const slides = computed(() =>
  slideChunks(props.markdown).map((content, index) => ({
    page: index + 1,
    title:
      content.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() ||
      content.replace(/^---[\s\S]*?---/, '').trim().split('\n')[0] ||
      'Untitled',
    layout: content.match(/^layout:\s*(.+)$/m)?.[1]?.trim() || (index === 0 ? 'cover' : 'default'),
  })),
)
</script>

<template>
  <aside class="editor-navigation panel-surface">
    <nav class="activity-rail" aria-label="编辑视图">
      <button :class="{ active: activity === 'files' }" title="文件" aria-label="文件" @click="emit('selectActivity', 'files')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h6l2 2h8v16H4zM6 7v12h12V7z" /></svg>
      </button>
      <button :class="{ active: activity === 'slidev' }" title="Slidev 页面" aria-label="Slidev 页面" @click="emit('selectActivity', 'slidev')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H4zM7 19h10v2H7zm5-13-4 7h3l-1 3 6-8h-3l1-2z" /></svg>
      </button>
    </nav>
    <section class="navigation-pane">
      <header>
        <strong>{{ activity === 'files' ? 'EXPLORER' : 'SLIDEV' }}</strong>
        <button v-if="activity === 'files'" type="button" :disabled="loading" @click="emit('retryFiles')">↻</button>
      </header>
      <FileTree v-if="activity === 'files' && files.length" :nodes="files" :selected-path="selectedPath" @select="emit('selectFile', $event)" />
      <div v-else-if="activity === 'files'" class="empty">{{ loading ? '读取文件…' : '工作区为空' }}</div>
      <div v-else class="slides-list">
        <button
          v-for="slide in slides"
          :key="slide.page"
          type="button"
          class="slide-item"
          :class="{ active: selectedPage === slide.page }"
          @click="emit('selectPage', slide.page)"
          @contextmenu.prevent="emit('editPage', slide.page)"
        >
          <span class="slide-index">{{ slide.page }}</span>
          <span><strong>{{ slide.title }}</strong><small>{{ slide.layout }}</small></span>
        </button>
        <div v-if="!slides.length" class="empty">请选择 Slidev Markdown</div>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.editor-navigation { display: grid; grid-template-columns: 48px minmax(0, 1fr); min-width: 0; overflow: hidden; border-right: 1px solid var(--color-border); }
.activity-rail { display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 8px; border-right: 1px solid var(--color-border); background: #121713; }
.activity-rail button { position: relative; display: grid; width: 44px; height: 44px; place-items: center; border: 0; background: transparent; color: var(--color-muted); }
.activity-rail button.active { color: var(--color-text); }
.activity-rail button.active::before { position: absolute; inset: 5px auto 5px 0; width: 2px; background: var(--color-accent); content: ''; }
.activity-rail svg { width: 23px; fill: currentcolor; }
.navigation-pane { min-width: 0; overflow: auto; }
.navigation-pane > header { display: flex; align-items: center; justify-content: space-between; height: 36px; padding: 0 10px; color: var(--color-muted); font-size: 11px; letter-spacing: .08em; }
.navigation-pane > header button { border: 0; background: transparent; color: var(--color-muted); }
.slides-list { display: grid; padding: 3px 0; }
.slide-item { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 6px; align-items: start; padding: 7px 10px; border: 0; background: transparent; color: var(--color-text); text-align: left; }
.slide-item:hover, .slide-item.active { background: var(--color-panel-raised); }
.slide-item.active { box-shadow: inset 2px 0 var(--color-accent); }
.slide-index { color: var(--color-muted); font-family: var(--font-mono); font-size: 11px; }
.slide-item span:last-child { display: grid; min-width: 0; gap: 2px; }
.slide-item strong { overflow: hidden; font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.slide-item small, .empty { color: var(--color-muted); font-size: 10px; }
.empty { padding: 12px; }
</style>
