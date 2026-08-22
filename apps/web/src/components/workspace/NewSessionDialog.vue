<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'

import AppSelect, { type SelectOption } from '../AppSelect.vue'

import type {
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

const conversationModeOptions: readonly SelectOption[] = [
  { value: 'general', label: '普通对话' },
  { value: 'create-slide', label: '创建新 Slide' },
  { value: 'edit-deck', label: '更改现有 Slide 文档' },
]
const artifactRouteOptions: readonly SelectOption[] = [
  { value: 'generate', label: '新建演示文稿' },
  { value: 'edit-slidev', label: '编辑现有 Slidev' },
  { value: 'create-template', label: '创建主题或模板' },
  { value: 'fill-native-pptx', label: '填充原生 PPTX' },
  { value: 'enhance-native-pptx', label: '增强原生 PPTX' },
]
const intentOptions: readonly SelectOption[] = [
  { value: 'decision', label: '推动决策' },
  { value: 'instruction', label: '解释教学' },
  { value: 'persuasion', label: '故事说服' },
  { value: 'showcase', label: '视觉展示' },
  { value: 'briefing', label: '完整汇报' },
]
const narrativeOptions: readonly SelectOption[] = [
  { value: 'pyramid', label: 'Pyramid · 结论先行' },
  { value: 'instructional', label: 'Instructional · 分步教学' },
  { value: 'narrative', label: 'Narrative · 故事推进' },
  { value: 'showcase', label: 'Showcase · 视觉主导' },
  { value: 'briefing', label: 'Briefing · 完整陈列' },
]
const languageOptions: readonly SelectOption[] = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en-US', label: '英文' },
  { value: 'source', label: '跟随材料' },
]
const reviewOptions: readonly SelectOption[] = [
  { value: 'fast', label: '快速 · 硬性检查' },
  { value: 'standard', label: '标准 · 加视觉审查' },
  { value: 'strict', label: '严格 · 逐页检查' },
]
const markdownOptions = computed<readonly SelectOption[]>(() =>
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
  },
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
  <div v-if="open" class="dialog-backdrop" @click.self="emit('close')">
    <section class="session-dialog" role="dialog" aria-modal="true" aria-labelledby="new-session-title">
      <header>
        <div>
          <span class="eyebrow">{{ harness.toUpperCase() }} SESSION</span>
          <h2 id="new-session-title">新建演示文稿会话</h2>
        </div>
        <button type="button" class="close-button" aria-label="关闭" @click="emit('close')">×</button>
      </header>

      <div class="form-grid">
        <label>
          <span>对话类型</span>
          <AppSelect class="dialog-select" :value="conversationMode" :options="conversationModeOptions" @change="conversationMode = $event as SessionConversationMode" />
        </label>
        <label v-if="conversationMode === 'edit-deck'">
          <span>目标 Markdown</span>
          <AppSelect class="dialog-select" :value="targetMarkdown" :options="markdownOptions" placeholder="选择 Markdown 文件" @change="targetMarkdown = $event" />
        </label>
        <label>
          <span>会话名称</span>
          <input v-model="title" maxlength="120" />
        </label>
        <label>
          <span>任务类型</span>
          <AppSelect class="dialog-select" :value="artifactRoute" :options="artifactRouteOptions" @change="artifactRoute = $event as ArtifactRoute" />
        </label>
        <label>
          <span>目标受众</span>
          <input v-model="audience" maxlength="160" placeholder="例如：管理层、客户、学生" />
        </label>
        <label>
          <span>内容意图</span>
          <AppSelect class="dialog-select" :value="communicationIntent" :options="intentOptions" @change="communicationIntent = $event as CommunicationIntent" />
        </label>
        <label>
          <span>叙事模式</span>
          <AppSelect class="dialog-select" :value="narrativeMode" :options="narrativeOptions" @change="narrativeMode = $event as NarrativeMode" />
        </label>
        <label>
          <span>语言</span>
          <AppSelect class="dialog-select" :value="language" :options="languageOptions" @change="language = $event as 'zh-CN' | 'en-US' | 'source'" />
        </label>
        <label>
          <span>审查强度</span>
          <AppSelect class="dialog-select" :value="reviewPolicy" :options="reviewOptions" @change="reviewPolicy = $event as 'fast' | 'standard' | 'strict'" />
        </label>
      </div>

      <section class="theme-section">
        <div class="section-heading">
          <strong>主题</strong>
          <span>{{ preservesSourceTheme ? '保持源 PPTX 主题' : '必须显式选择，不自动继承最近主题' }}</span>
        </div>
        <div v-if="preservesSourceTheme" class="preserve-card">保持源 PPTX 的母版、布局和视觉结构</div>
        <div v-else class="theme-grid">
          <button
            v-for="theme in themes"
            :key="theme.themeId"
            type="button"
            class="theme-card"
            :class="{ selected: themeId === theme.themeId }"
            :disabled="!theme.available"
            @click="themeId = theme.themeId"
          >
            <strong>{{ theme.displayName }}</strong>
            <span>{{ theme.description }}</span>
            <small>{{ theme.layouts.length }} 个布局 · {{ theme.skillId }}@{{ theme.skillVersion }}</small>
          </button>
        </div>
      </section>

      <footer>
        <button type="button" class="secondary" @click="emit('close')">取消</button>
        <button type="button" class="primary" :disabled="!canSubmit" @click="submit">
          {{ submitting ? '创建中…' : '创建会话' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 24px; background: rgb(5 10 20 / 0.72); backdrop-filter: blur(8px); }
.session-dialog { width: min(880px, 100%); max-height: calc(100vh - 48px); overflow: auto; border: 1px solid var(--color-border); border-radius: 18px; background: var(--color-panel); box-shadow: 0 28px 80px rgb(0 0 0 / 0.42); }
header, footer { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; }
header { border-bottom: 1px solid var(--color-border); }
footer { justify-content: flex-end; gap: 10px; border-top: 1px solid var(--color-border); }
h2 { margin: 4px 0 0; font-size: 1.25rem; }
.eyebrow { color: var(--color-muted); font-size: 0.68rem; letter-spacing: 0.12em; }
.close-button { border: 0; background: transparent; color: var(--color-muted); font-size: 1.5rem; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding: 22px 24px 12px; }
label { display: grid; gap: 7px; color: var(--color-muted); font-size: 0.78rem; }
input { min-width: 0; border: 1px solid var(--color-border); border-radius: 9px; padding: 10px 11px; background: var(--color-panel-raised); color: var(--color-text); }
.dialog-select { width: 100%; max-width: none; min-height: 39px; }
.theme-section { padding: 12px 24px 24px; }
.section-heading { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.section-heading span { color: var(--color-muted); font-size: 0.75rem; }
.theme-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.theme-card, .preserve-card { display: grid; gap: 5px; min-width: 0; padding: 14px; border: 1px solid var(--color-border); border-radius: 11px; background: var(--color-panel-raised); color: var(--color-text); text-align: left; }
.theme-card span, .theme-card small { color: var(--color-muted); overflow-wrap: anywhere; }
.theme-card.selected { border-color: var(--color-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 24%, transparent); }
footer button { border-radius: 9px; padding: 9px 16px; }
.secondary { border: 1px solid var(--color-border); background: transparent; color: var(--color-text); }
.primary { border: 1px solid var(--color-accent); background: var(--color-accent); color: #07100d; }
button:disabled { cursor: not-allowed; opacity: 0.45; }
@media (max-width: 720px) { .form-grid, .theme-grid { grid-template-columns: 1fr; } .section-heading { display: grid; } }
</style>
