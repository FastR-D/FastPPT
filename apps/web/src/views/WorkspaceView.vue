<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from 'vue'

import AgentWorkspace from '../components/workspace/AgentWorkspace.vue'
import PreviewPanel from '../components/workspace/PreviewPanel.vue'
import ThemeCatalog from '../components/themes/ThemeCatalog.vue'
import WorkspaceSidebar from '../components/workspace/WorkspaceSidebar.vue'
import { useFilesStore } from '../stores/files.js'
import { usePreviewStore } from '../stores/preview.js'
import { useSessionsStore } from '../stores/sessions.js'
import { useWorkspaceStore } from '../stores/workspace.js'

const workspaceStore = useWorkspaceStore()
const filesStore = useFilesStore()
const previewStore = usePreviewStore()
const sessionsStore = useSessionsStore()
const controller = new AbortController()
const shell = shallowRef<HTMLElement>()
const workspaceMode = shallowRef<'chat' | 'files' | 'themes'>('chat')
const compactPanel = shallowRef<'workbench' | 'preview'>('workbench')

const LAYOUT_STORAGE_KEY = 'fastppt.workspace-layout.v1'
const MIN_SIDEBAR_WIDTH = 240
const MIN_AGENT_WIDTH = 380
const MIN_PREVIEW_WIDTH = 380
const HANDLE_WIDTH = 6

interface WorkspaceLayout {
  sidebar: number
  preview: number
}

const layout = shallowRef<WorkspaceLayout>({ sidebar: 300, preview: 560 })
const gridTemplateColumns = computed(
  () =>
    `${layout.value.sidebar}px ${HANDLE_WIDTH}px minmax(${MIN_AGENT_WIDTH}px, 1fr) ${HANDLE_WIDTH}px ${layout.value.preview}px`,
)
const workspaceLabel = computed(
  () =>
    workspaceStore.workspace?.name ??
    (workspaceStore.loading ? '连接中…' : '未连接'),
)
const sendDisabledReason = computed(() => {
  const theme = previewStore.selectedTheme
  if (!theme) return '当前没有可用的已注册主题'
  const requiredSkills = sessionsStore.selectedSkillStatuses.filter(
    (status) => status.kind === 'base' || status.themeId === theme.themeId,
  )
  const unavailable = requiredSkills.find(
    (status) => status.state !== 'installed',
  )
  if (!unavailable) return undefined
  return `${unavailable.skillId} ${unavailable.state}${
    unavailable.message ? `：${unavailable.message}` : ''
  }`
})

function constrainLayout(): void {
  const width = shell.value?.clientWidth ?? window.innerWidth
  const available = width - HANDLE_WIDTH * 2 - MIN_AGENT_WIDTH
  const sidebar = Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(layout.value.sidebar, available - MIN_PREVIEW_WIDTH),
  )
  const preview = Math.max(
    MIN_PREVIEW_WIDTH,
    Math.min(layout.value.preview, available - sidebar),
  )
  layout.value = { sidebar, preview }
}

function restoreLayout(): void {
  try {
    const saved = JSON.parse(
      localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null',
    ) as Partial<WorkspaceLayout> | null
    if (
      saved &&
      typeof saved.sidebar === 'number' &&
      typeof saved.preview === 'number'
    )
      layout.value = { sidebar: saved.sidebar, preview: saved.preview }
  } catch {
    localStorage.removeItem(LAYOUT_STORAGE_KEY)
  }
  constrainLayout()
}

function persistLayout(): void {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout.value))
}

function selectWorkspaceMode(mode: 'chat' | 'files' | 'themes'): void {
  workspaceMode.value = mode
  compactPanel.value = 'workbench'
}

function startResize(panel: 'sidebar' | 'preview', event: PointerEvent): void {
  if (window.matchMedia('(max-width: 1100px)').matches) return
  const startX = event.clientX
  const initial = layout.value[panel]
  const move = (moveEvent: PointerEvent) => {
    const delta = moveEvent.clientX - startX
    layout.value = {
      ...layout.value,
      [panel]: initial + (panel === 'sidebar' ? delta : -delta),
    }
    constrainLayout()
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    document.body.classList.remove('resizing-workspace')
    persistLayout()
  }
  document.body.classList.add('resizing-workspace')
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop, { once: true })
}

