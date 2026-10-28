<script setup lang="ts">
import { Button, Nav, Text } from '@fastppt/components'
import { Icon as AppIcon } from '@fastppt/components'
import { computed } from 'vue'
import {
  primaryView,
  workspaceViews,
  type WorkspaceMode,
} from '../../workspace/navigation.js'

const props = defineProps<{ mode: WorkspaceMode }>()
const emit = defineEmits<{ select: [mode: WorkspaceMode] }>()
const focusIndex = computed(() => Math.max(0, workspaceViews.findIndex(view => view.id === primaryView(props.mode))))

function navigate(event: KeyboardEvent, index: number): void {
  const direction = ['ArrowRight', 'ArrowDown'].includes(event.key)
    ? 1
    : ['ArrowLeft', 'ArrowUp'].includes(event.key)
      ? -1
      : 0
  if (!direction && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? workspaceViews.length - 1
        : (index + direction + workspaceViews.length) % workspaceViews.length
  emit('select', workspaceViews[next]!.id)
  ;(event.currentTarget as HTMLElement).parentElement
    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    ?.item(next)
    ?.focus()
}
</script>

<template>
  <Nav
    class="workspace-activity"
    role="tablist"
    aria-label="FastPPT 工作区模式"
    aria-orientation="vertical"
  >
    <Button
      v-for="(view, index) in workspaceViews"
      :key="view.id"
      variant="navigation"
      type="button"
      role="tab"
      :aria-selected="primaryView(mode) === view.id"
      :tabindex="focusIndex === index ? 0 : -1"
      :title="`${view.label} · ${view.shortcut}`"
      @click="emit('select', view.id)"
      @keydown="navigate($event, index)"
    >
      <AppIcon :name="view.icon" />
      <Text>{{ view.label }}</Text>
    </Button>
  </Nav>
</template>

<style scoped>
.workspace-activity {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 8px 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-panel-raised);
}
button {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 62px;
}
button :deep(svg) {
  width: 21px;
  height: 21px;
}
@media (max-width: 600px) {
  .workspace-activity {
    overflow-y: hidden;
    flex-direction: row;
    padding: 0;
    gap: 0;
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }
  button {
    flex: 1;
    min-width: 0;
    min-height: 50px;
    padding: 5px 2px;
    gap: 3px;
    font-size: 11px;
    line-height: 1.2;
  }
  button :deep(svg) {
    width: 16px;
    height: 16px;
  }
}
</style>
