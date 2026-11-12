<script setup lang="ts">
import { Aside, Box, Button, Footer, Main, Nav, Text } from '@fastrd/ui-vue'
import {
  computed,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
  shallowRef,
  watch,
} from 'vue'

import AgentWorkspace from '../components/workspace/AgentWorkspace.vue'
import EditorNavigation from '../components/workspace/EditorNavigation.vue'
import ManagedStatusBadge from '../components/workspace/ManagedStatusBadge.vue'
import PreviewPanel from '../components/workspace/PreviewPanel.vue'
import {
  visualEditInstruction,
  type PageEditRequest,
} from '../workspace/visual-edit.js'
import WorkspaceSidebar from '../components/workspace/WorkspaceSidebar.vue'
import { useFilesStore } from '../stores/files.js'
import { usePreviewStore } from '../stores/preview.js'
import { useSessionsStore } from '../stores/sessions.js'
import { useWorkspaceStore } from '../stores/workspace.js'

import { parseSlidevDocument } from '@fastppt/markdown/parser'
import { applyWizardProfile } from '../workspace/creation-wizard.js'
import type {
  LayoutResourceSummary,
  ColorPalette,
  SlideRegion,
  CreationWizard,
  FileNode,
  SessionDeckProfile,
} from '@fastppt/protocol'
import { useGatewayClient } from '../api/useGatewayClient.js'

import WorkspaceHeader from '../components/workspace/WorkspaceHeader.vue'
import WorkspaceActivityBar from '../components/workspace/WorkspaceActivityBar.vue'
import WorkspaceCommandPalette from '../components/workspace/WorkspaceCommandPalette.vue'
import { useWorkspaceLayout } from '../workspace/use-workspace-layout.js'
import {
  workspaceViews,
  type WorkspaceMode,
  type WorkspaceCommand,
} from '../workspace/navigation.js'

const NewSessionDialog = defineAsyncComponent(
  () => import('../components/workspace/NewSessionDialog.vue'),
)
const PageEditDialog = defineAsyncComponent(
  () => import('../components/workspace/PageEditDialog.vue'),
)
const ResourceGallery = defineAsyncComponent(
  () => import('../components/workspace/ResourceGallery.vue'),
)
const ThemeCatalog = defineAsyncComponent(
  () => import('../components/themes/ThemeCatalog.vue'),
)
const ThemeImport = defineAsyncComponent(
  () => import('../components/workspace/ThemeImport.vue'),
)
const PaletteGallery = defineAsyncComponent(() => import('../components/workspace/PaletteGallery.vue'))
const CreationWizardPanel = defineAsyncComponent(
  () => import('../components/workspace/CreationWizardPanel.vue'),
)
const SpeakerNotesPanel = defineAsyncComponent(
  () => import('../components/workspace/SpeakerNotesPanel.vue'),
)
const AnimationTimelinePanel = defineAsyncComponent(
  () => import('../components/workspace/AnimationTimelinePanel.vue'),
)
const DiagramEditorPanel = defineAsyncComponent(
  () => import('../components/workspace/DiagramEditorPanel.vue'),
)

const workspaceStore = useWorkspaceStore()
const filesStore = useFilesStore()
const previewStore = usePreviewStore()
const sessionsStore = useSessionsStore()
const gatewayClient = useGatewayClient()
const controller = new AbortController()
const shell = shallowRef<HTMLElement>()
const workspaceMode = shallowRef<WorkspaceMode>('chat')
const { gridTemplateColumns, sidebarVisible, startResize, handleResizeKey } =
  useWorkspaceLayout(shell)
const hasPreview = computed(() =>
  ['chat', 'files', 'notes', 'animations'].includes(workspaceMode.value),
)
const compactPanel = shallowRef<'workbench' | 'preview'>('workbench')
const newSessionOpen = shallowRef(false)
const creationWizardOpen = shallowRef(false)
const committedWizard = shallowRef<CreationWizard>()
function configureWizardSession(wizard: CreationWizard): void {
  committedWizard.value = wizard
  newSessionOpen.value = true
}
const commandPaletteOpen = shallowRef(false)
const newSessionSubmitting = shallowRef(false)
const selectedPage = shallowRef(1)
const pageEditOpen = shallowRef(false)
const pageEditPage = shallowRef(1)
const pageEditSubmitting = shallowRef(false)
const pageEditResource = shallowRef<LayoutResourceSummary>()
const pageEditRegion = shallowRef<SlideRegion>()
const pageEditPath = shallowRef('')
const pageEditPicking = shallowRef(false)

