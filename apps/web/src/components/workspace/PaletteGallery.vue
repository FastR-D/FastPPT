<script setup lang="ts">
import {
  Article,
  Box,
  Button,
  Footer,
  Form,
  Header,
  Heading,
  Link,
  Panel,
  SelectField,
  SelectOption,
  Text,
  TextField,
} from '@fastrd/ui-vue'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { ColorPalette, HarnessKind } from '@fastppt/protocol'
import { useGatewayClient } from '../../api/useGatewayClient.js'

const props = defineProps<{ harness: HarnessKind }>()
const emit = defineEmits<{ use: [palette: ColorPalette] }>()
const client = useGatewayClient()
const query = ref(''),
  source = ref(''),
  kind = ref('')
const sources = ref<string[]>([]),
  catalogTotal = ref(0),
  total = ref(0),
  offset = ref(0)
const items = ref<ColorPalette[]>([]),
  reasons = ref<Record<string, string>>({})
const loading = ref(false),
  recommending = ref(false),
  recommended = ref(false),
  error = ref(''),
  notice = ref('')
const quickQueries = [
  '商务汇报',
  '科技发布',
  '温柔浅色',
  '自然环保',
  '科研图表',
  '暗色界面',
]
let requestNumber = 0,
  controller: AbortController | undefined,
  timer: ReturnType<typeof setTimeout> | undefined
