<script setup lang="ts">
import {
  Box,
  Button,
  Field,
  Header,
  Heading,
  Image,
  Panel,
  SelectField,
  SelectOption,
  Text,
  TextField,
} from '@fastrd/ui-vue'
import { computed, ref, watch } from 'vue'
import { useGatewayClient } from '../../api/useGatewayClient.js'
import type { DeckSummary } from '@fastppt/protocol'
const props = defineProps<{ deck: DeckSummary | undefined }>()
const client = useGatewayClient()
const diagramId = ref('main')
const kind = ref<'flowchart' | 'gantt' | 'timeline' | 'matrix' | 'org-chart'>(
  'flowchart',
)
const direction = ref<'lr' | 'tb'>('lr')
const loading = ref(false)
const saving = ref(false)
const svg = ref('')
const message = ref('')
const issues = ref<string[]>([])
const previewUrl = computed(() =>
  svg.value
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.value)}`
    : undefined,
)
const nodes = ref<Array<{ id: string; label: string }>>([
  { id: 'start', label: '开始' },
  { id: 'end', label: '结束' },
])
const edges = ref<Array<{ from: string; to: string }>>([
  { from: 'start', to: 'end' },
])
const tasks = ref<
  Array<{
    id: string
    label: string
    start: string
    end: string
    dependsOn: string[]
  }>
>([])
function localDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? value
    : new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
}
function isoDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toISOString()
}
const document = computed(() => ({
  version: 1 as const,
  kind: kind.value,
  nodes: nodes.value,
  edges: edges.value,
  tasks: tasks.value.map((task) => ({
    ...task,
    start: isoDate(task.start),
    end: isoDate(task.end),
  })),
  style: {
    width: 1200,
    height: 700,
    direction: direction.value,
    fontFamily: 'Arial',
  },
  acceptedRevision: 0,
}))
watch(
  () => props.deck?.id,
  async () => {
    if (!props.deck) return
    loading.value = true
    try {
      const saved = (await client.getDiagram(
        props.deck.id,
        diagramId.value,
      )) as {
        kind?: typeof kind.value
        nodes?: Array<{ id: string; label: string }>
        edges?: Array<{ from: string; to: string }>
        tasks?: typeof tasks.value
        style?: { direction?: typeof direction.value }
      }
      kind.value = saved.kind ?? 'flowchart'
      direction.value = saved.style?.direction ?? 'lr'
      nodes.value = (saved.nodes ?? []).map(
        (node: { id: string; label: string }) => ({
          id: node.id,
          label: node.label,
        }),
      )
      edges.value = (saved.edges ?? []).map(
        (edge: { from: string; to: string }) => ({
          from: edge.from,
          to: edge.to,
        }),
      )
      tasks.value = (saved.tasks ?? []).map((task) => ({
        ...task,
        start: localDate(task.start),
        end: localDate(task.end),
      }))
    } catch {
      /* new diagram */
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)
async function validate(): Promise<boolean> {
  const result = await client.validateDiagram(document.value)
  issues.value = result.issues
  return result.ok
}
async function preview(): Promise<void> {
  if (!(await validate())) return
  const result = await client.renderDiagram(document.value)
  svg.value = result.svg
}
async function save(): Promise<void> {
  if (!props.deck || !(await validate())) return
  saving.value = true
  try {
    await client.putDiagram(props.deck.id, diagramId.value, document.value)
    await preview()
    message.value = '图表已保存'
    setTimeout(() => {
      message.value = ''
    }, 1600)
  } finally {
    saving.value = false
  }
}
async function insert(): Promise<void> {
  if (!props.deck || !(await validate())) return
  saving.value = true
  try {
    await client.putDiagram(props.deck.id, diagramId.value, document.value)
    const result = await client.insertDiagram(props.deck.id, diagramId.value)
    await preview()
    message.value = `已插入 ${result.assetPath}`
    setTimeout(() => {
      message.value = ''
    }, 2200)
  } finally {
    saving.value = false
  }
}
function addNode(): void {
  const id = `node-${nodes.value.length + 1}`
  nodes.value.push({ id, label: '新节点' })
}
function removeNode(id: string): void {
  nodes.value = nodes.value.filter((node) => node.id !== id)
  edges.value = edges.value.filter((edge) => edge.from !== id && edge.to !== id)
}
function addEdge(): void {
  if (nodes.value.length < 2) return
  const [from, to] = nodes.value
  edges.value.push({ from: from!.id, to: to!.id })
}
function removeEdge(index: number): void {
  edges.value.splice(index, 1)
}
function addTask(): void {
  const id = `task-${tasks.value.length + 1}`
  const previous = tasks.value.at(-1)
  tasks.value.push({
    id,
    label: '新任务',
    start: new Date().toISOString(),
    end: new Date(Date.now() + 86400000).toISOString(),
    dependsOn: previous ? [previous.id] : [],
  })
}
function removeTask(index: number): void {
  tasks.value.splice(index, 1)
}
</script>
<template>
  <Panel class="diagram-panel">
    <Header>
      <Box>
        <Text class="eyebrow">EDITABLE DIAGRAM</Text>
        <Heading as="h2">图表编辑</Heading>
      </Box>
      <Text v-if="message" class="saved">{{ message }}</Text>
    </Header>
    <Text v-if="!deck" as="p" class="muted">先选择一个演示文稿。</Text>
    <template v-else>
      <Box class="diagram-toolbar">
        <TextField v-model="diagramId" aria-label="图表 ID" /><SelectField
          v-model="kind"
          aria-label="图表类型"
        >
          <SelectOption value="flowchart">流程图</SelectOption>
          <SelectOption value="gantt">甘特图</SelectOption>
          <SelectOption value="timeline">时间线</SelectOption>
          <SelectOption value="matrix">矩阵</SelectOption>
          <SelectOption value="org-chart"
          >
            组织结构图
          </SelectOption
          >
        </SelectField
        ><SelectField v-model="direction" aria-label="布局方向">
          <SelectOption value="lr">从左到右</SelectOption>
          <SelectOption value="tb">从上到下</SelectOption>
        </SelectField
        ><Button variant="secondary" @click="addNode">添加节点</Button
        ><Button variant="secondary" @click="addEdge">添加连线</Button
        ><Button
          v-if="kind === 'gantt' || kind === 'timeline'"
          variant="secondary"
          @click="addTask"
        >
          添加任务
        </Button
        ><Button variant="secondary" @click="preview">预览</Button
        ><Button
          variant="primary"
          class="primary"
          :disabled="saving || loading"
          @click="save"
        >
          {{ saving ? '保存中…' : '保存图表' }}
        </Button
        ><Button
          variant="secondary"
          :disabled="saving || loading"
          @click="insert"
        >
          插入到演示文稿
        </Button>
      </Box>
      <Text v-if="issues.length" as="p" class="issues">
        {{
          issues.join('；')
        }}
      </Text>
      <Box class="diagram-grid">
        <Box>
          <Field v-for="node in nodes" :key="node.id" class="node-row">
            <Text as="code">{{ node.id }}</Text
            ><TextField v-model="node.label" /><Button
              variant="secondary"
              class="remove"
              :aria-label="`删除节点 ${node.id}`"
              @click="removeNode(node.id)"
            >
              ×
            </Button>
          </Field>
          <Heading v-if="kind === 'gantt' || kind === 'timeline'" as="h3"
          >
            任务
          </Heading
          >
          <template v-if="kind === 'gantt' || kind === 'timeline'">
            <Field
              v-for="(task, index) in tasks"
              :key="task.id"
              class="task-row"
            >
              <TextField v-model="task.label" /><TextField
                v-model="task.start"
                type="datetime-local"
              /><TextField
                v-model="task.end"
                type="datetime-local"
              /><SelectField
                v-model="task.dependsOn"
                multiple
                :aria-label="`${task.label} 依赖任务`"
              >
                <SelectOption
                  v-for="candidate in tasks.filter(
                    (candidate) => candidate.id !== task.id,
                  )"
                  :key="candidate.id"
                  :value="candidate.id"
                >
                  {{ candidate.label }}
                </SelectOption>
              </SelectField
              ><Button
                variant="secondary"
                class="remove"
                :aria-label="`删除任务 ${index + 1}`"
                @click="removeTask(index)"
              >
                ×
              </Button>
            </Field>
          </template>
          <Heading as="h3">连线</Heading>
          <Field v-for="(edge, index) in edges" :key="index" class="edge-row">
            <SelectField v-model="edge.from">
              <SelectOption
                v-for="node in nodes"
                :key="node.id"
                :value="node.id"
              >
                {{ node.label }}
              </SelectOption>
            </SelectField
            ><Text>→</Text
            ><SelectField v-model="edge.to">
              <SelectOption
                v-for="node in nodes"
                :key="node.id"
                :value="node.id"
              >
                {{ node.label }}
              </SelectOption>
            </SelectField
            ><Button
              variant="secondary"
              class="remove"
              :aria-label="`删除连线 ${index + 1}`"
              @click="removeEdge(index)"
            >
              ×
            </Button>
          </Field>
        </Box>
        <Box class="svg-preview">
          <Image v-if="previewUrl" :src="previewUrl" alt="图表预览" />
        </Box>
      </Box>
    </template>
  </Panel>
</template>
<style scoped>
.diagram-panel {
  height: 100%;
  padding: 28px;
  overflow: auto;
  color: var(--color-text);
  background: var(--color-panel);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 16px;
}
h2 {
  margin: 4px 0 0;
}
.saved {
  color: var(--color-accent-strong);
  font-size: 13px;
}
.issues {
  padding: 10px;
  border: 1px solid var(--color-danger);
  color: var(--color-danger);
  font-size: 13px;
}
.diagram-toolbar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  padding: 18px 0;
}
.diagram-grid {
  display: grid;
  grid-template-columns: minmax(280px, 420px) minmax(320px, 1fr);
  gap: 22px;
}
.node-row,
.edge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.node-row code {
  width: 92px;
  color: var(--color-muted);
}
.node-row input {
  flex: 1;
}
.edge-row select {
  flex: 1;
}
.svg-preview {
  min-height: 300px;
  border: 1px solid var(--color-border);
  background: #fff;
  padding: 12px;
  overflow: auto;
}
.svg-preview img {
  max-width: 100%;
  height: auto;
}
.muted {
  color: var(--color-muted);
}
.eyebrow {
  font-size: 11px;
  color: var(--color-muted);
  letter-spacing: 0.08em;
}
.task-row {
  display: grid;
  grid-template-columns:
    minmax(100px, 1fr) 150px 150px minmax(110px, 0.8fr)
    auto;
  gap: 8px;
  align-items: center;
  margin: 8px 0;
}
.task-row input,
.task-row select {
  min-width: 0;
}
.task-row select {
  height: 42px;
}
@media (max-width: 760px) {
  .diagram-grid {
    grid-template-columns: 1fr;
  }
  .task-row {
    grid-template-columns: 1fr 1fr;
  }
  .task-row select {
    grid-column: span 2;
  }
}

.diagram-grid > div {
  min-width: 0;
}
.node-row input,
.edge-row select {
  min-width: 0;
}
.diagram-toolbar input {
  min-width: 0;
  max-width: 100%;
}
@media (max-width: 960px) {
  .diagram-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .diagram-panel {
    padding: 20px;
  }
}
@media (max-width: 600px) {
  .diagram-panel {
    padding: 16px;
  }
  .node-row code {
    width: 60px;
    font-size: 11px;
  }
}
</style>