function flattenMarkdownPaths(nodes: readonly FileNode[]): string[] {
  return nodes.flatMap((node) =>
    node.type === 'directory'
      ? flattenMarkdownPaths(node.children ?? [])
      : node.path.toLowerCase().endsWith('.md')
        ? [node.path]
        : [],
  )
}

const markdownPaths = computed(() => flattenMarkdownPaths(filesStore.files))

function slideChunks(source: string): string[] {
  if (!source.trim()) return []
  try {
    return parseSlidevDocument(source).map((slide) => slide.raw)
  } catch {
    return []
  }
}

const remoteDeckMarkdown = shallowRef('')
const navigationMarkdown = computed(() =>
  filesStore.selectedFile?.path === previewStore.selectedDeck?.entryFile
    ? filesStore.draft
    : remoteDeckMarkdown.value,
)
watch(
  () => [
    previewStore.selectedDeck?.entryFile,
    previewStore.frameRevision,
    filesStore.selectedFile?.revision,
  ],
  async (_value, _old, onCleanup) => {
    const path = previewStore.selectedDeck?.entryFile
    const abort = new AbortController()
    onCleanup(() => abort.abort())
    if (!path) {
      remoteDeckMarkdown.value = ''
      return
    }
    try {
      const file = await gatewayClient.readFile(path, abort.signal)
      if (!abort.signal.aborted) remoteDeckMarkdown.value = file.content
    } catch {
      if (!abort.signal.aborted) remoteDeckMarkdown.value = ''
    }
  },
  { immediate: true },
)
watch(
  () => previewStore.selectedDeckId,
  () => {
    selectedPage.value = 1
  },
)
const selectedDeckPageCount = computed(
  () => slideChunks(navigationMarkdown.value).length || undefined,
)

const workspaceLabel = computed(
  () =>
    workspaceStore.workspace?.name ??
    (workspaceStore.loading ? '连接中…' : '未连接'),
)
const harnessLabel = computed(() =>
  sessionsStore.selectedHarnessStatus?.status === 'available'
    ? (sessionsStore.selectedHarnessStatus.version ?? 'ready')
    : 'unavailable',
)
const sendDisabledReason = computed(() => {
  const configuredTheme = sessionsStore.selectedProfile?.profile.theme
  const theme =
    configuredTheme?.mode === 'registered'
      ? previewStore.themes.find(
          (candidate) => candidate.themeId === configuredTheme.themeId,
        )
      : previewStore.selectedTheme
  if (!theme) return '当前会话没有可用的已注册主题'
  const requiredSkills = sessionsStore.selectedSkillStatuses.filter(
    (status) => status.kind === 'base' || status.themeId === theme.themeId,
  )
  const unavailable = requiredSkills.find(
    (status) => status.state !== 'installed' && !(status.kind === 'theme' && status.state === 'on-demand'),
  )
  if (!unavailable) return undefined
  return `${unavailable.skillId} ${unavailable.state}${
    unavailable.message ? `：${unavailable.message}` : ''
  }`
})

function selectWorkspaceMode(mode: WorkspaceMode): void {
  workspaceMode.value = mode
  compactPanel.value = 'workbench'
}
function usePalette(palette: ColorPalette): void {
  const brief = `请参考配色「${palette.title}」：${palette.colors.join(' ')}。来源：${palette.sourceUrl}。按背景、正文、主色和强调色分配色彩，并检查文字可读性；如与已确认的主题冲突，先说明调整建议。`
  sessionsStore.draft = [sessionsStore.draft.trim(), brief].filter(Boolean).join('\n\n')
  selectWorkspaceMode('chat')
}

function onThemeImported(): void {
  // Return to the conversation workspace; the imported theme appears in the
  // theme catalog after the harness design session completes.
  workspaceMode.value = 'chat'
  compactPanel.value = 'workbench'
}

