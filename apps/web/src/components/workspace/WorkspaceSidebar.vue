<script setup lang="ts">
import {
  Aside,
  Box,
  Button,
  Form,
  Panel,
  Text,
  TextField,
} from '@fastrd/ui-vue'
import { computed, nextTick, shallowRef } from 'vue'

import { Select as AppSelect, type SelectItem } from '@fastrd/ui-vue'
import EditorNavigation from './EditorNavigation.vue'
import { Icon as AppIcon } from '../ui/index.js'

import type { SessionSummary, HarnessKind } from '@fastppt/protocol'
import type { DeepReadonly } from 'vue'

const props = defineProps<{
  markdown?: string
  deckPath?: string | undefined
  selectedPage?: number
  sessions: readonly DeepReadonly<SessionSummary>[]
  selectedSessionId: string | undefined
  sessionsLoading: boolean
  sessionsLoadingMore: boolean
  hasMoreSessions: boolean
  canForkSession: boolean
  harnessLabel: string
  selectedHarness: HarnessKind
}>()

const sessionQuery = shallowRef('')
const filteredSessions = computed(() => {
  const query = sessionQuery.value.trim().toLocaleLowerCase()
  if (!query) return props.sessions
  return props.sessions.filter((session) =>
    [session.title, session.preview, session.cwd, session.status]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.toLocaleLowerCase().includes(query)),
  )
})

const renaming = shallowRef(false)
const sessionAlias = shallowRef('')
const aliasInput = shallowRef<HTMLInputElement>()
async function requestSessionAlias(): Promise<void> {
  const current = props.sessions.find(
    (session) => session.id === props.selectedSessionId,
  )
  if (!current) return
  sessionAlias.value = current.title ?? current.preview
  renaming.value = true
  await nextTick()
  aliasInput.value?.focus()
  aliasInput.value?.select()
}
function rename(): void {
  if (sessionAlias.value.trim())
    emit('renameSession', sessionAlias.value.trim())
  renaming.value = false
}
const statusLabels: Record<string, string> = {
  idle: '就绪',
  running: '运行中',
  'waiting-approval': '等待确认',
  failed: '失败',
}
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const emit = defineEmits<{
  selectPage: [page: number]
  editPage: [page: number]
  remakePage: [page: number]
  selectSession: [sessionId: string]
  createSession: []
  renameSession: [alias: string]
  forkSession: []
  retrySessions: []
  loadMoreSessions: []
  selectHarness: [harness: HarnessKind]
}>()

const harnessOptions: readonly SelectItem[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
]
</script>

