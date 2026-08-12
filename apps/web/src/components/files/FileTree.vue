<script setup lang="ts">
import FileTreeNode from './FileTreeNode.vue'

import type { FileNode } from '@fastppt/protocol'

defineProps<{
  nodes: readonly FileNode[]
  selectedPath: string | undefined
}>()

defineEmits<{ select: [path: string] }>()
</script>

<template>
  <div class="file-tree">
    <FileTreeNode
      v-for="node in nodes"
      :key="node.path"
      :node="node"
      :selected-path="selectedPath"
      :depth="0"
      @select="$emit('select', $event)"
    />
  </div>
</template>

<style scoped>
.file-tree {
  display: grid;
  align-content: start;
  min-height: 0;
  padding: 4px 0;
  overflow: auto;
}
</style>