function handleResizeKey(
  panel: 'sidebar' | 'preview',
  event: KeyboardEvent,
): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const direction = event.key === 'ArrowRight' ? 1 : -1
  const delta = (panel === 'sidebar' ? direction : -direction) * 16
  layout.value = { ...layout.value, [panel]: layout.value[panel] + delta }
  constrainLayout()
  persistLayout()
}

onMounted(() => {
  restoreLayout()
  window.addEventListener('resize', constrainLayout)
  void workspaceStore.load(controller.signal)
  void filesStore.start(controller.signal)
  void previewStore.load(controller.signal)
  void sessionsStore.load(controller.signal)
})
onUnmounted(() => {
  window.removeEventListener('resize', constrainLayout)
  controller.abort()
  workspaceStore.disconnect()
  filesStore.stop()
  previewStore.disconnect()
  sessionsStore.disconnect()
})

async function formatSelectedDeck(): Promise<void> {
  const selected = filesStore.selectedFile
  if (!selected) return
  const formatted = await previewStore.formatDeckFile(
    selected.path,
    selected.revision,
  )
  if (formatted) await filesStore.openFile(formatted.path)
}

async function sendMessage(): Promise<void> {
  if (sendDisabledReason.value) {
    sessionsStore.error = `发送已禁用：${sendDisabledReason.value}`
    return
  }
  await sessionsStore.send(previewStore.activeThemeId)
}
</script>