<template>
  <Aside
    class="sidebar panel-surface"
    :class="{ 'with-pages': Boolean(markdown) }"
    aria-label="会话导航"
  >
    <Panel class="sessions-panel">
      <Box class="files-heading">
        <Text>
          会话 <Text as="small">{{ sessions.length }}</Text>
        </Text>
        <Box class="session-actions">
          <Button
            variant="icon"
            type="button"
            class="icon-button"
            aria-label="刷新会话"
            title="刷新会话"
            :disabled="sessionsLoading"
            @click="emit('retrySessions')"
          >
            <AppIcon name="refresh" />
          </Button>
          <Button
            variant="icon"
            type="button"
            class="icon-button"
            aria-label="重命名当前会话"
            title="重命名当前会话"
            :disabled="!selectedSessionId"
            @click="requestSessionAlias"
          >
            <AppIcon name="edit" />
          </Button>
          <Button
            variant="icon"
            type="button"
            class="icon-button"
            aria-label="分叉当前会话"
            title="分叉当前会话"
            :disabled="!selectedSessionId || !canForkSession"
            @click="emit('forkSession')"
          >
            <AppIcon name="branch" />
          </Button>
          <Button
            variant="icon"
            type="button"
            class="icon-button"
            aria-label="新建会话"
            title="新建会话"
            @click="emit('createSession')"
          >
            <AppIcon name="plus" />
          </Button>
        </Box>
      </Box>
      <Box class="session-filters">
        <Box class="harness-picker">
          <AppSelect
            id="fastppt-harness"
            :value="selectedHarness"
            :options="harnessOptions"
            size="sm"
            aria-label="Agent harness"
            @change="emit('selectHarness', $event as HarnessKind)"
          /><Text :title="harnessLabel">
            {{ selectedHarness === 'claude' ? 'Claude Code' : 'OpenAI Codex' }}
          </Text>
        </Box>
        <TextField
          v-model="sessionQuery"
          class="session-search"
          type="search"
          placeholder="搜索会话…"
          aria-label="搜索会话"
        />
        <Form v-if="renaming" class="rename-session" @submit.prevent="rename">
          <TextField
            ref="aliasInput"
            v-model="sessionAlias"
            aria-label="会话别名"
            @keydown.esc="renaming = false"
          /><Button variant="quiet" type="submit">保存</Button
          ><Button
            variant="quiet"
            type="button"
            aria-label="取消重命名"
            @click="renaming = false"
          >
            ×
          </Button>
        </Form>
      </Box>
      <Box class="session-list" :aria-busy="sessionsLoading">
        <Button
          v-for="session in filteredSessions"
          :key="session.id"
          variant="quiet"
          class="session-item"
          :class="{ 'session-item-active': session.id === selectedSessionId }"
          :aria-pressed="session.id === selectedSessionId"
          :title="session.cwd"
          type="button"
          @click="emit('selectSession', session.id)"
        >
          <Text>{{ (session.title ?? session.preview) || '未命名会话' }}</Text>
          <Text as="small">
            <Text>{{ statusLabels[session.status] ?? session.status }}</Text
            ><Text as="time">
              {{ dateFormat.format(new Date(session.updatedAt)) }}
            </Text>
          </Text>
        </Button>
        <Box v-if="!filteredSessions.length" class="files-empty">
          {{
            sessionsLoading
              ? '读取会话…'
              : sessionQuery
                ? '没有匹配的会话'
                : '暂无会话，点击 + 开始创建'
          }}
        </Box>
        <Button
          v-if="hasMoreSessions && !sessionQuery"
          variant="quiet"
          class="load-more-sessions"
          type="button"
          :disabled="sessionsLoading || sessionsLoadingMore"
          @click="emit('loadMoreSessions')"
        >
          {{ sessionsLoadingMore ? '加载中…' : '加载更多会话' }}
        </Button>
      </Box>
    </Panel>
    <EditorNavigation
      v-if="markdown"
      class="current-deck-pages"
      embedded
      activity="slidev"
      :files="[]"
      :selected-path="deckPath"
      :markdown="markdown"
      :selected-page="selectedPage ?? 1"
      :loading="false"
      @select-page="emit('selectPage', $event)"
      @edit-page="emit('editPage', $event)"
      @remake-page="emit('remakePage', $event)"
    />
  </Aside>
</template>

<style scoped>
.sidebar {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  overflow: hidden;
  background: var(--color-panel-raised);
}
.sidebar.with-pages {
  grid-template-rows: minmax(160px, 1fr) minmax(140px, 38%);
}
.sessions-panel {
  display: grid;
  grid-template-rows: 36px auto minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}
.files-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-secondary);
  font-size: 12px;
  font-weight: 600;
}
.files-heading small {
  margin-left: 5px;
  color: var(--color-muted);
  font-size: 10px;
  font-weight: 400;
}
.session-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 0;
}
.session-actions button {
  width: 25px;
  height: 25px;
}
.session-actions :deep(svg) {
  width: 14px;
  height: 14px;
}
.session-filters {
  display: grid;
  gap: 8px;
  padding: 10px;
}
.harness-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.harness-picker > span {
  overflow: hidden;
  color: var(--color-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-search,
.rename-session input {
  width: 100%;
  min-width: 0;
  min-height: 30px;
}
.rename-session {
  display: flex;
  gap: 4px;
}
.rename-session button {
  flex-shrink: 0;
}
.session-list {
  min-height: 0;
  overflow: auto;
  padding: 0 6px 6px;
}
.session-item {
  justify-content: stretch;
  justify-items: stretch;
  display: grid;
  gap: 5px;
  width: 100%;
  margin-bottom: 2px;
  text-align: left;
}
.session-item > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.session-item small {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--color-muted);
  font-size: 10px;
}
.session-item-active {
  background: var(--color-selected);
  border-color: color-mix(in srgb, var(--color-accent) 18%, transparent);
}
.session-item-active > span {
  color: var(--color-accent-strong);
}
.load-more-sessions {
  width: 100%;
}
.files-empty {
  padding: 16px 8px;
  color: var(--color-muted);
  font-size: 12px;
}
.current-deck-pages {
  min-height: 0;
  border-top: 1px solid var(--color-border);
}
@media (max-width: 600px) {
  .sidebar.with-pages {
    grid-template-rows: minmax(0, 1fr);
  }
  .current-deck-pages {
    display: none;
  }
  .session-filters {
    grid-template-columns: auto minmax(0, 1fr);
    padding: 6px 10px;
    gap: 8px;
  }
  .harness-picker > span {
    display: none;
  }
}
</style>
