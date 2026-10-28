<script setup lang="ts">
import {
  Panel,
  Modal,
  Box,
  Button,
  Field,
  Footer,
  Header,
  Heading,
  Text,
  TextField,
} from '@fastppt/components'
import { computed, shallowRef, watch } from 'vue'

import { Select as AppSelect, type SelectItem } from '@fastppt/components'

import { wizardRoute } from '../../workspace/creation-wizard.js'
import type {
  CreationWizard,
  ArtifactRoute,
  CommunicationIntent,
  HarnessKind,
  NarrativeMode,
  SessionDeckProfile,
  SessionConversationMode,
  ThemeSummary,
} from '@fastppt/protocol'
import type { DeepReadonly } from 'vue'

const props = defineProps<{
  open: boolean
  wizard?: CreationWizard | undefined
  error?: string | undefined
  harness: HarnessKind
  themes: readonly DeepReadonly<ThemeSummary>[]
  submitting: boolean
  markdownPaths: readonly string[]
}>()

const emit = defineEmits<{
  close: []
  submit: [input: { title: string; profile: SessionDeckProfile }]
}>()

const title = shallowRef('FastPPT 演示文稿')
const conversationMode = shallowRef<SessionConversationMode>('create-slide')
const targetMarkdown = shallowRef<string>()
const artifactRoute = shallowRef<ArtifactRoute>('generate')
const audience = shallowRef('通用受众')
const communicationIntent = shallowRef<CommunicationIntent>('decision')
const narrativeMode = shallowRef<NarrativeMode>('pyramid')
const language = shallowRef<'zh-CN' | 'en-US' | 'source'>('zh-CN')
const themeId = shallowRef<string>()
const reviewPolicy = shallowRef<'fast' | 'standard' | 'strict'>('standard')

const conversationModeOptions: readonly SelectItem[] = [
  { value: 'general', label: '普通对话' },
  { value: 'create-slide', label: '创建新 Slide' },
  { value: 'edit-deck', label: '更改现有 Slide 文档' },
]
const artifactRouteOptions: readonly SelectItem[] = [
  { value: 'generate', label: '新建演示文稿' },
  { value: 'edit-slidev', label: '编辑现有 Slidev' },
  { value: 'create-template', label: '创建主题或模板' },
  { value: 'fill-native-pptx', label: '填充原生 PPTX' },
  { value: 'enhance-native-pptx', label: '增强原生 PPTX' },
]
const intentOptions: readonly SelectItem[] = [
  { value: 'decision', label: '推动决策' },
  { value: 'instruction', label: '解释教学' },
  { value: 'persuasion', label: '故事说服' },
  { value: 'showcase', label: '视觉展示' },
  { value: 'briefing', label: '完整汇报' },
]
const narrativeOptions: readonly SelectItem[] = [
  { value: 'pyramid', label: 'Pyramid · 结论先行' },
  { value: 'instructional', label: 'Instructional · 分步教学' },
  { value: 'narrative', label: 'Narrative · 故事推进' },
  { value: 'showcase', label: 'Showcase · 视觉主导' },
  { value: 'briefing', label: 'Briefing · 完整陈列' },
]
const languageOptions: readonly SelectItem[] = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en-US', label: '英文' },
  { value: 'source', label: '跟随材料' },
]
const reviewOptions: readonly SelectItem[] = [
  { value: 'fast', label: '快速 · 硬性检查' },
  { value: 'standard', label: '标准 · 加视觉审查' },
  { value: 'strict', label: '严格 · 逐页检查' },
]
const markdownOptions = computed<readonly SelectItem[]>(() =>
  props.markdownPaths.map((path) => ({ value: path, label: path })),
)

const modeByIntent: Record<CommunicationIntent, NarrativeMode> = {
  decision: 'pyramid',
  instruction: 'instructional',
  persuasion: 'narrative',
  showcase: 'showcase',
  briefing: 'briefing',
}

watch(communicationIntent, (intent) => {
  narrativeMode.value = modeByIntent[intent]
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    themeId.value = undefined
    if (props.wizard) {
      artifactRoute.value = wizardRoute(props.wizard)
      conversationMode.value =
        artifactRoute.value === 'edit-slidev' ? 'edit-deck' : 'create-slide'
    }
  },
  { immediate: true },
)

const preservesSourceTheme = computed(() =>
  ['fill-native-pptx', 'enhance-native-pptx'].includes(artifactRoute.value),
)
const canSubmit = computed(
  () =>
    Boolean(title.value.trim() && audience.value.trim()) &&
    (conversationMode.value !== 'edit-deck' || Boolean(targetMarkdown.value)) &&
    (preservesSourceTheme.value || Boolean(themeId.value)) &&
    !props.submitting,
)

function submit(): void {
  if (!canSubmit.value) return
  const preserve = preservesSourceTheme.value
  emit('submit', {
    title: title.value.trim(),
    profile: {
      version: 1,
      conversationMode: conversationMode.value,
      ...(conversationMode.value === 'edit-deck' && targetMarkdown.value
        ? { target: { markdownPath: targetMarkdown.value } }
        : {}),
      artifactRoute: artifactRoute.value,
      audience: audience.value.trim(),
      communicationIntent: communicationIntent.value,
      narrativeMode: narrativeMode.value,
      language: language.value,
      theme: preserve
        ? { mode: 'preserve-source' }
        : { mode: 'registered', themeId: themeId.value! },
      preservation: {
        wording: preserve ? 'preserve' : 'free',
        pageCount: preserve ? 'preserve' : 'free',
        pageOrder: preserve ? 'preserve' : 'free',
        visualStructure: preserve ? 'preserve' : 'free',
      },
      reviewPolicy: reviewPolicy.value,
    },
  })
}
</script>