function handleWorkspaceShortcut(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return
  const target = event.target as HTMLElement | null
  if (target?.closest('dialog[open], [role="dialog"]')) return
  if (event.key === 'Escape' && commandPaletteOpen.value) {
    event.preventDefault()
    commandPaletteOpen.value = false
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    creationWizardOpen.value = true
    return
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === 'p'
  ) {
    event.preventDefault()
    commandPaletteOpen.value = true
    return
  }
  if (target?.closest('input, textarea, select, [contenteditable="true"]'))
    return
  if (!event.altKey || event.ctrlKey || event.metaKey) return
  const modes = workspaceViews.map((view) => view.id)
  const index = Number.parseInt(event.key, 10)
  if (!Number.isInteger(index) || index < 1 || index > modes.length) return
  event.preventDefault()
  selectWorkspaceMode(modes[index - 1]!)
}

function runCommand(command: WorkspaceCommand): void {
  commandPaletteOpen.value = false
  if (command === 'wizard') creationWizardOpen.value = true
  else if (command === 'start') {
    selectWorkspaceMode('chat')
    compactPanel.value = 'preview'
    void previewStore.startPreview()
  } else if (command === 'restart') void previewStore.restartPreview()
  else if (command === 'export') void previewStore.startExport()
  else if (command === 'quality')
    void previewStore.inspectQuality(selectedPage.value)
  else selectWorkspaceMode(command)
}

