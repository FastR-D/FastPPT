<script setup lang="ts">
import {
  Article,
  Box,
  Button,
  Modal,
  Disclosure,
  DisclosureTrigger,
  Footer,
  Form,
  Header,
  Heading,
  Panel,
  SelectField,
  SelectOption,
  Text,
  TextField,
} from '@fastrd/ui-vue'
import { onMounted, onUnmounted, shallowRef, watch } from 'vue'
import ResourcePreview from './ResourcePreview.vue'
import { useGatewayClient } from '../../api/useGatewayClient.js'
import type { LayoutResourceSummary } from '@fastppt/protocol'

withDefaults(
  defineProps<{ compact?: boolean; canApply?: boolean; page?: number }>(),
  { compact: false, canApply: true, page: 1 },
)
const emit = defineEmits<{ choose: [resource: LayoutResourceSummary] }>()
const client = useGatewayClient()
const query = shallowRef('')
const kind = shallowRef('')
const density = shallowRef('')
const source = shallowRef('')
const sources = shallowRef<{ path: string; label: string; count: number }[]>([])
const status = shallowRef('')
const offset = shallowRef(0)
const total = shallowRef(0)
const items = shallowRef<LayoutResourceSummary[]>([])
const loading = shallowRef(false)
const error = shallowRef('')
const inspection = shallowRef<LayoutResourceSummary>()
function sourceLabel(value: string): string {
  return value.replace(/[-—–_\s]*旁门左道\s*PPT(?:\s*原创出品)?/giu, '')
}
function inspectPage(delta: number): void {
  const index = items.value.findIndex(
    (item) => item.id === inspection.value?.id,
  )
  inspection.value =
    items.value[Math.max(0, Math.min(items.value.length - 1, index + delta))]
}
let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let generation = 0
async function load(): Promise<void> {
  const requestId = ++generation
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = ''
  try {
    const result = await client.searchResources(
      {
        query: query.value,
        kind: kind.value,
        density: density.value,
        status: status.value,
        source: source.value,
        offset: offset.value,
        limit: 24,
      },
      controller.signal,
    )
    if (requestId !== generation) return
    items.value = result.items
    total.value = result.total
  } catch (cause) {
    if (
      requestId === generation &&
      !(cause instanceof DOMException && cause.name === 'AbortError')
    )
      error.value = cause instanceof Error ? cause.message : '读取版式失败'
  } finally {
    if (requestId === generation) loading.value = false
  }
}
watch([query, kind, density, status, source], () => {
  offset.value = 0
  loading.value = true
  clearTimeout(timer)
  timer = setTimeout(() => void load(), 250)
})
function turnPage(delta: number): void {
  offset.value = Math.max(0, offset.value + delta * 24)
  void load()
}
const facetController = new AbortController()
onMounted(() => {
  void load()
  void client
    .getResourceFacets(facetController.signal)
    .then((result) => {
      sources.value = result.sources
    })
    .catch(() => {
      /* Search remains available without facets. */
    })
})
onUnmounted(() => {
  generation++
  facetController.abort()
  clearTimeout(timer)
  controller?.abort()
})
</script>

