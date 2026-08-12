<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'

import MarkdownEditor from '../editor/MarkdownEditor.vue'
import ConversationMessage from './ConversationMessage.vue'

import type {
  ApprovalDecision,
  ApprovalRequest,
  FileContent,
  SessionSummary,
  UnifiedAgentEvent,
  UnifiedMessage,
  HarnessKind,
  WorkspaceImageAsset,
  RunAuditRecord,
} from '@fastppt/protocol'
import type { DeepReadonly } from 'vue'

const props = defineProps<{
  mode: 'chat' | 'files'
  workspaceName: string
  selectedFile: FileContent | undefined
  draft: string
  dirty: boolean
  saving: boolean
  fileError: string | undefined
  externalChange: boolean
  session: DeepReadonly<SessionSummary> | undefined
  messages: readonly UnifiedMessage[]
  agentEvents: readonly UnifiedAgentEvent[]
  runAudit: RunAuditRecord | undefined
  approvals: readonly ApprovalRequest[]
  messageDraft: string
  attachments: readonly WorkspaceImageAsset[]
  attaching: boolean
  sending: boolean
  runActive: boolean
  harnessStatus: 'available' | 'degraded' | 'unavailable'
  harness: HarnessKind
  sendDisabledReason: string | undefined
  agentError: string | undefined
}>()

const emit = defineEmits<{
  updateDraft: [content: string]
  save: []
  format: []
  updateMessageDraft: [content: string]
  attach: [file: File]
  removeAttachment: [path: string]
  send: []
  cancel: []
  resolveApproval: [input: { approvalId: string; decision: ApprovalDecision }]
}>()
function updateMessageDraft(event: Event): void {
  emit('updateMessageDraft', (event.target as HTMLTextAreaElement).value)
}

function attachImage(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('attach', file)
  input.value = ''
}

function eventLabel(event: UnifiedAgentEvent): string {
  if (event.type === 'assistant.delta') {
    const data = event.data as { delta?: unknown }
    return typeof data.delta === 'string' ? data.delta : ''
  }
  if (event.type === 'command.output') {
    const data = event.data as { delta?: unknown }
    return typeof data.delta === 'string' ? data.delta : ''
  }
  if (event.type === 'command.started') return '开始执行命令'
  if (event.type === 'command.completed') return '命令执行完成'
  if (event.type === 'file.change.proposed') return '准备修改文件'
  if (event.type === 'file.changed') return '文件已更新'
  if (event.type === 'approval.requested') return '等待操作确认'
  if (event.type === 'approval.resolved') return '操作确认已处理'
  if (event.type === 'run.started') return '运行已开始'
  if (event.type === 'run.completed') return '运行已完成'
  if (event.type === 'run.cancelled') return '运行已取消'
  if (event.type === 'run.failed') return '运行失败'
  if (event.type === 'harness.disconnected') return 'Harness 已断开'
  if (event.type.startsWith('skill.')) {
    const data =
      event.data && typeof event.data === 'object' && !Array.isArray(event.data)
        ? (event.data as Record<string, unknown>)
        : {}
    const identity = event.themeSkillId
      ? `${event.themeSkillId}@${event.themeSkillVersion ?? 'unknown'}`
      : 'FastPPT Skills'
    const mechanism =
      typeof data.mechanism === 'string' ? ` · ${data.mechanism}` : ''
    const simulated = data.simulated === true ? ' · simulated fixture' : ''
    return `${identity}${mechanism}${simulated}`
  }
  return event.type
}

function eventKind(event: UnifiedAgentEvent): string {
  if (event.type.startsWith('command.')) return 'command'
  if (event.type.startsWith('tool.')) return 'tool'
  if (event.type.startsWith('file.')) return 'file'
  if (event.type === 'run.failed' || event.type === 'harness.disconnected')
    return 'error'
  return 'event'
}

const VISIBLE_EVENT_TYPES = new Set<UnifiedAgentEvent['type']>([
  'run.started',
  'command.started',
  'command.completed',
  'file.change.proposed',
  'file.changed',
  'approval.requested',
  'approval.resolved',
  'run.completed',
  'run.cancelled',
  'run.failed',
  'harness.disconnected',
])

const visibleAgentEvents = (events: readonly UnifiedAgentEvent[]) =>
  events.filter((event) => VISIBLE_EVENT_TYPES.has(event.type))

