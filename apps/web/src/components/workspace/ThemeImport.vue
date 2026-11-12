<script setup lang="ts">
import {
  Box,
  Button,
  Disclosure,
  DisclosureTrigger,
  Field,
  Fieldset,
  Heading,
  Legend,
  List,
  ListItem,
  Panel,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  TextField,
} from '@fastrd/ui-vue'
import { computed, onMounted, ref } from 'vue'

import type { ImportAnalysisV1, ImportPptxThemeResult } from '@fastppt/protocol'
import type {
  ImportPptxThemeStatus,
  ThemeRuleApprovalReport,
} from '@fastppt/protocol'

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
const analysis = ref<ImportAnalysisV1>()
const selectedLayouts = ref<string[]>([])
const importStrategy = ref<'tokens' | 'mirror' | 'fidelity' | 'standard'>(
  'standard',
)
const preserveReference = ref(true)
const savingDecisions = ref(false)
const ruleReview = ref<ThemeRuleApprovalReport | null>(null)
const registered = ref(false)
function selectable(
  layout: ImportAnalysisV1['candidateLayouts'][number],
): boolean {
  return (
    (!layout.generated || layout.generated.status === 'complete') &&
    !layout.semanticEvidence.some(
      (evidence) =>
        evidence.kind === 'reachable-layout' && evidence.value === 'false',
    )
  )
}
const restoredJob = ref<{
  status?: string
  themeId?: string
  decisions?: Array<{ stepId?: string; selected?: string }>
}>()
const recentJobs = ref<
  Array<{ id?: string; status?: string; themeId?: string; updatedAt?: string }>
>([])

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
  ruleReview.value = null
  registered.value = false
  pipeline.value = undefined
  analysis.value = undefined
  selectedLayouts.value = []
  pipelineWarning.value = ''
}

function readFileAsBase64(input: File): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      resolvePromise(dataUrl.split(',')[1] ?? '')
    }
    reader.onerror = () =>
      rejectPromise(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(input)
  })
}

async function importTheme(): Promise<void> {
  if (!file.value) return
  status.value = 'importing'
  ruleReview.value = null
  registered.value = false
  result.value = undefined
  analysis.value = undefined
  selectedLayouts.value = []
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
    localStorage.setItem('fastppt:last-pptx-import-job', result.value.jobId)
    if (result.value.designing) {
      await waitForDesign(result.value.themeId)
    }
    analysis.value = await client.getThemeImportAnalysis(result.value.themeId)
    selectedLayouts.value = analysis.value.candidateLayouts
      .filter(selectable)
      .map((layout) => layout.id)
    status.value = 'success'
    if (!analysis.value) emit('imported', result.value)
  } catch (cause) {
    status.value = 'error'
    error.value = cause instanceof Error ? cause.message : '导入失败'
  } finally {
    monitoring.value = false
  }
}

