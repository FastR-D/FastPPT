<script setup lang="ts">
import { computed, shallowRef } from 'vue'

import AppSelect, { type SelectOption } from '../AppSelect.vue'
import FileTree from '../files/FileTree.vue'

import type {
  FileNode,
  ServerEvent,
  SessionSummary,
  WorkspaceInfo,
  HarnessKind,
  SkillInstallStatus,
  McpConfigStatus,
} from '@fastppt/protocol'
import type { DeepReadonly } from 'vue'

const props = defineProps<{
  mode: 'chat' | 'files'
  workspace: WorkspaceInfo | undefined
  workspaceLoading: boolean
  workspaceError: string | undefined
  files: readonly FileNode[]
  filesLoading: boolean
  selectedPath: string | undefined
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  latestEvent: ServerEvent | undefined
  sessions: readonly DeepReadonly<SessionSummary>[]
  selectedSessionId: string | undefined
  sessionsLoading: boolean
  sessionsLoadingMore: boolean
  hasMoreSessions: boolean
  canForkSession: boolean
  harnessLabel: string
  selectedHarness: HarnessKind
  skillStatuses: readonly SkillInstallStatus[]
  mcpStatus: McpConfigStatus | undefined
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

function requestSessionAlias(): void {
  const current = props.sessions.find(
    (session) => session.id === props.selectedSessionId,
  )
  if (!current) return
  const alias = window
    .prompt('输入会话别名', current.title ?? current.preview)
    ?.trim()
  if (alias) emit('renameSession', alias)
}

const emit = defineEmits<{
  retryWorkspace: []
  retryFiles: []
  selectFile: [path: string]
  selectSession: [sessionId: string]
  createSession: []
  renameSession: [alias: string]
  forkSession: []
  retrySessions: []
  loadMoreSessions: []
  selectHarness: [harness: HarnessKind]
}>()

const harnessOptions: readonly SelectOption[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
]
</script>

<template>
  <aside class="sidebar panel-surface">
    <section v-if="mode === 'chat'" class="sessions-panel">
      <div class="files-heading">
        <label class="harness-picker">
          <span>{{ harnessLabel }}</span>
          <AppSelect
            id="fastppt-harness"
            :value="selectedHarness"
            :options="harnessOptions"
            size="sm"
            aria-label="Agent harness"
            @change="
              (harness: string) =>
                $emit('selectHarness', harness as HarnessKind)
            "
          />
        </label>
        <div class="session-actions">
          <button
            type="button"
            aria-label="刷新会话"
            title="刷新会话"
            @click="$emit('retrySessions')"
          >
            ↻
          </button>
          <button
            type="button"
            aria-label="重命名当前会话"
            title="重命名当前会话"
            :disabled="!selectedSessionId"
            @click="requestSessionAlias"
          >
            ✎
          </button>
          <button
            type="button"
            aria-label="分叉当前会话"
            title="分叉当前会话"
            :disabled="!selectedSessionId || !canForkSession"
            @click="$emit('forkSession')"
          >
            ⑂
          </button>
          <button
            type="button"
            aria-label="新建会话"
            title="新建会话"
            @click="$emit('createSession')"
          >
            ＋
          </button>
        </div>
      </div>
      <div class="session-list">
        <input
          v-model="sessionQuery"
          class="session-search"
          type="search"
          placeholder="搜索会话…"
          aria-label="搜索会话"
        />
        <div class="managed-status">
          <div
            v-for="skill in skillStatuses"
            :key="skill.skillId"
            class="managed-row"
            :title="skill.targetPath"
          >
            <span>{{ skill.skillId }}</span>
            <small :class="`managed-${skill.state}`">
              {{ skill.expectedVersion }} · {{ skill.state }}
            </small>
          </div>
          <div v-if="mcpStatus" class="managed-row">
            <span>fastppt MCP</span>
            <small :class="`managed-${mcpStatus.state}`">
              {{ mcpStatus.state }}
            </small>
          </div>
        </div>
        <button
          v-for="session in filteredSessions"
          :key="session.id"
          class="session-item"
          :class="{ 'session-item-active': session.id === selectedSessionId }"
          type="button"
          @click="$emit('selectSession', session.id)"
        >
          <span>{{
            (session.title ?? session.preview) || `${selectedHarness} session`
          }}</span>
          <small>
            {{ session.status }} ·
            {{ new Date(session.updatedAt).toLocaleString() }}
          </small>
          <small class="session-cwd" :title="session.cwd">{{
            session.cwd
          }}</small>
        </button>
        <div v-if="!filteredSessions.length" class="files-empty">
          {{
            sessionsLoading
              ? '读取会话…'
              : sessionQuery
                ? '没有匹配的会话'
                : `尚无 ${selectedHarness} 会话`
          }}
        </div>
        <button
          v-if="hasMoreSessions && !sessionQuery"
          class="load-more-sessions"
          type="button"
          :disabled="sessionsLoading || sessionsLoadingMore"
          @click="$emit('loadMoreSessions')"
        >
          {{ sessionsLoadingMore ? '加载中…' : '加载更多会话' }}
        </button>
      </div>
    </section>
    <section v-else class="files-panel">
      <div class="files-heading">
        <span class="explorer-title">Explorer</span>
        <button
          type="button"
          aria-label="刷新工作区文件"
          :disabled="filesLoading"
          @click="$emit('retryFiles')"
        >
          ↻
        </button>
      </div>
      <div class="explorer-workspace" :title="workspace?.root">
        <span aria-hidden="true">▾</span>
        <strong>{{ workspace?.name ?? 'Workspace' }}</strong>
      </div>
      <FileTree
        v-if="files.length"
        :nodes="files"
        :selected-path="selectedPath"
        @select="$emit('selectFile', $event)"
      />
      <div v-else class="files-empty">
        {{ filesLoading ? '读取文件…' : '工作区为空' }}
      </div>
      <div v-if="latestEvent" class="file-event" :title="latestEvent.type">
        {{ latestEvent.type }} · {{ latestEvent.sequence }}
      </div>
    </section>
  </aside>
</template>

<style scoped>
.sidebar {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  overflow: hidden;
  padding: 12px;
}
.sidebar-header,
.workspace-title,
.nav-item,
.files-heading {
  display: flex;
  align-items: center;
}
.sidebar-header {
  gap: 11px;
}
.brand-mark {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  background: var(--color-accent);
  color: #071612;
  font-weight: 800;
}
.brand-copy {
  display: grid;
  gap: 1px;
}
.brand-copy span,
.muted,
.files-empty {
  color: var(--color-muted);
  font-size: 12px;
}
.workspace-card {
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-panel-raised);
}
.eyebrow {
  margin-bottom: 9px;
  color: var(--color-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.workspace-title {
  gap: 8px;
  font-weight: 650;
}
.workspace-path {
  margin-top: 7px;
  overflow: hidden;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.error-block {
  display: grid;
  gap: 9px;
  color: var(--color-danger);
  font-size: 12px;
}
.error-block button {
  width: fit-content;
  color: var(--color-text);
}
.sidebar-nav {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  border-bottom: 1px solid var(--color-border);
}
.nav-item {
  justify-content: space-between;
  min-width: 0;
  padding: 8px 10px 9px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--color-muted);
  text-align: left;
}
.nav-item-active {
  border-bottom-color: var(--color-accent);
  background: transparent;
  color: var(--color-text);
}
.nav-count,
.connection-state,
.file-event {
  font-family: var(--font-mono);
  font-size: 9px;
}
.connection-state {
  color: #fcd34d;
}
.connection-connected {
  color: var(--color-accent);
}
.files-panel {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  min-height: 0;
  margin: -12px;
  overflow: hidden;
}
.sessions-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}
.session-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
}
.session-actions button {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  padding: 0;
  place-items: center;
}
.sessions-panel > .files-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.harness-picker {
  display: grid;
  min-width: 0;
  gap: 6px;
}
.harness-picker > span {
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-list {
  min-height: 0;
  overflow: auto;
}
.session-search {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  outline: none;
  background: var(--color-panel-raised);
  color: var(--color-text);
  font-size: 11px;
}
.session-search:focus {
  border-color: var(--color-accent);
}
.load-more-sessions {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-muted);
}
.session-cwd {
  overflow: hidden;
  color: var(--color-muted);
  font-family: var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.managed-status {
  display: grid;
  gap: 4px;
  padding: 6px 7px 9px;
  border-bottom: 1px solid var(--color-border);
}
.managed-row {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.managed-row span,
.managed-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.managed-row span {
  color: var(--color-text);
  font-size: 10px;
}
.managed-row small {
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 8px;
}
.managed-installed,
.managed-pending-trust,
.managed-configured {
  color: var(--color-accent) !important;
}
.managed-conflict,
.managed-missing,
.managed-update-available {
  color: #fcd34d !important;
}
.session-item {
  display: grid;
  width: 100%;
  gap: 3px;
  padding: 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-muted);
  text-align: left;
}
.session-item span {
  overflow: hidden;
  color: var(--color-text);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-item small {
  font-family: var(--font-mono);
  font-size: 9px;
}
.session-item-active {
  background: var(--color-panel-raised);
}
.files-heading {
  justify-content: space-between;
  padding: 0 7px 7px;
  color: var(--color-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.files-panel .files-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel-raised);
  letter-spacing: 0;
}
.explorer-title {
  color: var(--color-text);
}
.explorer-workspace {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 22px;
  gap: 4px;
  padding: 0 8px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
  font-size: 10px;
  text-transform: uppercase;
}
.explorer-workspace strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.files-heading button {
  color: var(--color-muted);
}
.files-empty {
  padding: 12px 8px;
}
.file-event {
  overflow: hidden;
  padding: 6px 7px 0;
  color: var(--color-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