const conversationItems = computed(() =>
  [
    ...props.messages.map((message, index) => ({
      kind: 'message' as const,
      id: `message:${message.id}`,
      timestamp: message.createdAt,
      fallbackOrder: index * 2,
      message,
    })),
    ...visibleAgentEvents(props.agentEvents).map((event, index) => ({
      kind: 'event' as const,
      id: `event:${event.eventId}`,
      timestamp: event.timestamp,
      fallbackOrder: index * 2 + 1,
      event,
    })),
  ].sort((left, right) => {
    if (left.timestamp && right.timestamp)
      return left.timestamp.localeCompare(right.timestamp)
    return left.fallbackOrder - right.fallbackOrder
  }),
)

const conversationStream = useTemplateRef<HTMLDivElement>('conversationStream')
const followConversationTail = shallowRef(true)
const conversationTail = computed(() => {
  const entry = conversationItems.value.at(-1)
  if (!entry) return ''
  return entry.kind === 'message'
    ? `${entry.id}:${entry.message.content.length}`
    : entry.id
})

function updateConversationFollowState(): void {
  const element = conversationStream.value
  if (!element) return
  followConversationTail.value =
    element.scrollHeight - element.scrollTop - element.clientHeight < 80
}

async function scrollToConversationTail(force = false): Promise<void> {
  if (!force && !followConversationTail.value) return
  await nextTick()
  const element = conversationStream.value
  if (element) element.scrollTop = element.scrollHeight
}

watch(conversationTail, () => void scrollToConversationTail())
onMounted(() => void scrollToConversationTail(true))

const composerDisabled = computed(
  () => !props.session || props.harnessStatus !== 'available',
)
const sendDisabled = computed(
  () =>
    !props.session ||
    !props.messageDraft.trim() ||
    props.sending ||
    Boolean(props.sendDisabledReason),
)

function approvalReason(approval: ApprovalRequest): string {
  return approval.reason ?? 'Provider 未提供风险说明，请核对操作内容后决定。'
}
</script>