async function saveDecisions(): Promise<void> {
  if (!result.value || savingDecisions.value || registered.value) return
  if (importStrategy.value === 'standard' && !selectedLayouts.value.length) {
    error.value = '请选择至少一个可用布局，或改为只提取颜色和字体。'
    return
  }
  savingDecisions.value = true
  error.value = ''
  const timestamp = new Date().toISOString()
  const decisions = [
    {
      version: 1 as const,
      stepId: 'strategy',
      question: '导入策略',
      options: ['tokens', 'mirror', 'fidelity', 'standard'],
      selected: importStrategy.value,
      actor: 'user' as const,
      locked: true,
      timestamp,
    },
    {
      version: 1 as const,
      stepId: 'preserve-reference',
      question: '保留源 PPTX 作为 reference',
      options: ['keep', 'skip'],
      selected: preserveReference.value ? 'keep' : 'skip',
      actor: 'user' as const,
      locked: true,
      timestamp,
    },
    ...(analysis.value?.candidateLayouts ?? []).map((layout) => ({
      version: 1 as const,
      stepId: `layout:${layout.id}`,
      question: '注册此布局',
      options: ['keep', 'skip'],
      selected: selectedLayouts.value.includes(layout.id) ? 'keep' : 'skip',
      actor: 'user' as const,
      locked: true,
      timestamp,
    })),
  ]
  try {
    await client.saveThemeImportDecisions(result.value.themeId, decisions)
    await client.approveThemeImport(result.value.themeId)
    registered.value = true
    ruleReview.value = await client.getThemeImportRuleReview(
      result.value.themeId,
    )
    if (!ruleReview.value)
      error.value = '主题已注册，暂时无法读取规则审查报告。'
    else if (!ruleReview.value.issues.length) emit('imported', result.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存或审批失败'
    if (!registered.value)
      ruleReview.value = await client
        .getThemeImportRuleReview(result.value.themeId)
        .catch(() => null)
  } finally {
    savingDecisions.value = false
  }
}
onMounted(async () => {
  const jobId = localStorage.getItem('fastppt:last-pptx-import-job')
  try {
    if (jobId) {
      const job = await client.getPptxImportJob(jobId)
      if (job && typeof job === 'object') {
        restoredJob.value = job
        const themeId = restoredJob.value.themeId
        if (themeId && themeId !== 'pending') {
          const slug = themeId.replace(/^slidev-theme-/, '')
          result.value = {
            jobId,
            themeId,
            displayName: slug,
            packageName: themeId,
            skillId: `fastppt-theme-${slug}`,
            version: 'recovered',
            slug,
            designing: restoredJob.value.status === 'designing',
          }
          status.value = 'success'
        }
        for (const decision of restoredJob.value.decisions ?? []) {
          if (
            decision.stepId === 'strategy' &&
            (decision.selected === 'tokens' ||
              decision.selected === 'mirror' ||
              decision.selected === 'fidelity' ||
              decision.selected === 'standard')
          )
            importStrategy.value = decision.selected
          if (
            decision.stepId === 'strategy' &&
            decision.selected === 'editable'
          )
            importStrategy.value = 'standard'
          if (
            decision.stepId === 'strategy' &&
            decision.selected === 'reference'
          )
            importStrategy.value = 'mirror'
          if (decision.stepId === 'preserve-reference')
            preserveReference.value = decision.selected !== 'skip'
        }
        if (themeId && themeId !== 'pending') {
          pipeline.value = await client
            .getThemeImportStatus(themeId)
            .catch(() => undefined)
          analysis.value = await client
            .getThemeImportAnalysis(themeId)
            .catch(() => undefined)
          ruleReview.value = await client
            .getThemeImportRuleReview(themeId)
            .catch(() => null)
          registered.value = restoredJob.value.status === 'approved'
          if (analysis.value) {
            const layoutDecisions = new Map(
              (restoredJob.value.decisions ?? [])
                .filter((decision) => decision.stepId?.startsWith('layout:'))
                .map((decision) => [
                  decision.stepId!.slice('layout:'.length),
                  decision.selected,
                ]),
            )
            selectedLayouts.value = analysis.value.candidateLayouts
              .filter(
                (layout) =>
                  selectable(layout) &&
                  layoutDecisions.get(layout.id) !== 'skip',
              )
              .map((layout) => layout.id)
          }
        }
      }
    }
    const jobs = await client.listPptxImportJobs()
    recentJobs.value = jobs
      .filter(
        (
          job,
        ): job is {
          id?: string
          status?: string
          themeId?: string
          updatedAt?: string
        } => typeof job === 'object' && job !== null,
      )
      .slice(0, 5)
  } catch {
    /* stale local storage entry */
  }
})
</script>

<template>
  <Panel class="theme-import">
    <Heading as="h2">导入 PPTX 主题</Heading>
    <Text as="p" class="hint">
      上传一个现有 PPTX，FastPPT 会解析实际颜色节点与字体，生成基础主题，再由
      harness 设计特色布局、同步 Skill 并完成构建校验。
    </Text>

    <Box class="import-form">
      <Field class="file-label" :class="{ has: file }">
        <TextField type="file" accept=".pptx" @change="onFileChange" />
        {{ file ? file.name : '选择 .pptx 文件' }}
      </Field>
      <TextField
        v-model="themeName"
        class="name-input"
        placeholder="主题名称（可选，将生成 slug）"
      />
      <Button
        variant="secondary"
        type="button"
        :disabled="!file || status === 'importing'"
        @click="importTheme"
      >
        {{ status === 'importing' ? '提取中…' : '导入主题' }}
      </Button>
    </Box>

    <Text v-if="registered" as="p" class="ok"
    >
      ✓ 主题已注册。以下规则问题仍需在创作文稿或视觉验收时处理。
    </Text
    >
    <Text v-else-if="status === 'success'" as="p" class="ok">
      ✓ 已生成主题草稿 <Text as="strong">{{ result?.displayName }}</Text
      >（{{ result?.themeId }}），审批后才会注册到主题目录。
    </Text>
    <Text
      v-if="status === 'success' && result?.designing"
      as="p"
      class="hint designing"
    >
      {{ pipeline?.message ?? 'harness 正在设计特色布局与组件…' }}
    </Text>
    <Text v-if="monitoring" as="p" class="hint designing">
      {{ pipeline?.message ?? '正在准备导入…' }}
    </Text>
    <Box
      v-if="status === 'importing'"
      class="pipeline-progress"
      aria-hidden="true"
    >
      <Text :style="{ width: `${stageProgress}%` }"></Text>
    </Box>
    <Text v-if="pipelineWarning" as="p" class="warning">
      基础主题已成功生成。{{ pipelineWarning }}
    </Text>
    <Text v-if="error" as="p" class="error" role="alert">{{ error }}</Text>
    <Panel v-if="ruleReview" class="analysis-panel" aria-label="导入规则审查">
      <Heading as="h3"
      >
        模板规则审查 ·
        {{ ruleReview.valid ? '无阻断错误' : '未通过' }}
      </Heading
      >
      <Text as="p" class="hint"
      >
        检查已选布局的结构能力；页数和实际排版需要在文稿中继续验证。
      </Text
      >
      <List
      >
        <ListItem v-for="(issue, index) in ruleReview.issues" :key="index"
        >
          <Text as="strong">{{ issue.ruleId }}</Text> · {{ issue.severity }} ·
          {{ issue.message
          }}<Text v-if="issue.source" as="p">来源：{{ issue.source }}</Text
          ><Text v-if="issue.suggestedFix" as="p">
            {{
              issue.suggestedFix
            }}
          </Text>
        </ListItem
        >
      </List
      >
      <Button
        v-if="registered && result"
        variant="secondary"
        type="button"
        @click="emit('imported', result)"
      >
        返回工作区
      </Button
      >
    </Panel>
    <Button
      v-if="registered && result && !ruleReview"
      variant="secondary"
      type="button"
      @click="emit('imported', result)"
    >
      返回工作区
    </Button
    >
    <Text v-if="restoredJob" as="p" class="hint"
    >
      已恢复上次导入任务：{{ restoredJob.status
      }}<Text v-if="restoredJob.themeId && restoredJob.themeId !== 'pending'"
      >
        （{{ restoredJob.themeId }}）
      </Text
      >
    </Text
    >
    <Box v-if="recentJobs.length" class="recent-jobs">
      <Text as="strong">最近导入任务</Text>
      <Box v-for="job in recentJobs" :key="job.id" class="recent-job"
      >
        <Text as="code">{{ job.themeId ?? 'pending' }}</Text
        ><Text>{{ job.status }}</Text
        ><Text as="small">
          {{
            job.updatedAt ? new Date(job.updatedAt).toLocaleString() : ''
          }}
        </Text>
      </Box
      >
    </Box>
    <Panel v-if="analysis" class="analysis-panel">
      <Heading as="h3">导入分析与布局决策</Heading>
      <Text as="p" class="hint"
      >
        先选择导入策略和要注册的布局；审批前不会污染主题目录。
      </Text
      >
      <Disclosure v-if="analysis.sourceGraph" class="source-graph" open>
        <DisclosureTrigger
        >
          来源关系 · {{ analysis.sourceGraph.slides.length }} 页 /
          {{ analysis.sourceGraph.masters.length }} 个母版
        </DisclosureTrigger
        >
        <Text as="p" class="hint"
        >
          以下关系直接来自源
          PPTX；关系已解析不代表布局重建或应用兼容性已经验证。
        </Text
        >
        <Text as="p"
        >
          文档入口：<Text as="code">
            {{
              analysis.sourceGraph.presentationPart
            }}
          </Text>
        </Text
        >
        <Box class="source-table-scroll">
          <Table>
            <TableCaption>源页面顺序与继承关系</TableCaption>
            <TableHead
            >
              <TableRow
              >
                <TableHeader>页</TableHeader><TableHeader>页面</TableHeader
                ><TableHeader>布局</TableHeader><TableHeader>母版</TableHeader
                ><TableHeader>主题</TableHeader
                ><TableHeader>备注</TableHeader>
              </TableRow
              >
            </TableHead
            >
            <TableBody>
              <TableRow
                v-for="page in analysis.sourceGraph.slides"
                :key="`${page.index}:${page.part}`"
              >
                <TableCell>{{ page.index }}</TableCell
                ><TableCell
                >
                  <Text as="code">{{ page.part }}</Text>
                </TableCell
                >
                <TableCell
                >
                  <Text as="code">
                    {{
                      page.layout ?? '未解析'
                    }}
                  </Text>
                </TableCell
                ><TableCell
                >
                  <Text as="code">
                    {{
                      page.master ?? '未解析'
                    }}
                  </Text>
                </TableCell
                >
                <TableCell
                >
                  <Text as="code">
                    {{
                      page.theme ?? '未解析'
                    }}
                  </Text>
                </TableCell
                ><TableCell>{{ page.notes ?? '无关联备注' }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Box>
        <Disclosure
          v-for="master in analysis.sourceGraph.masters"
          :key="master.part"
          class="source-master"
        >
          <DisclosureTrigger
          >
            {{ master.part }} ·
            {{ master.layouts.length }} 个注册布局
          </DisclosureTrigger
          >
          <Text as="p"
          >
            主题：<Text as="code">{{ master.theme ?? '未解析' }}</Text>
          </Text
          >
          <List
          >
            <ListItem v-for="layout in master.layouts" :key="layout"
            >
              <Text as="code">{{ layout }}</Text>
            </ListItem
            >
          </List
          >
        </Disclosure>
      </Disclosure>
      <Text v-else as="p" class="hint"
      >
        此历史分析未保存来源关系，可重新分析源 PPTX 获取。
      </Text
      >
      <Fieldset class="strategy-group" :disabled="registered || savingDecisions"
      >
        <Legend>导入策略</Legend
        ><Field
        >
          <TextField
            v-model="importStrategy"
            type="radio"
            value="tokens"
          />只提取颜色、字体和来源 token
        </Field
        ><Field
        >
          <TextField
            v-model="importStrategy"
            type="radio"
            value="mirror"
          />保留源 PPTX，生成对照布局
        </Field
        ><Field
        >
          <TextField
            v-model="importStrategy"
            type="radio"
            value="fidelity"
          />以源页为视觉基准，记录降级
        </Field
        ><Field
        >
          <TextField
            v-model="importStrategy"
            type="radio"
            value="standard"
          />注册已审查的可编辑主题
        </Field
        >
      </Fieldset
      >
      <Field class="reference-toggle"
      >
        <TextField
          v-model="preserveReference"
          type="checkbox"
          :disabled="registered || savingDecisions"
        />保留源 PPTX 作为 reference
      </Field
      >
      <Box
        v-for="layout in analysis.candidateLayouts"
        :key="layout.id"
        class="candidate-block"
      >
        <Field class="analysis-row">
          <TextField
            v-model="selectedLayouts"
            type="checkbox"
            :value="layout.id"
            :disabled="!selectable(layout) || savingDecisions || registered"
          />
          <Text class="candidate-name">{{ layout.name }}</Text>
          <Text as="small">
            {{
              layout.confidence === undefined
                ? '语义置信度未评估'
                : `${Math.round(layout.confidence * 100)}% 证据评分`
            }}
          </Text>
          <Text
            v-if="layout.generated?.status"
            as="small"
            class="candidate-status"
            :class="`status-${layout.generated.status}`"
          >
            {{
              {
                complete: '已生成，待视觉验收',
                partial: '待补齐',
                unsupported: '暂不支持',
              }[layout.generated.status]
            }}
          </Text
          >
        </Field>
        <Box
          v-if="layout.completeness"
          class="completeness"
          aria-label="布局完整度"
        >
          <Text>几何 {{ layout.completeness.geometry }}</Text>
          <Text>占位符 {{ layout.completeness.placeholders }}</Text>
          <Text>固定对象 {{ layout.completeness.fixedObjects }}</Text>
          <Text>样式 {{ layout.completeness.styles }}</Text>
        </Box>
        <Disclosure
          v-if="
            layout.source ||
              layout.semanticEvidence?.length ||
              layout.issues?.length
          "
          class="candidate-evidence"
        >
          <DisclosureTrigger>查看来源与问题</DisclosureTrigger>
          <Text v-if="layout.source" as="p" class="hint"
          >
            来源：<Text as="code">{{ layout.source.part }}</Text
            ><Text v-if="layout.source.master">
              · 母版 <Text as="code">{{ layout.source.master }}</Text>
            </Text
            ><Text v-if="layout.source.theme">
              · 主题 <Text as="code">{{ layout.source.theme }}</Text>
            </Text
            >
          </Text
          >
          <List v-if="layout.semanticEvidence?.length"
          >
            <ListItem
              v-for="(evidence, index) in layout.semanticEvidence"
              :key="`${layout.id}:evidence:${index}`"
            >
              {{ evidence.kind
              }}<Text v-if="evidence.value">：{{ evidence.value }}</Text
              ><Text v-if="evidence.shapeId">
                · shape {{ evidence.shapeId }}
              </Text
              >
            </ListItem
            >
          </List
          >
          <Text v-if="layout.issues?.length" as="p" class="warning">
            {{
              layout.issues.join('；')
            }}
          </Text>
        </Disclosure>
      </Box>
      <Text v-if="analysis.unsupportedOoxml.length" as="p" class="warning"
      >
        不支持项：{{ analysis.unsupportedOoxml.join('；') }}
      </Text
      >
      <Button
        v-if="!registered"
        variant="secondary"
        type="button"
        class="decision-button"
        :disabled="savingDecisions"
        @click="saveDecisions"
      >
        {{
          savingDecisions ? '正在保存并注册…' : '保存决策并注册主题'
        }}
      </Button
      >
    </Panel>
  </Panel>
</template>

<style scoped>
.source-graph {
  margin: 16px 0;
  padding: 12px;
  border: 1px solid var(--color-border);
}
.source-graph code {
  overflow-wrap: anywhere;
  font-size: 12px;
}
.source-table-scroll {
  max-width: 100%;
  overflow: auto;
}
.source-graph table {
  min-width: 850px;
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
}
.source-graph caption {
  text-align: left;
  padding: 8px 0;
}
.source-graph th,
.source-graph td {
  min-width: 120px;
  text-align: left;
  vertical-align: top;
  padding: 8px;
  border-bottom: 1px solid var(--color-border);
}
.source-master {
  margin-top: 12px;
}
.candidate-block {
  margin: 8px 0 14px;
}
.candidate-name {
  min-width: 0;
  overflow-wrap: anywhere;
}
.candidate-status {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 2px 7px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.status-complete {
  color: var(--color-accent-strong);
}
.status-partial {
  color: var(--color-warning);
}
.status-unsupported {
  color: var(--color-danger);
}
.completeness {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin: 3px 0 0 30px;
  color: var(--color-muted);
  font-size: 11px;
}
.candidate-evidence {
  margin: 5px 0 0 30px;
  color: var(--color-muted);
  font-size: 12px;
}
.candidate-evidence ul {
  margin: 6px 0;
  padding-left: 18px;
}

.theme-import {
  min-width: 0;
  min-height: 0;
  padding: 28px;
  overflow: auto;
}

.strategy-group {
  display: grid;
  gap: 8px;
  max-width: 720px;
  margin: 18px 0 10px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  color: var(--color-text);
}
.strategy-group label,
.reference-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-muted);
  font-size: 13px;
}
.strategy-group legend {
  padding: 0 6px;
  color: var(--color-text);
  font-size: 13px;
}
.reference-toggle {
  margin: 10px 0 18px;
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

.recent-jobs {
  display: grid;
  gap: 8px;
  max-width: 720px;
  margin: 18px 0;
  color: var(--color-muted);
  font-size: 13px;
}
.recent-job {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  background: var(--color-panel-raised);
}
.recent-job code {
  color: var(--color-text);
  overflow-wrap: anywhere;
}
.recent-job small {
  color: var(--color-muted);
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
  border-color: var(--color-accent-strong);
  color: var(--color-text);
}

.file-label input {
  display: none;
}

.name-input {
  flex: 1 1 220px;
  min-width: 0;
}

.ok {
  margin: 18px 0 0;
  color: var(--color-accent-strong);
  font-size: 13px;
}

.error {
  margin: 18px 0 0;
  color: var(--color-danger);
  font-size: 13px;
}

.warning {
  margin: 18px 0 0;
  color: var(--color-warning);
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
.analysis-panel {
  max-width: 1100px;
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--color-border);
}
.analysis-panel h3 {
  margin: 0 0 6px;
  font-size: 15px;
}
.analysis-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
}
.analysis-row small {
  margin-left: auto;
  color: var(--color-muted);
}
.decision-button {
  margin-top: 14px;
}
</style>
