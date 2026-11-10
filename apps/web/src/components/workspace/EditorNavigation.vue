<script setup lang="ts">
import {
  Aside,
  Box,
  Button,
  Header,
  Panel,
  Text,
} from '@fastrd/ui-vue'
import { computed, nextTick, shallowRef, onMounted, onUnmounted, useTemplateRef, watch } from 'vue'
import { parseSlidevDocument } from '@fastppt/markdown/parser'
import { createPageWheelHandler } from '../../workspace/page-wheel.js'

import FileTree from '../files/FileTree.vue'

import type { FileNode } from '@fastppt/protocol'

const props = defineProps<{
  embedded?: boolean
  activity: 'files' | 'slidev'
  files: readonly FileNode[]
  selectedPath: string | undefined
  markdown: string
  selectedPage: number
  loading: boolean
}>()

const emit = defineEmits<{
  selectFile: [path: string]
  retryFiles: []
  selectPage: [page: number]
  editPage: [page: number]
  remakePage: [page: number]
}>()

const menu = shallowRef<{ page: number; x: number; y: number }>()
function openMenu(event: MouseEvent, page: number): void {
  emit('selectPage', page)
  menu.value = {
    page,
    x: Math.min(event.clientX, window.innerWidth - 210),
    y: Math.min(event.clientY, window.innerHeight - 100),
  }
}
function dismiss(): void {
  menu.value = undefined
}
function editPage(remake = false): void {
  if (!menu.value) return
  if (remake) emit('remakePage', menu.value.page)
  else emit('editPage', menu.value.page)
  dismiss()
}
function closeOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') dismiss()
}
onMounted(() => {
  window.addEventListener('click', dismiss)
  window.addEventListener('keydown', closeOnEscape)
  window.addEventListener('resize', dismiss)
})
onUnmounted(() => {
  window.removeEventListener('click', dismiss)
  window.removeEventListener('keydown', closeOnEscape)
  window.removeEventListener('resize', dismiss)
})
const slides = computed(() => {
  // An incomplete YAML edit must not take down the workspace.
  try {
    return parseSlidevDocument(props.markdown).map((slide, index) => ({
      page: index + 1,
      title: slide.title || slide.content.trim().split('\n')[0] || 'Untitled',
      layout:
        typeof slide.frontmatter.layout === 'string'
          ? slide.frontmatter.layout
          : index === 0
            ? 'cover'
            : 'default',
    }))
  } catch {
    return []
  }
})
const slidesList = useTemplateRef<HTMLElement>('slidesList')
const handlePageWheel = createPageWheelHandler((direction) => {
  const page = Math.max(1, Math.min(slides.value.length, props.selectedPage + direction))
  if (page !== props.selectedPage) emit('selectPage', page)
}, () => props.activity === 'slidev' && slides.value.length > 0 && !menu.value)
watch(() => [props.selectedPage, slides.value.length, props.activity], async () => {
  await nextTick()
  slidesList.value?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}, { immediate: true })
</script>

<template>
  <Aside
    class="editor-navigation panel-surface"
    :class="{ embedded }"
    :aria-label="activity === 'files' ? '文件树' : '页面大纲'"
    @wheel="handlePageWheel"
  >
    <Panel class="navigation-pane">
      <Header>
        <Text as="strong">
          {{
            activity === 'files' ? '文件' : '页面大纲'
          }}
        </Text>
        <Button
          v-if="activity === 'files'"
          variant="icon"
          type="button"
          aria-label="刷新文件"
          title="刷新文件"
          :disabled="loading"
          @click="emit('retryFiles')"
        >
          ↻
        </Button>
      </Header>
      <FileTree
        v-if="activity === 'files' && files.length"
        :nodes="files"
        :selected-path="selectedPath"
        @select="emit('selectFile', $event)"
      />
      <Box v-else-if="activity === 'files'" class="empty">
        {{ loading ? '读取文件…' : '工作区为空' }}
      </Box>
      <Box v-else ref="slidesList" class="slides-list">
        <Button
          v-for="slide in slides"
          :key="slide.page"
          variant="quiet"
          type="button"
          class="slide-item"
          :class="{ active: selectedPage === slide.page }"
          :aria-current="selectedPage === slide.page ? 'page' : undefined"
          @click="emit('selectPage', slide.page)"
          @contextmenu.prevent="openMenu($event, slide.page)"
        >
          <Text class="slide-index">{{ slide.page }}</Text>
          <Text>
            <Text as="strong">{{ slide.title }}</Text
            ><Text as="small">{{ slide.layout }}</Text>
          </Text>
        </Button>
        <Box v-if="!slides.length" class="empty">请选择 Slidev Markdown</Box>
      </Box>
    </Panel>
    <Box
      v-if="menu"
      class="page-context-menu"
      role="menu"
      aria-label="页面操作"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
    >
      <Button
        variant="quiet"
        role="menuitem"
        @click="editPage()"
      >
        修改第 {{ menu.page }} 页
      </Button>
      <Button
        variant="quiet"
        role="menuitem"
        @click="editPage(true)"
      >
        使用版式 / 逻辑图重做
      </Button>
    </Box>
  </Aside>
</template>

<style scoped>
.page-context-menu {
  position: fixed;
  z-index: 100;
  width: 205px;
  padding: 5px;
  background: var(--color-panel-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: 9px;
  box-shadow: var(--shadow-popover);
}
.page-context-menu button {
  display: block;
  width: 100%;
  text-align: left;
}
.editor-navigation.embedded {
  border-right: 0;
}
.editor-navigation {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  overflow: hidden;
  border-right: 1px solid var(--color-border);
}
.navigation-pane {
  min-width: 0;
  overflow: auto;
}
.navigation-pane > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 10px;
  color: var(--color-muted);
  font-size: 11px;
  letter-spacing: 0.08em;
}
.slides-list {
  display: grid;
  padding: 3px 0;
}
.slide-item {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 6px;
  align-items: start;
  text-align: left;
}
.slide-index {
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}
.slide-item span:last-child {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.slide-item strong {
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slide-item small,
.empty {
  color: var(--color-muted);
  font-size: 10px;
}
.empty {
  padding: 12px;
}
</style>
