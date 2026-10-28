<script setup lang="ts">
import {
  Article,
  Box,
  BrandMark,
  Button,
  Description,
  DescriptionList,
  Disclosure,
  DisclosureTrigger,
  Field,
  Footer,
  Header,
  Heading,
  Panel,
  Term,
  Text,
  TextArea,
  TextField,
} from '@fastppt/components'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'

const MarkdownEditor = defineAsyncComponent(
  () => import('../editor/MarkdownEditor.vue'),
)
import { userFacingContent } from '../../workspace/message-markdown.js'
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
  createSession: []
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

const showActivity = shallowRef(false)
const conversationItems = computed(() =>
  [
    ...props.messages.map((message, index) => ({
      kind: 'message' as const,
      id: `message:${message.id}`,
      timestamp: message.createdAt,
      fallbackOrder: index * 2,
      message,
    })),
    ...(showActivity.value
      ? visibleAgentEvents(props.agentEvents)
      : props.agentEvents.filter(
          (event) =>
            event.type === 'run.failed' ||
            event.type === 'harness.disconnected',
        )
    ).map((event, index) => ({
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

function jumpToLatest(): void {
  followConversationTail.value = true
  void scrollToConversationTail(true)
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
    props.runActive ||
    Boolean(props.sendDisabledReason),
)

function requestSend(event?: KeyboardEvent): void {
  if (!event?.isComposing && !sendDisabled.value) emit('send')
}

function approvalReason(approval: ApprovalRequest): string {
  return approval.reason ?? 'Provider 未提供风险说明，请核对操作内容后决定。'
}
</script>

<template>
  <Panel class="agent-panel panel-surface">
    <template v-if="mode === 'chat'">
      <Box v-if="!session" class="conversation-empty">
        <Box class="conversation-orbit"><BrandMark class="conversation-logo" /></Box>
        <Heading as="h2"
        >
          创建或选择
          {{ harness === 'claude' ? 'Claude' : 'Codex' }} 会话
        </Heading
        >
        <Text as="p"
        >
          选择左侧会话继续工作，或新建会话，描述你的演示文稿需求。
        </Text
        >
        <Button
          variant="primary"
          class="empty-create"
          type="button"
          @click="emit('createSession')"
        >
          开始新会话
        </Button>
      </Box>
      <Box
        v-else
        ref="conversationStream"
        class="conversation-stream"
        @scroll.passive="updateConversationFollowState"
      >
        <Box class="session-heading">
          <Text as="strong">{{ session.title ?? session.preview }}</Text>
          <Text>
            {{
              runActive
                ? '正在处理…'
                : session.status === 'idle'
                  ? '就绪'
                  : session.status
            }}
          </Text>
        </Box>
        <Box class="conversation-toolbar">
          <Field>
            <TextField v-model="showActivity" type="checkbox" />显示执行过程 ·
            {{ visibleAgentEvents(agentEvents).length }}
          </Field
          ><Text v-if="runActive" role="status">Agent 正在工作</Text>
        </Box>
        <Disclosure v-if="runAudit" class="run-audit-card">
          <DisclosureTrigger
          >
            本次运行 Skill 审计 · {{ runAudit.status }}
          </DisclosureTrigger
          >
          <DescriptionList>
            <Box>
              <Term>主题</Term>
              <Description>{{ runAudit.themeId ?? '未解析' }}</Description>
            </Box>
            <Box>
              <Term>主题 Skill</Term>
              <Description>
                {{ runAudit.themeSkillId ?? '未解析' }}@{{
                  runAudit.themeSkillVersion ?? 'unknown'
                }}
              </Description>
            </Box>
            <Box>
              <Term>解析状态</Term>
              <Description>{{ runAudit.skillResolutionStatus }}</Description>
            </Box>
            <Box>
              <Term>调用状态</Term>
              <Description>{{ runAudit.invocationStatus }}</Description>
            </Box>
            <Box>
              <Term>调用机制</Term>
              <Description>
                {{
                  runAudit.invocationMechanism ?? '尚未记录'
                }}
              </Description>
            </Box>
            <Box>
              <Term>观察证据</Term>
              <Description>
                {{
                  runAudit.observationEvidence === null
                    ? 'Harness 未提供稳定观察证据'
                    : JSON.stringify(runAudit.observationEvidence)
                }}
              </Description>
            </Box>
          </DescriptionList>
        </Disclosure>
        <template v-for="entry in conversationItems" :key="entry.id">
          <Article
            v-if="entry.kind === 'message'"
            class="message-card"
            :class="`message-${entry.message.role}`"
          >
            <Header class="message-meta">
              <Text as="strong">
                {{
                  entry.message.role === 'user'
                    ? '你'
                    : entry.message.role === 'assistant'
                      ? harness === 'claude'
                        ? 'Claude'
                        : 'Codex'
                      : entry.message.role
                }}
              </Text>
              <Text v-if="entry.message.createdAt" as="time">
                {{
                  new Date(entry.message.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                }}
              </Text>
            </Header>
            <ConversationMessage
              :content="
                entry.message.role === 'user'
                  ? userFacingContent(entry.message.content)
                  : entry.message.content
              "
            />
          </Article>
          <Article
            v-else
            class="event-card"
            :class="`event-${eventKind(entry.event)}`"
          >
            <Text class="event-dot" aria-hidden="true"></Text>
            <Text as="small">{{ eventLabel(entry.event) }}</Text>
          </Article>
        </template>
        <Article
          v-for="approval in approvals"
          :key="approval.id"
          class="approval-card"
        >
          <Text as="strong">{{ approval.title }}</Text>
          <DescriptionList class="approval-context">
            <Box>
              <Term>Harness</Term>
              <Description>{{ approval.harness }}</Description>
            </Box>
            <Box>
              <Term>工作目录</Term>
              <Description>{{ approval.cwd ?? '未提供' }}</Description>
            </Box>
            <Box>
              <Term>影响文件</Term>
              <Description>
                {{
                  approval.affectedFiles.length
                    ? approval.affectedFiles.join(', ')
                    : '未提供'
                }}
              </Description>
            </Box>
            <Box>
              <Term>风险说明</Term>
              <Description>{{ approvalReason(approval) }}</Description>
            </Box>
          </DescriptionList>
          <Text v-if="approval.command" as="code">{{ approval.command }}</Text>
          <Box>
            <Button
              variant="secondary"
              type="button"
              @click="
                $emit('resolveApproval', {
                  approvalId: approval.id,
                  decision: 'reject',
                })
              "
            >
              拒绝
            </Button>
            <Button
              variant="secondary"
              type="button"
              @click="
                $emit('resolveApproval', {
                  approvalId: approval.id,
                  decision: 'approve',
                })
              "
            >
              允许一次
            </Button>
            <Button
              variant="secondary"
              type="button"
              @click="
                $emit('resolveApproval', {
                  approvalId: approval.id,
                  decision: 'approve-for-session',
                })
              "
            >
              本会话允许
            </Button>
          </Box>
        </Article>
      </Box>
      <Button
        v-if="!followConversationTail"
        variant="secondary"
        class="jump-to-latest"
        @click="jumpToLatest"
      >
        ↓ 回到最新消息
      </Button>
      <Footer class="composer-shell">
        <Box v-if="attachments.length" class="attachment-list">
          <Text v-for="attachment in attachments" :key="attachment.path">
            {{ attachment.name }} · {{ Math.ceil(attachment.size / 1024) }} KB
            <Button
              variant="secondary"
              type="button"
              :aria-label="`移除附件 ${attachment.name}`"
              @click="$emit('removeAttachment', attachment.path)"
            >
              ×
            </Button>
          </Text>
        </Box>
        <TextArea
          id="fastppt-message"
          name="message"
          :value="messageDraft"
          :disabled="composerDisabled"
          placeholder="输入演示文稿需求…"
          rows="3"
          @input="updateMessageDraft"
          @keydown.ctrl.enter.prevent="requestSend"
          @keydown.meta.enter.prevent="requestSend"
        ></TextArea>
        <Box v-if="sendDisabledReason" class="agent-error">
          发送已禁用：{{ sendDisabledReason }}
        </Box>
        <Box v-if="agentError" class="agent-error">{{ agentError }}</Box>
        <Box class="composer-meta">
          <Box class="composer-tools">
            <Field :class="{ disabled: attaching || attachments.length >= 4 }">
              <TextField
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                :disabled="attaching || attachments.length >= 4"
                @change="attachImage"
              />
              {{ attaching ? '上传中…' : '添加图片' }}
            </Field>
            <Text>Ctrl / ⌘ + Enter 发送</Text>
          </Box>
          <Button
            v-if="runActive"
            variant="secondary"
            type="button"
            @click="$emit('cancel')"
          >
            停止
          </Button>
          <Button
            v-else
            variant="primary"
            type="button"
            :disabled="sendDisabled"
            @click="requestSend()"
          >
            {{ sending ? '启动中…' : '发送' }}
          </Button>
        </Box>
      </Footer>
    </template>
    <MarkdownEditor
      v-else-if="selectedFile"
      :key="selectedFile.path"
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
    <Box v-else class="markdown-empty">
      从左侧文件树选择一个文本文件开始编辑。
    </Box>
  </Panel>
</template>

<style scoped>
.conversation-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 18px;
  color: var(--color-muted);
  font-size: 10px;
}
.conversation-toolbar label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.conversation-toolbar span {
  color: var(--color-accent-strong);
}
.jump-to-latest {
  position: absolute;
  bottom: 200px;
  left: 50%;
  z-index: 3;
}

.agent-panel {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}
h1,
h2,
p {
  margin: 0;
}
.conversation-empty,
.markdown-empty {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 12px;
  max-width: 420px;
  margin: auto;
  padding: 32px;
  color: var(--color-muted);
  text-align: center;
}
.conversation-stream {
  min-height: 0;
  padding: 16px clamp(16px, 2vw, 30px);
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
  width: min(94%, 760px);
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
  font-size: 11px;
  text-transform: uppercase;
}
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
  border-left-color: var(--color-warning);
}
.event-tool {
  border-left-color: var(--color-accent);
}
.event-file {
  border-left-color: var(--color-accent-strong);
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
  border-color: var(--color-border-strong);
  background: var(--color-warning-soft);
}
.approval-card code {
  display: block;
  margin-top: 8px;
  color: var(--color-warning);
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
  color: var(--color-warning);
  font-family: var(--font-mono);
}
.approval-card div {
  display: flex;
  gap: 7px;
  margin-top: 10px;
}
.conversation-empty h2 {
  color: var(--color-text);
  font-size: 19px;
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
  background: var(--color-selected);
  color: var(--color-accent-strong);
  font-size: 21px;
  font-weight: 800;
}
.conversation-orbit .conversation-logo {
  width: 40px;
  height: 40px;
}
.composer-shell {
  width: min(calc(100% - 36px), 820px);
  margin: 12px auto 20px;
  padding: 14px;
  border: 1px solid var(--color-border-strong);
  border-radius: 13px;
  background: var(--color-panel);
}
.composer-shell:focus-within {
  border-color: var(--color-accent-strong);
  box-shadow: var(--focus-ring);
}
.composer-shell textarea {
  width: 100%;
  resize: none;
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
  color: var(--color-accent-strong);
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

.empty-create {
  min-height: 34px;
}
.message-user {
  background: var(--color-selected);
}
.session-heading strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-secondary);
  font-size: 12px;
}
.session-heading > span {
  flex-shrink: 0;
}
@media (max-width: 600px) {
  .composer-tools > span {
    display: none;
  }
  .composer-shell {
    width: calc(100% - 20px);
    margin: 8px auto 10px;
    padding: 10px;
  }
  .conversation-stream {
    padding: 12px;
  }
  .conversation-empty {
    padding: 18px;
  }
}
</style>