onMounted(() => {
  window.addEventListener('keydown', handleWorkspaceShortcut)
  void workspaceStore.load(controller.signal)
  void filesStore.start(controller.signal)
  void previewStore.load(controller.signal)
  void sessionsStore.load(controller.signal)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleWorkspaceShortcut)
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

async function selectEditorFile(path: string): Promise<void> {
  await filesStore.openFile(path)
  const deck = previewStore.decks.find(
    (candidate) => candidate.entryFile === path,
  )
  if (deck) await previewStore.selectDeck(deck.id)
}

async function openPageEdit(
  page: number,
  resource?: LayoutResourceSummary,
  region?: SlideRegion,
  browse = false,
): Promise<void> {
  const path =
    previewStore.selectedDeck?.entryFile ?? filesStore.selectedFile?.path
  if (!path?.toLowerCase().endsWith('.md')) {
    sessionsStore.error = '请选择一个演示文稿后再修改页面'
    return
  }
  if (filesStore.dirty) {
    await filesStore.save()
    if (filesStore.dirty || filesStore.error) return
  }
  if (filesStore.selectedFile?.path !== path) await filesStore.openFile(path)
  if (filesStore.selectedFile?.path !== path || filesStore.error) return
  const count = slideChunks(filesStore.draft).length
  if (!Number.isInteger(page) || page < 1 || page > count) {
    sessionsStore.error = '目标页已变化，请重新选择'
    return
  }
  pageEditPicking.value = browse
  pageEditPath.value = path
  pageEditPage.value = page
  pageEditResource.value = resource
  pageEditRegion.value = region
  pageEditOpen.value = true
}

async function submitPageEdit(input: PageEditRequest): Promise<void> {
  const instruction = visualEditInstruction(input)
  if (pageEditSubmitting.value) return
  const path = pageEditPath.value
  const theme = previewStore.selectedTheme
  if (!path || !theme) return
  pageEditSubmitting.value = true
  let branched: boolean | undefined
  try {
    const sourceProfile = sessionsStore.selectedProfile?.profile
    const profile: SessionDeckProfile = {
      ...(sourceProfile ?? {
        version: 1,
        audience: '沿用当前演示文稿受众',
        communicationIntent: 'instruction',
        narrativeMode: 'instructional',
        language: 'source',
        theme: { mode: 'registered' as const, themeId: theme.themeId },
        preservation: {
          wording: 'free',
          pageCount: 'preserve',
          pageOrder: 'preserve',
          visualStructure: 'free',
        },
        reviewPolicy: 'standard',
      }),
      conversationMode: 'edit-page',
      target: { markdownPath: path, slide: pageEditPage.value },
      artifactRoute: 'edit-slidev',
      theme: { mode: 'registered', themeId: theme.themeId },
      preservation: {
        wording: sourceProfile?.preservation.wording ?? 'free',
        pageCount: 'preserve',
        pageOrder: 'preserve',
        visualStructure: input.resource
          ? 'free'
          : (sourceProfile?.preservation.visualStructure ?? 'free'),
      },
    }
    branched = await sessionsStore.forkSelectedSessionForPageEdit({
      title: `${sessionsStore.selectedSession?.title ?? '演示文稿'} · 第 ${pageEditPage.value} 页编辑`,
      profile,
    })
  } finally {
    pageEditSubmitting.value = false
  }
  if (!branched) return
  pageEditOpen.value = false
  workspaceMode.value = 'chat'
  compactPanel.value = 'workbench'
  sessionsStore.draft = `请基于本分支继承的演示文稿生成对话继续执行，不要重新进行需求读取或内容分析。

只修改 ${path} 的第 ${pageEditPage.value} 页，其他页面必须保持不变。

修改要求：${instruction}

沿用父对话中已确认的受众、叙事、主题和设计决策。修改前只核对当前文档的目标页；完成后运行格式化、验证和该页质量检查。`
  await sendMessage()
}

async function sendMessage(): Promise<void> {
  if (sendDisabledReason.value) {
    sessionsStore.error = `发送已禁用：${sendDisabledReason.value}`
    return
  }
  await sessionsStore.send(previewStore.selectedTheme?.themeId)
}

async function createConfiguredSession(input: {
  title: string
  profile: SessionDeckProfile
}): Promise<void> {
  newSessionSubmitting.value = true
  try {
    if (committedWizard.value) {
      const profile = applyWizardProfile(input.profile, committedWizard.value)
      await sessionsStore.createSession({ ...input, profile })
      if (!sessionsStore.error) {
        newSessionOpen.value = false
        committedWizard.value = undefined
        localStorage.removeItem('fastppt.creation-wizard')
      }
      return
    }
    const wizard = await gatewayClient.createCreationWizard()
    await gatewayClient.updateCreationWizard(wizard.id, {
      currentStep: 'delivery',
      decision: {
        version: 1,
        stepId: 'session-profile',
        question: '演示文稿创建配置',
        options: [
          input.profile.artifactRoute,
          input.profile.communicationIntent,
          input.profile.narrativeMode,
        ],
        selected: JSON.stringify(input.profile),
        rationale: '由创建向导提交',
        actor: 'user',
        locked: true,
        timestamp: new Date().toISOString(),
      },
    })
    await gatewayClient.commitCreationWizard(wizard.id)
    await sessionsStore.createSession(input)
    if (!sessionsStore.error) newSessionOpen.value = false
  } catch (cause) {
    sessionsStore.error =
      cause instanceof Error ? cause.message : '无法创建会话'
  } finally {
    newSessionSubmitting.value = false
  }
}
</script>

<template>
  <Main
    ref="shell"
    class="workspace-page"
    :class="{
      'theme-mode': !hasPreview,
      'sidebar-collapsed': !sidebarVisible,
    }"
    :style="{ gridTemplateColumns }"
  >
    <WorkspaceHeader
      :workspace="workspaceLabel"
      :mode="workspaceMode"
      @command="runCommand"
      @search="commandPaletteOpen = true"
      @toggle-sidebar="sidebarVisible = !sidebarVisible"
    />
    <WorkspaceActivityBar :mode="workspaceMode" @select="selectWorkspaceMode" />
    <Nav v-if="hasPreview" class="compact-navigation" aria-label="工作区面板">
      <Button
        variant="secondary"
        type="button"
        :class="{ active: compactPanel === 'workbench' }"
        @click="compactPanel = 'workbench'"
      >
        {{
          workspaceMode === 'chat'
            ? '对话工作区'
            : workspaceMode === 'animations'
              ? '动画工作区'
              : workspaceMode === 'notes'
                ? '备注工作区'
                : '文件工作区'
        }}
      </Button>
      <Button
        variant="secondary"
        type="button"
        :class="{ active: compactPanel === 'preview' }"
        @click="compactPanel = 'preview'"
      >
        预览
      </Button>
    </Nav>
    <ResourceGallery
      v-if="workspaceMode === 'resources'"
      class="theme-catalog-page"
      :can-apply="Boolean(previewStore.selectedDeck)"
      :page="selectedPage"
      @choose="openPageEdit(selectedPage, $event)"
    />
    <ThemeCatalog
      v-else-if="workspaceMode === 'themes'"
      class="theme-catalog-page"
      :themes="previewStore.themes"
      :loading="previewStore.loading"
      :error="previewStore.error"
    />
    <PaletteGallery v-else-if="workspaceMode === 'palettes'" class="theme-catalog-page" :harness="sessionsStore.selectedHarness" @use="usePalette" />
    <ThemeImport
      v-else-if="workspaceMode === 'import'"
      class="theme-catalog-page"
      @imported="onThemeImported"
    />
    <AnimationTimelinePanel
      v-else-if="workspaceMode === 'animations'"
      class="animation-page"
      :class="{ 'compact-hidden': compactPanel !== 'workbench' }"
      :deck="previewStore.selectedDeck"
      :page="selectedPage"
      @update:page="selectedPage = $event"
    />
    <DiagramEditorPanel
      v-else-if="workspaceMode === 'diagrams'"
      class="notes-page"
      :deck="previewStore.selectedDeck"
    />
    <Box
      v-else
      class="workbench"
      :class="{ 'compact-hidden': compactPanel !== 'workbench' }"
    >
      <WorkspaceSidebar
        v-if="workspaceMode === 'chat'"
        class="workspace-sidebar"
        :markdown="navigationMarkdown"
        :deck-path="previewStore.selectedDeck?.entryFile"
        :selected-page="selectedPage"
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
        @select-session="sessionsStore.selectSession"
        @create-session="newSessionOpen = true"
        @rename-session="sessionsStore.renameSelectedSession"
        @fork-session="sessionsStore.forkSelectedSession"
        @retry-sessions="sessionsStore.load()"
        @load-more-sessions="sessionsStore.loadMore()"
        @select-harness="sessionsStore.selectHarness"
        @select-page="selectedPage = $event"
        @edit-page="openPageEdit($event)"
        @remake-page="openPageEdit($event, undefined, undefined, true)"
      />
      <Aside
        v-else-if="workspaceMode === 'files'"
        class="workspace-sidebar editor-sidebar"
        :class="{ 'with-pages': Boolean(navigationMarkdown) }"
        aria-label="编辑导航"
      >
        <EditorNavigation
          activity="files"
          :files="filesStore.files"
          :selected-path="filesStore.selectedFile?.path"
          :markdown="''"
          :selected-page="selectedPage"
          :loading="filesStore.loading"
          @select-file="selectEditorFile"
          @retry-files="filesStore.loadTree()"
        />
        <EditorNavigation
          v-if="navigationMarkdown"
          embedded
          activity="slidev"
          :files="[]"
          :selected-path="previewStore.selectedDeck?.entryFile"
          :markdown="navigationMarkdown"
          :selected-page="selectedPage"
          :loading="false"
          @select-page="selectedPage = $event"
          @edit-page="openPageEdit"
          @remake-page="openPageEdit($event, undefined, undefined, true)"
        />
      </Aside>
      <EditorNavigation
        v-else
        class="workspace-sidebar"
        activity="slidev"
        :files="[]"
        :selected-path="previewStore.selectedDeck?.entryFile"
        :markdown="navigationMarkdown"
        :selected-page="selectedPage"
        :loading="false"
        @select-page="selectedPage = $event"
        @edit-page="openPageEdit"
        @remake-page="openPageEdit($event, undefined, undefined, true)"
      />
      <Box
        class="workspace-resizer"
        role="separator"
        aria-label="调整导航区域宽度"
        aria-orientation="vertical"
        tabindex="0"
        @pointerdown="startResize('sidebar', $event)"
        @keydown="handleResizeKey('sidebar', $event)"
      ></Box>
      <SpeakerNotesPanel
        v-if="workspaceMode === 'notes'"
        class="workspace-agent"
        :deck="previewStore.selectedDeck"
        :page="selectedPage"
        @update:page="selectedPage = $event"
      />
      <AgentWorkspace
        v-else
        class="workspace-agent"
        :mode="workspaceMode"
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
        @create-session="newSessionOpen = true"
        @send="sendMessage"
        @cancel="sessionsStore.cancel"
        @resolve-approval="
          sessionsStore.resolveApproval($event.approvalId, $event.decision)
        "
      />
    </Box>
    <Box
      v-if="hasPreview"
      class="preview-resizer workspace-resizer"
      role="separator"
      aria-label="调整预览区域宽度"
      aria-orientation="vertical"
      tabindex="0"
      @pointerdown="startResize('preview', $event)"
      @keydown="handleResizeKey('preview', $event)"
    ></Box>
    <PreviewPanel
      v-if="hasPreview"
      :delivery-defaults="
        sessionsStore.selectedProfile?.profile.deliveryOptions
      "
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
      :validation="previewStore.validation"
      :requested-page="selectedPage"
      :max-page="selectedDeckPageCount"
      @edit-region="openPageEdit($event.page, undefined, $event.region)"
      @edit-page="openPageEdit($event)"
      @select-deck="previewStore.selectDeck"
      @start="previewStore.startPreview"
      @restart="previewStore.restartPreview"
      @stop="previewStore.stopPreview"
      @refresh="previewStore.refreshFrame"
      @export="previewStore.startExport($event)"
      @inspect-quality="previewStore.inspectQuality"
      @rule-exceptions-changed="previewStore.refreshValidation"
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
      @page-change="selectedPage = $event"
      @cancel-export="previewStore.cancelExport"
      @review-export="previewStore.reviewExport"
      @retry-export="previewStore.retryExport"
      @download-export="previewStore.downloadExport"
    />
    <NewSessionDialog
      v-if="newSessionOpen"
      :open="newSessionOpen"
      :wizard="committedWizard"
      :error="sessionsStore.error"
      :harness="sessionsStore.selectedHarness"
      :themes="previewStore.themes"
      :submitting="newSessionSubmitting"
      :markdown-paths="markdownPaths"
      @close="newSessionOpen = false"
      @submit="createConfiguredSession"
    />
    <CreationWizardPanel
      v-if="creationWizardOpen"
      :open="creationWizardOpen"
      @committed="configureWizardSession"
      @close="creationWizardOpen = false"
    />
    <WorkspaceCommandPalette
      :open="commandPaletteOpen"
      :preview-ready="previewStore.state?.status === 'ready'"
      @close="commandPaletteOpen = false"
      @run="runCommand"
    />
    <Footer class="workspace-status" aria-label="工作区状态">
      <Button
        variant="quiet"
        class="connection-status"
        type="button"
        :title="workspaceStore.error ?? workspaceStore.workspace?.root"
        @click="workspaceStore.load()"
      >
        <Text
          class="status-dot"
          :class="{ connected: Boolean(workspaceStore.workspace) }"
          aria-hidden="true"
        ></Text
        >{{
          workspaceStore.workspace
            ? '本地已连接'
            : workspaceStore.loading
              ? '正在连接…'
              : '重新连接'
        }}
      </Button>
      <Text
        class="status-path"
        :title="
          filesStore.selectedFile?.path ?? previewStore.selectedDeck?.entryFile
        "
      >
        {{
          filesStore.selectedFile?.path ??
            previewStore.selectedDeck?.entryFile ??
            workspaceLabel
        }}
      </Text>
      <Text v-if="filesStore.saving">保存中…</Text
      ><Text v-else-if="filesStore.dirty">有未保存的更改</Text>
      <Text class="status-spacer"></Text>
      <ManagedStatusBadge
        :skill-statuses="sessionsStore.selectedSkillStatuses"
        :mcp-status="sessionsStore.selectedMcpStatus"
        :harness-label="harnessLabel"
      />
      <Text v-if="selectedDeckPageCount" class="status-pages">
        第 {{ selectedPage }} / {{ selectedDeckPageCount }} 页
      </Text>
    </Footer>
    <PageEditDialog
      v-if="pageEditOpen"
      :open="pageEditOpen"
      :path="pageEditPath"
      :resource="pageEditResource"
      :region="pageEditRegion"
      :browse-initially="pageEditPicking"
      :page="pageEditPage"
      :sending="pageEditSubmitting"
      @close="pageEditOpen = false"
      @submit="submitPageEdit"
    />
  </Main>