<template>
  <main
    ref="shell"
    class="workspace-page"
    :class="{ 'theme-mode': workspaceMode === 'themes' }"
    :style="{ gridTemplateColumns }"
  >
    <header class="app-header">
      <div class="brand-block">
        <div class="brand-mark">F</div>
        <div class="brand-copy">
          <strong>FastPPT</strong>
          <span class="workspace-identity">
            <i
              class="workspace-signal"
              :class="
                workspaceStore.workspace ? 'signal-online' : 'signal-offline'
              "
              aria-hidden="true"
            ></i>
            工作区：{{ workspaceLabel }}
          </span>
        </div>
      </div>
      <nav
        class="workspace-tabs"
        role="tablist"
        aria-label="FastPPT 工作区模式"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="workspaceMode === 'chat'"
          :class="{ active: workspaceMode === 'chat' }"
          @click="selectWorkspaceMode('chat')"
        >
          对话
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="workspaceMode === 'files'"
          :class="{ active: workspaceMode === 'files' }"
          @click="selectWorkspaceMode('files')"
        >
          文件
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="workspaceMode === 'themes'"
          :class="{ active: workspaceMode === 'themes' }"
          @click="selectWorkspaceMode('themes')"
        >
          主题
        </button>
      </nav>
      <div class="header-status" :title="workspaceStore.workspace?.root">
        {{ workspaceStore.workspace?.root ?? workspaceStore.error ?? '' }}
      </div>
    </header>
    <nav
      v-if="workspaceMode !== 'themes'"
      class="compact-navigation"
      aria-label="工作区面板"
    >
      <button
        type="button"
        :class="{ active: compactPanel === 'workbench' }"
        @click="compactPanel = 'workbench'"
      >
        {{ workspaceMode === 'chat' ? '对话工作区' : '文件工作区' }}
      </button>
      <button
        type="button"
        :class="{ active: compactPanel === 'preview' }"
        @click="compactPanel = 'preview'"
      >
        预览
      </button>
    </nav>
    <ThemeCatalog
      v-if="workspaceMode === 'themes'"
      class="theme-catalog-page"
      :themes="previewStore.themes"
      :loading="previewStore.loading"
      :error="previewStore.error"
    />
    <div
      v-else
      class="workbench"
      :class="{ 'compact-hidden': compactPanel !== 'workbench' }"
    >
      <WorkspaceSidebar
        class="workspace-sidebar"
        :mode="workspaceMode"
        :workspace="workspaceStore.workspace"
        :workspace-loading="workspaceStore.loading"
        :workspace-error="workspaceStore.error"
        :files="filesStore.files"
        :files-loading="filesStore.loading"
        :selected-path="filesStore.selectedFile?.path"
        :connection-status="filesStore.connectionStatus"
        :latest-event="filesStore.latestEvent"
        :sessions="sessionsStore.sessions"
        :selected-session-id="sessionsStore.selectedSessionId"
        :sessions-loading="sessionsStore.loading"
        :sessions-loading-more="sessionsStore.loadingMore"
        :has-more-sessions="sessionsStore.hasMoreSessions"
        :can-fork-session="
          sessionsStore.selectedHarnessStatus?.capabilities.sessionFork ?? false
        "
        :harness-label="
          sessionsStore.selectedHarnessStatus?.status === 'available'
            ? (sessionsStore.selectedHarnessStatus.version ?? 'ready')
            : 'unavailable'
        "
        :selected-harness="sessionsStore.selectedHarness"
        :skill-statuses="sessionsStore.selectedSkillStatuses"
        :mcp-status="sessionsStore.selectedMcpStatus"
        @retry-workspace="workspaceStore.load()"
        @retry-files="filesStore.loadTree()"
        @select-file="filesStore.openFile($event)"
        @select-session="sessionsStore.selectSession"
        @create-session="sessionsStore.createSession"
        @rename-session="sessionsStore.renameSelectedSession"
        @fork-session="sessionsStore.forkSelectedSession"
        @retry-sessions="sessionsStore.load()"
        @load-more-sessions="sessionsStore.loadMore()"
        @select-harness="sessionsStore.selectHarness"
      />
      <div
        class="workspace-resizer"
        role="separator"
        aria-label="调整导航区域宽度"
        aria-orientation="vertical"
        tabindex="0"
        @pointerdown="startResize('sidebar', $event)"
        @keydown="handleResizeKey('sidebar', $event)"
      ></div>
      <AgentWorkspace
        class="workspace-agent"
        :mode="workspaceMode"
        :workspace-name="workspaceStore.displayName"
        :selected-file="filesStore.selectedFile"
        :draft="filesStore.draft"
        :dirty="filesStore.dirty"
        :saving="filesStore.saving"
        :file-error="filesStore.error"
        :external-change="filesStore.externalChange"
        :session="sessionsStore.selectedSession"
        :messages="sessionsStore.messages"
        :agent-events="sessionsStore.events"
        :run-audit="sessionsStore.runAudit"
        :approvals="sessionsStore.approvals"
        :message-draft="sessionsStore.draft"
        :attachments="sessionsStore.attachments"
        :attaching="sessionsStore.attaching"
        :sending="sessionsStore.sending"
        :run-active="sessionsStore.activeRun"
        :harness="sessionsStore.selectedHarness"
        :harness-status="
          sessionsStore.selectedHarnessStatus?.status ?? 'unavailable'
        "
        :send-disabled-reason="sendDisabledReason"
        :agent-error="sessionsStore.error"
        @update-draft="filesStore.updateDraft"
        @save="filesStore.save"
        @format="formatSelectedDeck"
        @update-message-draft="sessionsStore.draft = $event"
        @attach="sessionsStore.addAttachment"
        @remove-attachment="sessionsStore.removeAttachment"
        @send="sendMessage"
        @cancel="sessionsStore.cancel"
        @resolve-approval="
          sessionsStore.resolveApproval($event.approvalId, $event.decision)
        "
      />
    </div>
    <div
      v-if="workspaceMode !== 'themes'"
      class="preview-resizer workspace-resizer"
      role="separator"
      aria-label="调整预览区域宽度"
      aria-orientation="vertical"
      tabindex="0"
      @pointerdown="startResize('preview', $event)"
      @keydown="handleResizeKey('preview', $event)"
    ></div>
    <PreviewPanel
      v-if="workspaceMode !== 'themes'"
      class="workspace-preview"
      :class="{ 'compact-hidden': compactPanel !== 'preview' }"
      :decks="previewStore.decks"
      :selected-deck-id="previewStore.selectedDeckId"
      :theme="previewStore.selectedTheme"
      :state="previewStore.state"
      :loading="previewStore.loading"
      :error="previewStore.error"
      :frame-revision="previewStore.frameRevision"
      :export-job="previewStore.exportJob"
      :inspection-job="previewStore.inspectionJob"
      @select-deck="previewStore.selectDeck"
      @start="previewStore.startPreview"
      @restart="previewStore.restartPreview"
      @stop="previewStore.stopPreview"
      @refresh="previewStore.refreshFrame"
      @export="previewStore.startExport"
      @snapshot="
        previewStore.submitExportSnapshot($event.exportId, $event.snapshot)
      "
      @capture-progress="
        previewStore.reportExportCaptureProgress(
          $event.exportId,
          $event.completed,
          $event.total,
        )
      "
      @inspection-result="
        previewStore.submitInspectionResult($event.inspectionId, $event.result)
      "
      @cancel-export="previewStore.cancelExport"
      @download-export="previewStore.downloadExport"
    />
  </main>
</template>

