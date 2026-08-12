<script setup lang="ts">
import { computed, shallowRef } from 'vue'

import type { FileNode } from '@fastppt/protocol'

defineOptions({ name: 'FileTreeNode' })

const props = defineProps<{
  node: FileNode
  selectedPath: string | undefined
  depth: number
}>()

const emit = defineEmits<{ select: [path: string] }>()
const expanded = shallowRef(props.depth < 1)
const isDirectory = computed(() => props.node.type === 'directory')
const fileIcon = computed(() => {
  if (isDirectory.value) return expanded.value ? '▾' : '▸'
  const extension = props.node.name.split('.').pop()?.toLowerCase()
  if (extension === 'md' || extension === 'mdx') return 'M↓'
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(extension ?? ''))
    return '▧'
  if (extension === 'json') return '{}'
  if (extension === 'css') return '#'
  return '·'
})

function activate(): void {
  if (isDirectory.value) {
    expanded.value = !expanded.value
  } else {
    emit('select', props.node.path)
  }
}
</script>

<template>
  <div class="tree-node">
    <button
      class="tree-row"
      :class="{ 'tree-row-selected': node.path === selectedPath }"
      :style="{ paddingLeft: `${8 + depth * 13}px` }"
      type="button"
      @click="activate"
    >
      <span class="tree-icon" :class="{ 'tree-icon-file': !isDirectory }">
        {{ fileIcon }}
      </span>
      <span class="tree-name">{{ node.name }}</span>
    </button>
    <div v-if="isDirectory && expanded" class="tree-children">
      <FileTreeNode
        v-for="child in node.children ?? []"
        :key="child.path"
        :node="child"
        :selected-path="selectedPath"
        :depth="depth + 1"
        @select="$emit('select', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: 24px;
  gap: 5px;
  padding-top: 0;
  padding-right: 8px;
  padding-bottom: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--color-muted);
  font-size: 11px;
  text-align: left;
}

.tree-row:hover,
.tree-row-selected {
  background: rgb(255 255 255 / 6%);
  color: var(--color-text);
}
.tree-row-selected {
  background: color-mix(in srgb, var(--color-accent) 18%, transparent);
}

.tree-icon {
  width: 14px;
  flex: 0 0 auto;
  color: var(--color-accent);
  font-family: var(--font-mono);
}
.tree-icon-file {
  color: #79a9d1;
  font-size: 8px;
  font-weight: 700;
}
.tree-children {
  border-left: 1px solid rgb(255 255 255 / 7%);
  margin-left: 14px;
}

.tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
