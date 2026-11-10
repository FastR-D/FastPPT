<script setup lang="ts">
import {
  Box,
  Button,
  Modal,
  Footer,
  Header,
  Text,
  TextField,
} from '@fastrd/ui-vue'
import { computed, shallowRef, watch } from 'vue'
import { Icon as AppIcon } from '../ui/index.js'
import {
  workspaceCommands,
  type WorkspaceCommand,
} from '../../workspace/navigation.js'

const props = defineProps<{ open: boolean; previewReady: boolean }>()
const emit = defineEmits<{ close: []; run: [command: WorkspaceCommand] }>()
const surface = shallowRef<HTMLDivElement>()
const input = shallowRef<HTMLInputElement>()
const query = shallowRef('')
const activeIndex = shallowRef(0)
const filtered = computed(() => {
  const search = query.value.trim().toLocaleLowerCase()
  return workspaceCommands.filter((command) =>
    `${command.label} ${command.group} ${command.keywords}`
      .toLocaleLowerCase()
      .includes(search),
  )
})
watch(query, () => {
  activeIndex.value = 0
})
watch(
  () => props.open,
  (open) => {
    if (open) {
      query.value = ''
      activeIndex.value = 0
    }
  },
  { immediate: true },
)
function run(index: number): void {
  const command = filtered.value[index]
  if (!command || (command.requiresPreview && !props.previewReady)) return
  emit('run', command.id)
}
function navigate(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'Enter' && event.target === input.value) {
    event.preventDefault()
    run(activeIndex.value)
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  if (!filtered.value.length) return
  activeIndex.value =
    (activeIndex.value +
      (event.key === 'ArrowDown' ? 1 : -1) +
      filtered.value.length) %
    filtered.value.length
  surface.value
    ?.querySelectorAll('button[data-command]')
    ?.item(activeIndex.value)
    ?.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
  <Modal
    :open="open"
    class="command-palette"
    label="命令面板"
    @close="emit('close')"
  >
    <Box ref="surface" class="command-surface" @keydown="navigate">
      <Header>
        <AppIcon name="search" /><TextField
          ref="input"
          v-model="query"
          autofocus
          aria-label="搜索命令"
          placeholder="搜索功能或运行命令…"
          autocomplete="off"
        /><Button
          variant="icon"
          type="button"
          aria-label="关闭"
          title="关闭 · Esc"
          @click="emit('close')"
        >
          <Text as="kbd">Esc</Text>
        </Button>
      </Header>
      <Box class="command-list">
        <Button
          v-for="(command, index) in filtered"
          :key="command.id"
          variant="quiet"
          type="button"
          data-command
          :class="{ active: index === activeIndex }"
          :disabled="command.requiresPreview && !previewReady"
          @pointermove="activeIndex = index"
          @click="run(index)"
        >
          <Text>{{ command.label }}</Text
          ><Text as="small">
            {{
              command.requiresPreview && !previewReady
                ? '预览就绪后可用'
                : command.group
            }}
          </Text>
        </Button>
        <Text v-if="!filtered.length" as="p">没有匹配的命令</Text>
      </Box>
      <Footer>
        <Text>↑ ↓ 选择 · Enter 运行</Text
        ><Text>{{ filtered.length }} 个命令</Text>
      </Footer>
    </Box>
  </Modal>
</template>

<style scoped>
.command-palette {
  width: min(540px, calc(100vw - 32px));
  max-height: 80dvh;
  padding: 0;
  margin: 12dvh auto auto;
}
.command-surface {
  display: flex;
  flex-direction: column;
  max-height: 75dvh;
}
header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-muted);
}
input {
  flex: 1;
  min-width: 0;
}
kbd {
  font: 11px var(--font-mono);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 2px 4px;
}
.command-list {
  display: grid;
  overflow: auto;
  padding: 6px;
}
.command-list button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 38px;
  text-align: left;
}
small {
  color: var(--color-muted);
  font-size: 11px;
}
p {
  padding: 24px;
  text-align: center;
  color: var(--color-muted);
  font-size: 13px;
}
footer {
  display: flex;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border);
  color: var(--color-muted);
  font-size: 11px;
}
</style>
