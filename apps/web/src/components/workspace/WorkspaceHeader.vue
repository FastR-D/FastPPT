<script setup lang="ts">
import { useColorMode, Box, BrandMark, Button, Header, Text } from '@fastppt/components'
import { Icon as AppIcon } from '@fastppt/components'
import {
  workspaceModeLabels,
  type WorkspaceMode,
  type WorkspaceCommand,
} from '../../workspace/navigation.js'

defineProps<{ workspace: string; mode: WorkspaceMode }>()
const emit = defineEmits<{
  command: [command: WorkspaceCommand]
  search: []
  toggleSidebar: []
}>()
const { isDark, toggle: toggleColorMode } = useColorMode()
</script>

<template>
  <Header class="app-header">
    <Box class="brand-block">
      <BrandMark class="brand-mark" /><Text as="strong">FastPPT</Text>
    </Box>
    <Box class="workspace-breadcrumb">
      <Text :title="workspace">{{ workspace }}</Text
      ><AppIcon name="chevron" /><Text>{{ workspaceModeLabels[mode] }}</Text>
    </Box>
    <Button
      variant="quiet"
      class="command-trigger"
      type="button"
      aria-label="打开命令面板"
      title="命令面板 · Ctrl / ⌘ Shift P"
      @click="emit('search')"
    >
      <AppIcon name="search" /><Text>搜索功能或运行命令</Text
      ><Text as="kbd">⌘ / Ctrl ⇧ P</Text>
    </Button>
    <Box class="header-actions">
      <Button
        variant="icon"
        type="button"
        :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
        :title="isDark ? '浅色模式' : '深色模式'"
        :aria-pressed="isDark"
        @click="toggleColorMode"
      >
        <AppIcon :name="isDark ? 'sun' : 'moon'" />
      </Button>
      <Button
        variant="icon"
        class="sidebar-toggle icon-button"
        type="button"
        aria-label="切换导航面板"
        title="切换导航面板"
        @click="emit('toggleSidebar')"
      >
        <AppIcon name="panel" />
      </Button>
      <Box class="deck-actions" role="group" aria-label="演示文稿操作">
        <Button
          variant="secondary"
          type="button"
          title="导入主题"
          :aria-pressed="mode === 'import'"
          @click="emit('command', 'import')"
        >
          <AppIcon name="import" /><Text>导入</Text>
        </Button>
        <Button
          variant="primary"
          class="new-deck"
          type="button"
          title="新建演示文稿 · Ctrl / ⌘ K"
          @click="emit('command', 'wizard')"
        >
          <AppIcon name="plus" /><Text>新建</Text>
        </Button>
      </Box>
    </Box>
  </Header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
  padding: 0 14px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel);
}
.brand-block {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  color: var(--color-brand);
  font-size: 14px;
}
.workspace-breadcrumb {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  max-width: 30%;
  color: var(--color-muted);
  font-size: 12px;
}
.workspace-breadcrumb span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-breadcrumb span:last-child {
  flex-shrink: 0;
  color: var(--color-secondary);
}
.workspace-breadcrumb :deep(svg) {
  width: 12px;
  height: 12px;
}
.command-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(360px, 30vw);
  min-width: 0;
  min-height: 28px;
  margin-left: auto;
  text-align: left;
}
.command-trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.command-trigger :deep(svg) {
  width: 14px;
  height: 14px;
}
kbd {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.new-deck {
  display: flex;
  align-items: center;
  gap: 4px;
}
.deck-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
@media (max-width: 960px) {
  .workspace-breadcrumb {
    max-width: 24%;
  }
  .command-trigger kbd {
    display: none;
  }
  .app-header {
    gap: 12px;
  }
}
@media (max-width: 600px) {
  .app-header {
    padding: 0 10px;
    gap: 10px;
  }
  .workspace-breadcrumb {
    display: none;
  }
  .command-trigger {
    margin-left: auto;
    width: 30px;
    min-width: 30px;
    justify-content: center;
  }
  .command-trigger span {
    display: none;
  }
  .header-actions {
    gap: 5px;
  }
}
@media (max-width: 380px) {
  .brand-block { gap: 0; }
  .brand-block strong {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