<template>
  <Modal
    :open="open"
    :dismissible="!submitting"
    size="lg"
    labelledby="new-session-title"
    class="session-dialog"
    @close="emit('close')"
  >
    <Header>
      <Box>
        <Text class="eyebrow">{{ harness.toUpperCase() }} SESSION</Text>
        <Heading id="new-session-title" as="h2">新建演示文稿会话</Heading>
        <Text v-if="wizard" as="p">向导决策已保存，请确认主题和会话配置。</Text>
        <Text v-if="error" as="p" role="alert">{{ error }}</Text>
      </Box>
      <Button
        variant="icon"
        type="button"
        class="close-button"
        :disabled="submitting"
        aria-label="关闭"
        @click="emit('close')"
      >
        ×
      </Button>
    </Header>

    <Box class="form-grid">
      <Field>
        <Text>对话类型</Text>
        <AppSelect
          class="dialog-select"
          :value="conversationMode"
          :options="conversationModeOptions"
          @change="conversationMode = $event as SessionConversationMode"
        />
      </Field>
      <Field v-if="conversationMode === 'edit-deck'">
        <Text>目标 Markdown</Text>
        <AppSelect
          class="dialog-select"
          :value="targetMarkdown"
          :options="markdownOptions"
          placeholder="选择 Markdown 文件"
          @change="targetMarkdown = $event"
        />
      </Field>
      <Field>
        <Text>会话名称</Text>
        <TextField v-model="title" maxlength="120" />
      </Field>
      <Field>
        <Text>任务类型</Text>
        <AppSelect
          class="dialog-select"
          :disabled="
            wizard?.decisions.some((d) => d.stepId === 'task' && d.locked) ??
              false
          "
          :value="artifactRoute"
          :options="artifactRouteOptions"
          @change="artifactRoute = $event as ArtifactRoute"
        />
      </Field>
      <Field>
        <Text>目标受众</Text>
        <TextField
          v-model="audience"
          maxlength="160"
          placeholder="例如：管理层、客户、学生"
        />
      </Field>
      <Field>
        <Text>内容意图</Text>
        <AppSelect
          class="dialog-select"
          :value="communicationIntent"
          :options="intentOptions"
          @change="communicationIntent = $event as CommunicationIntent"
        />
      </Field>
      <Field>
        <Text>叙事模式</Text>
        <AppSelect
          class="dialog-select"
          :value="narrativeMode"
          :options="narrativeOptions"
          @change="narrativeMode = $event as NarrativeMode"
        />
      </Field>
      <Field>
        <Text>语言</Text>
        <AppSelect
          class="dialog-select"
          :value="language"
          :options="languageOptions"
          @change="language = $event as 'zh-CN' | 'en-US' | 'source'"
        />
      </Field>
      <Field>
        <Text>审查强度</Text>
        <AppSelect
          class="dialog-select"
          :value="reviewPolicy"
          :options="reviewOptions"
          @change="reviewPolicy = $event as 'fast' | 'standard' | 'strict'"
        />
      </Field>
    </Box>

    <Panel class="theme-section">
      <Box class="section-heading">
        <Text as="strong">主题</Text>
        <Text>
          {{
            preservesSourceTheme
              ? '保持源 PPTX 主题'
              : '必须显式选择，不自动继承最近主题'
          }}
        </Text>
      </Box>
      <Box v-if="preservesSourceTheme" class="preserve-card">
        保持源 PPTX 的母版、布局和视觉结构
      </Box>
      <Box v-else class="theme-grid">
        <Button
          v-for="theme in themes"
          :key="theme.themeId"
          variant="quiet"
          type="button"
          class="theme-card"
          :class="{ selected: themeId === theme.themeId }"
          :disabled="!theme.available"
          @click="themeId = theme.themeId"
        >
          <Text as="strong">{{ theme.displayName }}</Text>
          <Text>{{ theme.description }}</Text>
          <Text as="small">
            {{ theme.layouts.length }} 个布局 · {{ theme.skillId }}@{{
              theme.skillVersion
            }}
          </Text>
        </Button>
      </Box>
    </Panel>

    <Footer>
      <Button
        size="md"
        variant="secondary"
        type="button"
        class="secondary"
        :disabled="submitting"
        @click="emit('close')"
      >
        取消
      </Button>
      <Button
        size="md"
        variant="primary"
        type="button"
        class="primary"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ submitting ? '创建中…' : '创建会话' }}
      </Button>
    </Footer>
  </Modal>
</template>

<style scoped>
header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
}
header {
  border-bottom: 1px solid var(--color-border);
}
footer {
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid var(--color-border);
}
h2 {
  margin: 4px 0 0;
  font-size: 1.25rem;
}
.eyebrow {
  color: var(--color-muted);
  font-size: 0.68rem;
  letter-spacing: 0.12em;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 22px 24px 12px;
}
label {
  display: grid;
  gap: 7px;
  color: var(--color-muted);
  font-size: 0.78rem;
}
input {
  min-width: 0;
}
.dialog-select {
  width: 100%;
  max-width: none;
  min-height: 39px;
}
.theme-section {
  padding: 12px 24px 24px;
}
.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.section-heading span {
  color: var(--color-muted);
  font-size: 0.75rem;
}
.theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.theme-card {
  justify-content: stretch;
}
.theme-card,
.preserve-card {
  display: grid;
  gap: 5px;
  min-width: 0;
  text-align: left;
}
.theme-card span,
.theme-card small {
  color: var(--color-muted);
  overflow-wrap: anywhere;
}
@media (max-width: 720px) {
  .form-grid,
  .theme-grid {
    grid-template-columns: 1fr;
  }
  .section-heading {
    display: grid;
  }
}
</style>