<style scoped>
.workspace-page {
  display: grid;
  grid-template-columns: 300px 6px minmax(380px, 1fr) 6px 560px;
  grid-template-rows: 58px minmax(0, 1fr);
  height: 100dvh;
  overflow: hidden;
  background: var(--color-canvas);
  color: var(--color-text);
}
.workspace-page.theme-mode {
  grid-template-columns: minmax(0, 1fr) !important;
}
.theme-mode .app-header {
  grid-column: 1;
}
.theme-catalog-page {
  grid-column: 1;
  grid-row: 2;
}
.app-header {
  display: flex;
  align-items: stretch;
  min-width: 0;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel);
  grid-column: 1 / 4;
  grid-row: 1;
}
.brand-block {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 10px;
  padding: 0 16px;
}
.brand-mark {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 9px;
  background: var(--color-accent);
  color: #071612;
  font-weight: 800;
}
.brand-copy {
  display: grid;
  gap: 2px;
}
.workspace-identity {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-muted);
  font-size: 10px;
}
.workspace-signal {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  box-shadow: 0 0 7px rgb(239 68 68 / 45%);
}
.signal-online {
  background: #34d399;
  box-shadow: 0 0 7px rgb(52 211 153 / 45%);
}
.workspace-tabs {
  display: flex;
  align-items: end;
  gap: 4px;
  padding-left: 8px;
}
.workspace-tabs button {
  height: 100%;
  padding: 0 18px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-muted);
}
.workspace-tabs button.active {
  border-bottom-color: var(--color-accent);
  color: var(--color-text);
}
.header-status {
  overflow: hidden;
  margin-left: auto;
  padding: 0 18px;
  align-self: center;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workbench {
  display: grid;
  grid-column: 1 / 4;
  grid-row: 2;
  grid-template-columns: subgrid;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.workbench > .workspace-sidebar {
  grid-column: 1;
}
.workbench > .workspace-resizer {
  grid-column: 2;
}
.workbench > .workspace-agent {
  grid-column: 3;
}
.compact-navigation {
  display: none;
}

.workspace-sidebar,
.workspace-agent,
.workspace-preview {
  min-height: 0;
  min-width: 0;
}
.preview-resizer {
  grid-column: 4;
  grid-row: 1 / 3;
}

.workspace-sidebar {
  border-right: 1px solid var(--color-border);
}

.workspace-preview {
  border-left: 1px solid var(--color-border);
  grid-column: 5;
  grid-row: 1 / 3;
}

.workspace-resizer {
  position: relative;
  z-index: 3;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
}

.workspace-resizer::after {
  position: absolute;
  inset: 0 2px;
  background: transparent;
  content: '';
  transition: background 120ms ease;
}

.workspace-resizer:hover::after,
.workspace-resizer:focus-visible::after {
  background: var(--color-accent);
}

@media (max-width: 1100px) {
  .workspace-page {
    grid-template-columns: minmax(0, 1fr) !important;
    grid-template-rows: 58px auto minmax(0, 1fr);
  }

  .workspace-resizer {
    display: none;
  }

  .compact-navigation {
    display: grid;
    grid-column: 1;
    grid-row: 2;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 5px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-panel);
  }

  .compact-navigation button {
    padding: 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--color-muted);
  }

  .compact-navigation button.active {
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  .workbench,
  .workspace-preview {
    grid-column: 1;
    grid-row: 3;
  }
  .app-header {
    grid-column: 1;
    grid-row: 1;
  }
  .workbench {
    display: grid;
    grid-template-columns: minmax(220px, 30%) minmax(0, 1fr);
  }
  .workbench > .workspace-resizer {
    display: none;
  }
  .workbench > .workspace-sidebar {
    grid-column: 1;
  }
  .workbench > .workspace-agent {
    grid-column: 2;
  }

  .compact-hidden {
    display: none;
  }
}

@media (max-width: 720px) {
  .header-status {
    display: none;
  }
  .brand-block {
    padding-right: 4px;
  }
  .workspace-tabs button {
    padding: 0 12px;
  }
  .workbench {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(150px, 34%) minmax(0, 1fr);
  }
  .workspace-sidebar,
  .workspace-agent {
    grid-column: 1;
  }
  .workspace-sidebar {
    grid-row: 1;
  }
  .workspace-agent {
    grid-row: 2;
  }
}
</style>

<style>
body.resizing-workspace {
  cursor: col-resize;
  user-select: none;
}
</style>