const lifetime = new AbortController()
async function search(): Promise<void> {
  clearTimeout(timer)
  const token = ++requestNumber
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  recommending.value = false
  error.value = ''
  recommended.value = false
  try {
    const result = await client.searchPalettes(
      {
        query: query.value,
        source: source.value,
        kind: kind.value,
        offset: offset.value,
        limit: 24,
      },
      controller.signal,
    )
    if (token !== requestNumber) return
    items.value = result.items
    total.value = result.total
    reasons.value = {}
  } catch (cause) {
    if (
      token === requestNumber &&
      !(cause instanceof DOMException && cause.name === 'AbortError')
    )
      error.value = cause instanceof Error ? cause.message : '配色搜索失败'
  } finally {
    if (token === requestNumber) loading.value = false
  }
}
async function recommend(): Promise<void> {
  if (!query.value.trim()) return
  clearTimeout(timer)
  const token = ++requestNumber
  controller?.abort()
  controller = new AbortController()
  recommending.value = true
  loading.value = false
  error.value = ''
  try {
    const result = await client.recommendPalettes(
      query.value,
      props.harness,
      controller.signal,
      { source: source.value, kind: kind.value },
    )
    if (token !== requestNumber) return
    items.value = result.recommendations.map((item) => item.palette)
    reasons.value = Object.fromEntries(
      result.recommendations.map((item) => [item.palette.id, item.reason]),
    )
    total.value = items.value.length
    offset.value = 0
    recommended.value = true
  } catch (cause) {
    if (
      token === requestNumber &&
      !(cause instanceof DOMException && cause.name === 'AbortError')
    )
      error.value =
        cause instanceof Error ? cause.message : 'AI 配色推荐失败，请重试'
  } finally {
    if (token === requestNumber) recommending.value = false
  }
}
watch([query, source, kind], () => {
  offset.value = 0
  controller?.abort()
  requestNumber++
  clearTimeout(timer)
  timer = setTimeout(() => void search(), 250)
})
onMounted(() => {
  void search()
  void client
    .getPaletteFacets(lifetime.signal)
    .then((result) => {
      sources.value = result.sources
      catalogTotal.value = result.total
    })
    .catch(() => undefined)
})
onUnmounted(() => {
  requestNumber++
  controller?.abort()
  lifetime.abort()
  clearTimeout(timer)
})
function page(delta: number): void {
  offset.value = Math.max(0, offset.value + delta * 24)
  void search()
}
async function copy(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    notice.value = '已复制配色'
  } catch {
    notice.value = '复制失败，请直接选中色号复制'
  }
}
function foreground(color: string): string {
  const rgb = [1, 3, 5].map(
    (offset) => parseInt(color.slice(offset, offset + 2), 16) / 255,
  )
  const luminance = rgb.reduce(
    (sum, value, index) =>
      sum +
      (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
        [0.2126, 0.7152, 0.0722][index]!,
    0,
  )
  return luminance > 0.179 ? '#000000' : '#ffffff'
}
</script>

<template>
  <Panel class="palette-gallery" aria-label="配色资源库">
    <Header>
      <Box>
        <Text class="eyebrow">COLOR PALETTES</Text>
        <Heading as="h2">画盘</Heading>
        <Text as="p"
        >
          {{
            catalogTotal.toLocaleString()
          }}
          组经典与设计配色，按色彩、风格和使用场景寻找。
        </Text
        >
      </Box>
      <Text v-if="notice" role="status" class="notice">{{ notice }}</Text>
    </Header>
    <Form class="palette-search" @submit.prevent="search">
      <TextField
        v-model="query"
        type="search"
        aria-label="搜索配色"
        placeholder="搜索配色、色号，或描述你想要的感觉…"
      />
      <SelectField v-model="source" aria-label="配色来源">
        <SelectOption value="">全部来源</SelectOption>
        <SelectOption v-for="item in sources" :key="item" :value="item">
          {{
            item
          }}
        </SelectOption>
      </SelectField>
      <SelectField v-model="kind" aria-label="配色类型">
        <SelectOption value="">全部类型</SelectOption>
        <SelectOption value="design">设计配色</SelectOption>
        <SelectOption value="theme">主题配色</SelectOption>
        <SelectOption value="categorical">分类色</SelectOption>
        <SelectOption value="sequential">连续色</SelectOption>
        <SelectOption value="diverging">发散色</SelectOption>
        <SelectOption value="cyclical">循环色</SelectOption>
      </SelectField>
      <Button variant="secondary" type="submit" :disabled="loading"
      >
        搜索
      </Button
      >
      <Button
        variant="primary"
        :disabled="!query.trim() || recommending"
        :title="`使用 ${harness === 'claude' ? 'Claude Code' : 'Codex'} 推荐`"
        @click="recommend"
      >
        {{ recommending ? 'AI 推荐中…' : 'AI 推荐' }}
      </Button
      >
    </Form>
    <Box class="quick-queries">
      <Button
        v-for="item in quickQueries"
        :key="item"
        variant="quiet"
        @click="query = item"
      >
        {{ item }}
      </Button
      >
    </Box>
    <Text v-if="error" as="p" role="alert" class="error">{{ error }}</Text>
    <Text v-if="recommending" as="p" role="status" class="muted"
    >
      正在结合你的描述，从配色库中挑选并说明推荐理由…
    </Text
    >
    <Text class="result-count"
    >
      {{ recommended ? 'AI 推荐' : '搜索结果' }} · {{ total }} 组
    </Text
    >
    <Box class="palette-grid" :aria-busy="loading || recommending">
      <Article
        v-for="item in items"
        :key="item.id"
        class="palette-card"
        :data-palette-id="item.id"
      >
        <Box class="color-strip">
          <Button
            v-for="(color, index) in item.colors"
            :key="`${color}-${index}`"
            variant="quiet"
            class="color-swatch"
            :style="{ backgroundColor: color, color: foreground(color) }"
            :title="color"
            :aria-label="`复制色号 ${color}`"
            @click="copy(color)"
          >
            <Text>{{ color }}</Text>
          </Button
          >
        </Box>
        <Box class="palette-card-body">
          <Box class="palette-title"
          >
            <Heading as="h3">{{ item.title }}</Heading
            ><Text>{{ item.colors.length }} 色</Text>
          </Box
          >
          <Text v-if="reasons[item.id]" as="p" class="recommendation-reason">
            {{
              reasons[item.id]
            }}
          </Text>
          <Box class="palette-meta"
          >
            <Link
              :href="item.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ item.source }}
            </Link
            ><Text>{{ item.tags.slice(0, 2).join(' · ') }}</Text>
          </Box
          >
          <Box class="palette-actions"
          >
            <Button variant="quiet" @click="copy(item.colors.join(' '))"
            >
              复制配色
            </Button
            ><Button variant="secondary" @click="emit('use', item)"
            >
              用于对话
            </Button
            >
          </Box
          >
        </Box>
      </Article>
    </Box>
    <Text v-if="!loading && !items.length" as="p" class="empty"
    >
      没有匹配的配色，试试其他色彩或风格描述。
    </Text
    >
    <Footer v-if="!recommended && total > 24"
    >
      <Button :disabled="offset === 0 || loading" @click="page(-1)"
      >
        上一页
      </Button
      ><Text
      >
        第 {{ Math.floor(offset / 24) + 1 }} /
        {{ Math.ceil(total / 24) }} 页
      </Text
      ><Button :disabled="offset + 24 >= total || loading" @click="page(1)"
      >
        下一页
      </Button
      >
    </Footer
    >
  </Panel>
</template>

<style scoped>
.palette-gallery {
  height: 100%;
  min-width: 0;
  overflow: auto;
  padding: 24px 28px;
  background: var(--color-panel);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.eyebrow {
  color: var(--color-muted);
  font-size: 10px;
  letter-spacing: 0.12em;
}
h2 {
  margin: 4px 0 8px;
  font-size: 22px;
}
header p,
.muted {
  color: var(--color-muted);
  font-size: 13px;
}
.palette-search {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.palette-search input {
  flex: 1 1 240px;
}
.palette-search select {
  flex: 0 1 160px;
}
.quick-queries {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 10px 0 18px;
}
.result-count {
  display: block;
  margin-bottom: 12px;
  color: var(--color-muted);
  font-size: 12px;
}
.palette-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 16px;
}
.palette-card {
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}
.color-strip {
  display: flex;
  height: 104px;
}
.color-swatch {
  flex: 1 1 0;
  min-width: 0;
  border: 0;
  border-radius: 0;
  padding: 0;
}
.color-swatch span {
  opacity: 0;
  font-size: 10px;
  writing-mode: vertical-rl;
}
.color-swatch:hover span,
.color-swatch:focus-visible span {
  opacity: 1;
}
.palette-card-body {
  padding: 14px;
}
.palette-title,
.palette-meta,
.palette-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
h3 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.palette-title > span {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-muted);
}
.palette-meta {
  margin-top: 8px;
  align-items: flex-start;
  font-size: 11px;
  color: var(--color-muted);
}
.palette-meta > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.palette-meta a {
  flex-shrink: 0;
}
.palette-actions {
  margin-top: 14px;
  justify-content: flex-end;
}
.recommendation-reason {
  margin: 10px 0;
  color: var(--color-secondary);
  font-size: 12px;
  line-height: 1.7;
}
.error {
  margin: 16px 0;
  color: var(--color-danger);
}
.notice {
  color: var(--color-success);
  font-size: 12px;
}
.empty {
  padding: 40px 0;
  text-align: center;
  color: var(--color-muted);
}
footer {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  padding-top: 24px;
  font-size: 12px;
}
@media (max-width: 600px) {
  .palette-gallery {
    padding: 20px 16px;
  }
  .palette-search input {
    flex-basis: 100%;
  }
  .palette-search select {
    flex: 1 1 40%;
    min-width: 0;
  }
}
</style>