<template>
  <Panel class="resource-gallery" :class="{ compact }" aria-label="版式资源库">
    <Header
    >
      <Box
      >
        <Text as="small">COMPOSITION LIBRARY</Text
        ><Heading as="h1">版式与逻辑图</Heading
        ><Text as="p">按内容关系寻找结构，与当前主题组合使用。</Text>
      </Box
      ><Text>{{ total.toLocaleString() }} 个候选</Text>
    </Header
    >
    <Form class="search-tools" @submit.prevent="load">
      <TextField
        v-model="query"
        type="search"
        placeholder="搜索：四步流程、SWOT、时间轴、蓝色图文…"
        aria-label="搜索版式"
      />
      <SelectField v-model="kind" aria-label="资源类型"
      >
        <SelectOption value="">全部类型</SelectOption
        ><SelectOption value="layout">页面版式</SelectOption
        ><SelectOption value="diagram">逻辑图</SelectOption>
      </SelectField
      >
      <SelectField v-model="density" aria-label="内容密度"
      >
        <SelectOption value="">全部密度</SelectOption
        ><SelectOption value="airy">简洁留白</SelectOption
        ><SelectOption value="balanced">适中</SelectOption
        ><SelectOption value="dense">信息密集</SelectOption>
      </SelectField
      >
      <SelectField v-model="source" aria-label="素材来源"
      >
        <SelectOption value="">全部来源</SelectOption
        ><SelectOption
          v-for="item in sources"
          :key="item.path"
          :value="item.path"
        >
          {{ sourceLabel(item.label) }} · {{ item.count }}
        </SelectOption
        >
      </SelectField
      >
      <SelectField v-model="status" aria-label="转换状态"
      >
        <SelectOption value="">可参考资源</SelectOption
        ><SelectOption value="reconstructed">基础重建</SelectOption
        ><SelectOption value="needs-review">含转换限制</SelectOption
        ><SelectOption value="excluded"
        >
          排除页 / 来源说明
        </SelectOption
        >
      </SelectField
      >
    </Form>
    <Text v-if="error" as="p" class="error" role="alert"
    >
      {{ error }} <Button variant="secondary" @click="load">重试</Button>
    </Text
    >
    <Text v-else-if="loading" as="p" role="status">正在检索版式…</Text>
    <Text v-else-if="!items.length" as="p" class="empty"
    >
      没有匹配结果。试试内容关系或减少关键词，也可以让 Agent 创作新结构。
    </Text
    >
    <Box class="resource-grid" :aria-busy="loading">
      <Article
        v-for="item in items"
        :key="item.id"
        :data-resource-id="item.id"
        class="resource-card"
      >
        <Button
          variant="quiet"
          class="preview"
          :aria-label="`放大预览 ${item.title}`"
          @click="inspection = item"
        >
          <ResourcePreview
            :id="item.id"
            :title="item.title"
            :revision="item.revision"
            :aspect="item.aspect"
          />
          <Text class="kind"
          >
            {{ item.kind === 'diagram' ? '逻辑图' : '版式' }} ·
            {{ item.sourcePage }}
          </Text
          >
        </Button>
        <Box class="card-copy">
          <Heading as="h2">{{ item.title }}</Heading
          ><Text as="p">{{ item.description }}</Text
          ><Box class="tags"
          >
            <Text
              v-for="tag in item.tags
                .filter((tag) => /[\u4e00-\u9fff]/.test(tag))
                .slice(0, 3)"
              :key="tag"
            >
              {{ tag }}
            </Text
            >
          </Box
          >
          <Footer
          >
            <Text v-if="item.status !== 'reconstructed'" as="small">
              {{
                item.status === 'needs-review'
                  ? '需复核转换效果'
                  : '已排除'
              }}
            </Text
            ><Button
              variant="secondary"
              :disabled="!canApply || loading || item.status === 'excluded'"
              @click="emit('choose', item)"
            >
              {{ compact ? '选择' : `用于第 ${page} 页` }}
            </Button
            >
          </Footer
          >
        </Box>
        <Disclosure
        >
          <DisclosureTrigger>来源与检查</DisclosureTrigger
          ><Text as="p">{{ sourceLabel(item.source) }} · 第 {{ item.sourcePage }} 页</Text
          ><Text v-if="item.license" as="p">{{ item.license }}</Text
          ><Text v-if="item.warnings.length" as="p">
            {{
              item.warnings.join(' · ')
            }}
          </Text>
        </Disclosure
        >
      </Article>
    </Box>
    <Footer class="pagination"
    >
      <Button
        variant="secondary"
        :disabled="loading || offset === 0"
        @click="turnPage(-1)"
      >
        上一页
      </Button
      ><Text
      >
        {{ total ? offset + 1 : 0 }}–{{ Math.min(offset + 24, total) }} /
        {{ total }}
      </Text
      ><Button
        variant="secondary"
        :disabled="loading || offset + 24 >= total"
        @click="turnPage(1)"
      >
        下一页
      </Button
      >
    </Footer
    >
    <Modal
      :open="Boolean(inspection)"
      class="inspection-dialog"
      label="版式现场预览"
      @close="inspection = undefined"
      @keydown.left.prevent="inspectPage(-1)"
      @keydown.right.prevent="inspectPage(1)"
    >
      <template v-if="inspection">
        <Header
        >
          <Box
          >
            <Heading as="h2">{{ inspection.title }}</Heading
            ><Text as="p"
            >
              第 {{ inspection.sourcePage }} 页 · {{ inspection.id }}
            </Text
            >
          </Box
          ><Button
            variant="secondary"
            aria-label="关闭预览"
            @click="inspection = undefined"
          >
            关闭
          </Button
          >
        </Header
        >
        <ResourcePreview
          :id="inspection.id"
          :key="inspection.id"
          :title="`${inspection.title} 放大预览`"
          :revision="inspection.revision"
          :aspect="inspection.aspect"
          eager
        />
        <Text as="p" class="inspection-source"
        >
          {{ sourceLabel(inspection.source) }} · 第 {{ inspection.sourcePage }} 页 ·
          直接渲染页面源代码
        </Text
        >
        <Footer class="pagination"
        >
          <Button
            variant="secondary"
            :disabled="inspection.id === items[0]?.id"
            @click="inspectPage(-1)"
          >
            上一页
          </Button
          ><Text>可用左右方向键切换</Text
          ><Button
            variant="secondary"
            :disabled="inspection.id === items.at(-1)?.id"
            @click="inspectPage(1)"
          >
            下一页
          </Button
          >
        </Footer
        >
      </template>
    </Modal>
  </Panel>
