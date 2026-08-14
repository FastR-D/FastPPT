<script setup lang="ts">
import { computed, ref } from 'vue'

import type { ImportPptxThemeResult } from '@fastppt/protocol'
import type { ImportPptxThemeStatus } from '@fastppt/protocol'

import { useGatewayClient } from '../../api/useGatewayClient'

const emit = defineEmits<{ imported: [theme: ImportPptxThemeResult] }>()

const client = useGatewayClient()
const file = ref<File>()
const themeName = ref('')
const status = ref<'idle' | 'importing' | 'success' | 'error'>('idle')
const monitoring = ref(false)
const result = ref<ImportPptxThemeResult>()
const error = ref('')
const pipeline = ref<ImportPptxThemeStatus>()
const pipelineWarning = ref('')

const stageProgress = computed(() => {
  const stages = ['extracting', 'designing', 'syncing', 'validating', 'ready']
  const index = stages.indexOf(pipeline.value?.stage ?? 'extracting')
  return index < 0 ? 0 : ((index + 1) / stages.length) * 100
})

async function waitForDesign(themeId: string): Promise<void> {
  const deadline = Date.now() + 270_000
  let delay = 1_000
  while (Date.now() < deadline) {
    try {
      const statusResult = await client.getThemeImportStatus(themeId)
      pipeline.value = statusResult
      if (statusResult.stage === 'failed') {
        pipelineWarning.value =
          statusResult.error ?? '基础主题已保留，但特色设计未完成。'
        return
      }
      if (statusResult.stage === 'ready') return
    } catch (cause) {
      if (pipeline.value?.stage === 'failed') throw cause
      /* transient request failure — keep polling */
    }
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(3_000, delay + 500)
  }
  pipelineWarning.value = '特色设计仍在后台继续，可稍后在主题目录查看结果。'
}

function onFileChange(event: Event): void {
  const target = event.target as HTMLInputElement
  file.value = target.files?.[0]
  status.value = 'idle'
  result.value = undefined
  pipeline.value = undefined
  pipelineWarning.value = ''
}

function readFileAsBase64(input: File): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      resolvePromise(dataUrl.split(',')[1] ?? '')
    }
    reader.onerror = () => rejectPromise(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(input)
  })
}

async function importTheme(): Promise<void> {
  if (!file.value) return
  status.value = 'importing'
  error.value = ''
  pipelineWarning.value = ''
  pipeline.value = {
    themeId: 'pending',
    stage: 'extracting',
    designing: false,
    layouts: [],
    components: [],
    message: '正在读取 PPTX 并提取颜色、字体和版式特征。',
  }
  monitoring.value = true
  try {
    const dataBase64 = await readFileAsBase64(file.value)
    result.value = await client.importPptxTheme(
      file.value.name,
      dataBase64,
      themeName.value.trim() || undefined,
    )
    if (result.value.designing) {
      await waitForDesign(result.value.themeId)
    }
    status.value = 'success'
    emit('imported', result.value)
  } catch (cause) {
    status.value = 'error'
    error.value = cause instanceof Error ? cause.message : '导入失败'
  } finally {
    monitoring.value = false
  }
}
</script>

<template>
  <section class="theme-import">
    <h2>导入 PPTX 主题</h2>
    <p class="hint">
      上传一个现有 PPTX，FastPPT 会解析实际颜色节点与字体，生成基础主题，再由 harness 设计特色布局、同步 Skill 并完成构建校验。
    </p>

    <div class="import-form">
      <label class="file-label" :class="{ has: file }">
        <input type="file" accept=".pptx" @change="onFileChange" />
        {{ file ? file.name : '选择 .pptx 文件' }}
      </label>
      <input
        v-model="themeName"
        class="name-input"
        placeholder="主题名称（可选，将生成 slug）"
      />
      <button
        type="button"
        :disabled="!file || status === 'importing'"
        @click="importTheme"
      >
        {{ status === 'importing' ? '提取中…' : '导入主题' }}
      </button>
    </div>

    <p v-if="status === 'success'" class="ok">
      ✓ 已导入主题 <strong>{{ result?.displayName }}</strong>（{{
        result?.themeId
      }}），它已出现在主题目录中。
    </p>
    <p v-if="status === 'success' && result?.designing" class="hint designing">
      {{ pipeline?.message ?? 'harness 正在设计特色布局与组件…' }}
    </p>
    <p v-if="monitoring" class="hint designing">
      {{ pipeline?.message ?? '正在准备导入…' }}
    </p>
    <div v-if="status === 'importing'" class="pipeline-progress" aria-hidden="true">
      <span :style="{ width: `${stageProgress}%` }"></span>
    </div>
    <p v-if="pipelineWarning" class="warning">
      基础主题已成功生成。{{ pipelineWarning }}
    </p>
    <p v-if="status === 'error'" class="error">{{ error }}</p>
  </section>
</template>

<style scoped>
.theme-import {
  min-width: 0;
  min-height: 0;
  padding: 28px;
  overflow: auto;
}

.theme-import h2 {
  margin: 0 0 8px;
  font-size: 18px;
}

.hint {
  margin: 0 0 20px;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.6;
  max-width: 52ch;
}

.import-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  max-width: 720px;
}

.file-label {
  display: inline-flex;
  align-items: center;
  padding: 9px 16px;
  border: 1px dashed var(--color-border-strong);
  border-radius: 9px;
  background: var(--color-panel-raised);
  color: var(--color-muted);
  font-size: 13px;
  cursor: pointer;
}

.file-label.has {
  border-style: solid;
  border-color: var(--color-accent);
  color: var(--color-text);
}

.file-label input {
  display: none;
}

.name-input {
  flex: 1 1 220px;
  min-width: 0;
  padding: 9px 12px;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  background: var(--color-panel-raised);
  color: var(--color-text);
  font-size: 13px;
}

button {
  padding: 9px 18px;
  border: 1px solid var(--color-accent);
  border-radius: 9px;
  background: var(--color-accent);
  color: #071612;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ok {
  margin: 18px 0 0;
  color: var(--color-accent);
  font-size: 13px;
}

.error {
  margin: 18px 0 0;
  color: #ff9f8f;
  font-size: 13px;
}

.warning {
  margin: 18px 0 0;
  color: #f4c36a;
  font-size: 13px;
}

.pipeline-progress {
  width: min(520px, 100%);
  height: 4px;
  margin-top: -8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-border);
}

.pipeline-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-accent);
  transition: width 240ms ease;
}
</style>