<template>
  <section class="agent-panel panel-surface">
    <template v-if="mode === 'chat'">
      <div v-if="!session" class="conversation-empty">
        <div class="conversation-orbit"><span>F</span></div>
        <h2>创建或选择 {{ harness === 'claude' ? 'Claude' : 'Codex' }} 会话</h2>
        <p>
          会话会按当前 workspace
          过滤。流式消息、命令、文件修改与审批都会保留结构化事件。
        </p>
      </div>
      <div
        v-else
        ref="conversationStream"
        class="conversation-stream"
        @scroll.passive="updateConversationFollowState"
      >
        <div class="session-heading">
          <strong>{{ session.title ?? session.preview }}</strong>
          <span>{{ session.status }}</span>
        </div>
        <details v-if="runAudit" class="run-audit-card">
          <summary>本次运行 Skill 审计 · {{ runAudit.status }}</summary>
          <dl>
            <div>
              <dt>主题</dt>
              <dd>{{ runAudit.themeId ?? '未解析' }}</dd>
            </div>
            <div>
              <dt>主题 Skill</dt>
              <dd>
                {{ runAudit.themeSkillId ?? '未解析' }}@{{
                  runAudit.themeSkillVersion ?? 'unknown'
                }}
              </dd>
            </div>
            <div>
              <dt>解析状态</dt>
              <dd>{{ runAudit.skillResolutionStatus }}</dd>
            </div>
            <div>
              <dt>调用状态</dt>
              <dd>{{ runAudit.invocationStatus }}</dd>
            </div>
            <div>
              <dt>调用机制</dt>
              <dd>{{ runAudit.invocationMechanism ?? '尚未记录' }}</dd>
            </div>
            <div>
              <dt>观察证据</dt>
              <dd>
                {{
                  runAudit.observationEvidence === null
                    ? 'Harness 未提供稳定观察证据'
                    : JSON.stringify(runAudit.observationEvidence)
                }}
              </dd>
            </div>
          </dl>
        </details>
        <template v-for="entry in conversationItems" :key="entry.id">
          <article
            v-if="entry.kind === 'message'"
            class="message-card"
            :class="`message-${entry.message.role}`"
          >
            <header class="message-meta">
              <strong>{{
                entry.message.role === 'user'
                  ? '你'
                  : entry.message.role === 'assistant'
                    ? harness === 'claude'
                      ? 'Claude'
                      : 'Codex'
                    : entry.message.role
              }}</strong>
              <time v-if="entry.message.createdAt">{{
                new Date(entry.message.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              }}</time>
            </header>
            <ConversationMessage :content="entry.message.content" />
          </article>
          <article
            v-else
            class="event-card"
            :class="`event-${eventKind(entry.event)}`"
          >
            <span class="event-dot" aria-hidden="true"></span>
            <small>{{ eventLabel(entry.event) }}</small>
          </article>
        </template>
        <article
          v-for="approval in approvals"
          :key="approval.id"
          class="approval-card"
        >
          <strong>{{ approval.title }}</strong>
          <dl class="approval-context">
            <div>
              <dt>Harness</dt>
              <dd>{{ approval.harness }}</dd>
            </div>
            <div>
              <dt>工作目录</dt>
              <dd>{{ approval.cwd ?? '未提供' }}</dd>
            </div>
            <div>
              <dt>影响文件</dt>
              <dd>
                {{
                  approval.affectedFiles.length
                    ? approval.affectedFiles.join(', ')
                    : '未提供'
                }}
              </dd>
            </div>
            <div>
              <dt>风险说明</dt>
              <dd>{{ approvalReason(approval) }}</dd>
            </div>
          </dl>
          <code v-if="approval.command">{{ approval.command }}</code>
          <div>
            <button
              type="button"
              @click="
                $emit('resolveApproval', {
                  approvalId: approval.id,
                  decision: 'reject',
                })
              "
            >
              拒绝
            </button>
            <button
              type="button"
              @click="
                $emit('resolveApproval', {
                  approvalId: approval.id,
                  decision: 'approve',
                })
              "
            >
              允许一次
            </button>
            <button
              type="button"
              @click="
                $emit('resolveApproval', {
                  approvalId: approval.id,
                  decision: 'approve-for-session',
                })
              "
            >
              本会话允许
            </button>
          </div>
        </article>
      </div>
      <footer class="composer-shell">
        <div v-if="attachments.length" class="attachment-list">
          <span v-for="attachment in attachments" :key="attachment.path">
            {{ attachment.name }} · {{ Math.ceil(attachment.size / 1024) }} KB
            <button
              type="button"
              :aria-label="`移除附件 ${attachment.name}`"
              @click="$emit('removeAttachment', attachment.path)"
            >
              ×
            </button>
          </span>
        </div>
        <textarea
          id="fastppt-message"
          name="message"
          :value="messageDraft"
          :disabled="composerDisabled"
          placeholder="输入演示文稿需求…"
          rows="3"
          @input="updateMessageDraft"
          @keydown.ctrl.enter.prevent="$emit('send')"
          @keydown.meta.enter.prevent="$emit('send')"
        ></textarea>
        <div v-if="sendDisabledReason" class="agent-error">
          发送已禁用：{{ sendDisabledReason }}
        </div>
        <div v-if="agentError" class="agent-error">{{ agentError }}</div>
        <div class="composer-meta">
          <div class="composer-tools">
            <label :class="{ disabled: attaching || attachments.length >= 4 }">
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                :disabled="attaching || attachments.length >= 4"
                @change="attachImage"
              />
              {{ attaching ? '上传中…' : '添加图片' }}
            </label>
            <span>Ctrl / ⌘ + Enter 发送</span>
          </div>
          <button v-if="runActive" type="button" @click="$emit('cancel')">
            停止
          </button>
          <button
            v-else
            type="button"
            :disabled="sendDisabled"
            @click="$emit('send')"
          >
            {{ sending ? '启动中…' : '发送' }}
          </button>
        </div>
      </footer>
    </template>
    <MarkdownEditor
      v-else-if="selectedFile"
      :path="selectedFile.path"
      :content="draft"
      :dirty="dirty"
      :saving="saving"
      :error="fileError"
      :external-change="externalChange"
      @update:content="$emit('updateDraft', $event)"
      @save="$emit('save')"
      @format="$emit('format')"
    />
    <div v-else class="markdown-empty">
      从左侧文件树选择一个文本文件开始编辑。
    </div>
  </section>
</template>

<style scoped>
.agent-panel {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 22px 16px;
}
.eyebrow {
  color: var(--color-accent);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
h1,
h2,
p {
  margin: 0;
}
h1 {
  margin-top: 4px;
  font-size: 17px;
}
.mode-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--color-muted);
  font-size: 11px;
}
.tabs {
  display: flex;
  gap: 18px;
  padding: 0 22px;
  border-bottom: 1px solid var(--color-border);
}
.tab {
  padding: 9px 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-muted);
}
.tab-active {
  border-color: var(--color-accent);
  color: var(--color-text);
}
.conversation-empty,
.markdown-empty {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 12px;
  max-width: 430px;
  margin: auto;
  padding: 32px;
  color: var(--color-muted);
  text-align: center;
}
.conversation-stream {
  min-height: 0;
  padding: 22px clamp(18px, 4vw, 56px);
  overflow: auto;
}
.session-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  color: var(--color-muted);
  font-size: 11px;
}
.message-card,
.approval-card,
.run-audit-card {
  width: min(88%, 760px);
  margin: 12px 0;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-panel-raised);
}
.run-audit-card {
  border-color: color-mix(
    in srgb,
    var(--color-accent) 40%,
    var(--color-border)
  );
}
.run-audit-card summary {
  color: var(--color-muted);
  cursor: pointer;
  font-size: 11px;
}
.run-audit-card dl {
  display: grid;
  gap: 5px;
  margin: 8px 0 0;
}
.run-audit-card div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
}
.run-audit-card dt,
.run-audit-card dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 10px;
}
.run-audit-card dt {
  color: var(--color-muted);
}
.run-audit-card dd {
  font-family: var(--font-mono);
}
.message-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.message-meta strong,
.message-meta time,
.event-card small {
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
}
.message-content,
.approval-card p {
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.message-assistant {
  border-color: transparent;
  background: transparent;
}
.message-user {
  margin-left: auto;
  border-color: color-mix(
    in srgb,
    var(--color-accent) 35%,
    var(--color-border)
  );
}
.event-card {
  display: flex;
  align-items: center;
  width: fit-content;
  gap: 8px;
  margin: 7px 0;
  padding: 3px 0;
  border: 0;
  background: transparent;
  color: var(--color-muted);
  font-size: 11px;
}
.event-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: var(--color-border-strong);
}
.event-delta {
  border-color: transparent;
  background: transparent;
  color: var(--color-text);
}
.event-command,
.event-tool,
.event-file {
  border-left-width: 3px;
}
.event-command {
  border-left-color: #fbbf24;
}
.event-tool {
  border-left-color: #60a5fa;
}
.event-file {
  border-left-color: var(--color-accent);
}
.event-error {
  border-color: color-mix(
    in srgb,
    var(--color-danger) 55%,
    var(--color-border)
  );
  color: var(--color-danger);
}
.approval-card {
  border-color: #735f29;
  background: #211d12;
}
.approval-card code {
  display: block;
  margin-top: 8px;
  color: #fde68a;
  font-size: 11px;
  white-space: pre-wrap;
}
.approval-context {
  display: grid;
  gap: 5px;
  margin: 8px 0 0;
}
.approval-context div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  margin: 0;
}
.approval-context dt,
.approval-context dd {
  margin: 0;
  font-size: 10px;
}
.approval-context dt {
  color: var(--color-muted);
}
.approval-context dd {
  overflow-wrap: anywhere;
  color: #fde68a;
  font-family: var(--font-mono);
}
.approval-card div {
  display: flex;
  gap: 7px;
  margin-top: 10px;
}
.approval-card button {
  padding: 6px 9px;
  border: 1px solid var(--color-border-strong);
  border-radius: 7px;
  background: var(--color-panel-raised);
  color: var(--color-text);
  font-size: 10px;
}
.conversation-empty h2 {
  color: var(--color-text);
  font-size: 22px;
}
.conversation-empty p,
.markdown-empty {
  font-size: 13px;
  line-height: 1.65;
}
.conversation-orbit {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border: 1px solid var(--color-border-strong);
  border-radius: 18px;
  background: radial-gradient(
    circle at 40% 30%,
    #173e35,
    var(--color-panel-raised)
  );
  color: var(--color-accent);
  font-size: 21px;
  font-weight: 800;
  transform: rotate(-4deg);
}
.conversation-orbit span {
  transform: rotate(4deg);
}
.composer-shell {
  width: min(calc(100% - 36px), 820px);
  margin: 12px auto 20px;
  padding: 14px;
  border: 1px solid var(--color-border-strong);
  border-radius: 13px;
  background: var(--color-panel-raised);
}
.composer-shell textarea {
  width: 100%;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--color-text);
  font-size: 13px;
}
.agent-error {
  margin: 5px 0;
  color: var(--color-danger);
  font-size: 11px;
}
.composer-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--color-muted);
  font-size: 11px;
}
.composer-tools {
  display: flex;
  align-items: center;
  gap: 10px;
}
.composer-tools label {
  color: var(--color-accent);
  cursor: pointer;
}
.composer-tools label.disabled {
  color: var(--color-muted);
  cursor: default;
}
.composer-tools input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
.attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.attachment-list span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  color: var(--color-muted);
  font-size: 10px;
}
.attachment-list button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text);
}
.composer-meta button {
  padding: 7px 13px;
  border: 0;
  border-radius: 8px;
  background: var(--color-accent);
  color: #071612;
}
.composer-meta button:disabled {
  background: var(--color-disabled);
  color: var(--color-muted);
}
</style>