</template>

<style scoped>
.resource-gallery {
  min-height: 0;
  overflow: auto;
  padding: 28px;
  color: var(--color-text);
  background: var(--color-canvas);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 22px;
}
header small {
  color: var(--color-accent-strong);
  font-size: 10px;
  letter-spacing: 0.14em;
}
h1 {
  margin: 6px 0;
  font-size: 25px;
}
header p,
header > span {
  color: var(--color-muted);
  font-size: 12px;
}
.search-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 22px;
}
input {
  flex: 1 1 300px;
  min-width: 0;
}
select {
  max-width: 180px;
}
.resource-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 18px;
}
.resource-card {
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-panel);
  overflow: hidden;
}
.preview {
  position: relative;
  display: block;
  width: 100%;
  overflow: hidden;
}
.kind {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 4px 7px;
  border-radius: 5px;
  font-size: 10px;
  background: #111c;
  color: white;
}
.card-copy {
  padding: 14px;
}
h2 {
  margin: 0 0 8px;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.card-copy p {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-muted);
}
.tags {
  display: flex;
  gap: 5px;
  margin: 12px 0;
}
.tags span {
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--color-panel-raised);
  color: var(--color-muted);
  font-size: 10px;
}
.card-copy footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card-copy footer button {
  margin-left: auto;
}
footer small {
  color: var(--color-muted);
  font-size: 10px;
}
details {
  border-top: 1px solid var(--color-border);
  padding: 10px 14px;
  font-size: 10px;
  color: var(--color-muted);
  overflow-wrap: anywhere;
}
details p {
  line-height: 1.6;
}
.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 18px;
  margin-top: 24px;
  font-size: 12px;
  color: var(--color-muted);
}
.error {
  color: var(--color-danger);
}
.empty {
  padding: 40px;
  text-align: center;
  color: var(--color-muted);
}
.compact {
  padding: 16px;
  max-height: 48vh;
}
.compact header {
  display: none;
}
.compact .resource-grid {
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}
@media (max-width: 600px) {
  .resource-gallery {
    padding: 16px;
  }
  .resource-grid {
    grid-template-columns: 1fr;
  }
}
.inspection-dialog {
  width: min(1200px, 94vw);
  max-height: 94vh;
  padding: 24px;
}
.inspection-dialog header {
  margin-bottom: 12px;
}
.inspection-dialog :deep(.resource-live-preview) {
  max-height: 70vh;
}
.inspection-source {
  font-size: 12px;
  color: var(--color-muted);
  overflow-wrap: anywhere;
}
@media (max-width: 800px) {
  .inspection-dialog {
    padding: 16px;
  }
}
</style>