</template>

<style scoped>
.workspace-page {
  display: grid;
  grid-template-rows: 44px minmax(0, 1fr) 25px;
  height: 100dvh;
  overflow: hidden;
  background: var(--color-canvas);
  color: var(--color-text);
}
.app-header {
  grid-column: 1 / -1;
  grid-row: 1;
}
.workspace-activity {
  grid-column: 1;
  grid-row: 2;
  min-height: 0;
}
.workspace-page.theme-mode {
  grid-template-columns: 56px minmax(0, 1fr) !important;
}
.theme-catalog-page,
.notes-page {
  grid-column: 2 / -1;
  grid-row: 2;
  min-height: 0;
  min-width: 0;
}
.animation-page {
  grid-column: 2 / 5;
  grid-row: 2;
  min-width: 0;
}
.workbench {
  display: grid;
  grid-column: 2 / 5;
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
.editor-sidebar {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}
.editor-sidebar.with-pages {
  grid-template-rows: minmax(160px, 1fr) minmax(140px, 38%);
}
.editor-sidebar > .editor-navigation {
  min-height: 0;
}
.editor-sidebar > .embedded {
  border-top: 1px solid var(--color-border);
}
.sidebar-collapsed .workspace-sidebar {
  visibility: hidden;
}
.compact-navigation {
  display: none;
}
.workspace-sidebar,
.workspace-agent,
.workspace-preview {
  min-height: 0;
  min-width: 0;
  background: var(--color-panel);
}
.preview-resizer {
  grid-column: 5;
  grid-row: 2;
}
.workspace-preview {
  grid-column: 6;
  grid-row: 2;
  border-left: 1px solid var(--color-border);
}
.workspace-resizer {
  position: relative;
  z-index: 3;
  width: 4px;
  cursor: col-resize;
  touch-action: none;
  background: var(--color-border);
}
.workspace-resizer:hover,
.workspace-resizer:focus-visible {
  background: var(--color-accent);
}
.workspace-status {
  display: flex;
  align-items: center;
  gap: 14px;
  grid-column: 1 / -1;
  grid-row: 3;
  min-width: 0;
  padding: 0 12px;
  border-top: 1px solid var(--color-border);
  background: var(--color-panel-raised);
  color: var(--color-muted);
  font-size: 10px;
  white-space: nowrap;
}
.connection-status {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-danger);
}
.status-dot.connected {
  background: var(--color-accent);
}
.status-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font: 10px var(--font-mono);
}
.status-spacer {
  flex: 1;
}
@media (max-width: 1100px) {
  .workspace-page {
    grid-template-columns: 56px minmax(0, 1fr) !important;
    grid-template-rows: 44px auto minmax(0, 1fr) 25px;
  }
  .workspace-activity {
    grid-row: 2 / 4;
  }
  .workspace-resizer {
    display: none;
  }
  .compact-navigation {
    display: flex;
    gap: 4px;
    grid-column: 2;
    grid-row: 2;
    padding: 4px 10px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-panel);
  }
  .compact-navigation button {
    flex: 1;
    min-height: 30px;
  }
  .workbench,
  .workspace-preview,
  .animation-page {
    grid-column: 2;
    grid-row: 3;
  }
  .workbench {
    grid-template-columns: minmax(200px, 30%) minmax(0, 1fr);
  }
  .workbench > .workspace-agent {
    grid-column: 2;
  }
  .sidebar-collapsed .workbench {
    grid-template-columns: 0 minmax(0, 1fr);
  }
  .workspace-status {
    grid-row: 4;
  }
  .theme-catalog-page,
  .notes-page {
    grid-row: 2 / 4;
  }
  .compact-hidden {
    display: none;
  }
}
@media (max-width: 600px) {
  .workspace-page,
  .workspace-page.theme-mode {
    grid-template-columns: minmax(0, 1fr) !important;
    grid-template-rows: 48px 50px auto minmax(0, 1fr) 25px;
  }
  .workspace-activity {
    grid-column: 1;
    grid-row: 2;
  }
  .compact-navigation {
    grid-column: 1;
    grid-row: 3;
  }
  .workbench,
  .workspace-preview,
  .animation-page {
    grid-column: 1;
    grid-row: 4;
  }
  .workbench {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(120px, 30%) minmax(0, 1fr);
  }
  .workbench > .workspace-agent {
    grid-column: 1;
    grid-row: 2;
  }
  .workbench > .workspace-sidebar {
    grid-row: 1;
    border-bottom: 1px solid var(--color-border);
  }
  .editor-sidebar.with-pages {
    grid-template-rows: minmax(64px, 1fr) minmax(80px, 45%);
  }
  .sidebar-collapsed .workbench {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 0 minmax(0, 1fr);
  }
  .theme-catalog-page,
  .notes-page {
    grid-column: 1;
    grid-row: 3 / 5;
  }
  .workspace-status {
    grid-row: 5;
    padding: 0 8px;
    gap: 8px;
  }
  .status-pages {
    display: none;
  }
}
</style>
