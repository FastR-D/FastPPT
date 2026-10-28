<script setup lang="ts">
import {
  Article,
  Box,
  Button,
  Disclosure,
  DisclosureTrigger,
  Field,
  Footer,
  Form,
  Header,
  Heading,
  Panel,
  SelectField,
  SelectOption,
  Text,
  TextField,
} from '@fastppt/components'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type {
  AnimationDocumentV1,
  CreativeAnimationSummary,
} from '@fastppt/protocol'
import {
  useGatewayClient,
} from '../../api/useGatewayClient.js'
import { bindCreativeAnimation } from '../../workspace/creative-animation.js'
import AnimationPreview from './AnimationPreview.vue'
const props = defineProps<{
  anchors: string[]
  slideId: string
  disabled?: boolean
}>()
const emit = defineEmits<{ apply: [motion: AnimationDocumentV1] }>()
const client = useGatewayClient(),
  query = ref(''),
  category = ref(''),
  scope = ref(''),
  offset = ref(0),
  total = ref(0),
  items = ref<CreativeAnimationSummary[]>([]),
  error = ref(''),
  loading = ref(false),
  selected = ref<CreativeAnimationSummary>(),
  motion = ref<AnimationDocumentV1>(),
  bindings = ref<Record<string, string>>({})
const applyMode = ref<'single' | 'group'>('single'),
  sourceTarget = ref('')
const boundTargets = computed(() =>
  applyMode.value === 'single'
    ? [sourceTarget.value].filter(Boolean)
    : (selected.value?.targets ?? []),
)
function sourceLabel(target: string): string {
  const n = selected.value?.targets.indexOf(target) ?? -1
  return selected.value?.title.split(/\s\/\s/)[n] ?? target
}
let controller: AbortController | undefined,
  timer: ReturnType<typeof setTimeout> | undefined,
  generation = 0
async function load() {
  const token = ++generation
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = ''
  try {
    const r = await client.searchCreativeAnimations(
      {
        query: query.value,
        category: category.value,
        scope: scope.value,
        offset: offset.value,
        limit: 8,
      },
      controller.signal,
    )
    if (token === generation) {
      items.value = r.items
      total.value = r.total
    }
  } catch (e) {
    if (
      token === generation &&
      !(e instanceof DOMException && e.name === 'AbortError')
    )
      error.value = String(e)
  } finally {
    if (token === generation) loading.value = false
  }
}
watch([query, category, scope], () => {
  offset.value = 0
  clearTimeout(timer)
  timer = setTimeout(() => void load(), 200)
})
watch(
  () => props.slideId,
  () => {
    selected.value = undefined
    motion.value = undefined
    bindings.value = {}
  },
)
onMounted(() => void load())
onUnmounted(() => {
  generation++
  controller?.abort()
  clearTimeout(timer)
})
let selection = 0
async function choose(item: CreativeAnimationSummary) {
  const token = ++selection
  selected.value = item
  motion.value = undefined
  bindings.value = {}
  error.value = ''
  try {
    const r = await client.readCreativeAnimation(item.id)
    if (token !== selection || selected.value?.id !== item.id) return
    motion.value = r.motion
    applyMode.value = 'single'
    sourceTarget.value = item.targets[0] ?? ''
    bindings.value = Object.fromEntries(
      item.targets.map((t, i) => [t, props.anchors[i] ?? '']),
    )
  } catch (e) {
    if (token === selection) error.value = String(e)
  }
}
function warningLabel(value: string): string {
  if (value === 'creative-loop-normalized-to-two-cycles')
    return '原稿中的无限或超长循环已整理为两轮，可按创意需要调整。'
  if (value.startsWith('browser-whole-object-iteration'))
    return '浏览器按整体预览；PPTX 保留逐字和逐项顺序。'
  if (value === 'browser-random-motion-is-seeded')
    return '随机效果在拖动进度时保持稳定，实际放映可能产生不同轨迹。'
  if (value === 'source-subobject-range-adapted-to-whole-object')
    return '原图表或段落的局部效果已适配为当前对象整体动画。'
  if (value.startsWith('browser-unsupported-'))
    return '此效果的部分属性需要在导出的 PowerPoint 中复核。'
  return value
}
function apply() {
  try {
    if (motion.value) {
      const template =
        applyMode.value === 'single'
          ? {
              ...motion.value,
              groups: motion.value.groups
                .map((g) => ({
                  ...g,
                  effects: g.effects.filter(
                    (e) => e.target === sourceTarget.value,
                  ),
                }))
                .filter((g) => g.effects.length),
            }
          : motion.value
      emit(
        'apply',
        bindCreativeAnimation(
          template,
          props.slideId,
          bindings.value,
          props.anchors,
        ),
      )
    }
  } catch (e) {
    error.value = String(e)
  }
}
function page(delta: number) {
  offset.value = Math.max(0, offset.value + delta * 8)
  void load()
}
</script>
<template>
  <Panel class="creative-gallery" aria-label="创意动效库">
    <Header
    >
      <Box
      >
        <Text as="small">CREATIVE MOTION</Text
        ><Heading as="h2">用动效构思创意表达</Heading
        ><Text as="p"
        >
          寻找文字、图片、遮罩和组合效果，再应用到当前页对象。
        </Text
        >
      </Box
      ><Text>{{ total }} 个效果参考</Text>
    </Header
    >
    <Form @submit.prevent="load"
    >
      <TextField
        v-model="query"
        type="search"
        aria-label="搜索创意动画"
        placeholder="伸展、逐字、旋转、图片揭示…"
      /><SelectField v-model="category" aria-label="动效类别"
      >
        <SelectOption value="">全部类别</SelectOption
        ><SelectOption
          v-for="c in [
            '文字创意',
            '图片创意',
            '遮罩揭示',
            '路径运动',
            '旋转与强调',
            '缩放与弹性',
            '组合编排',
            '对象进出',
          ]"
          :key="c"
        >
          {{ c }}
        </SelectOption
        >
      </SelectField
      ><SelectField v-model="scope" aria-label="动效对象范围"
      >
        <SelectOption value="">全部对象范围</SelectOption
        ><SelectOption value="object">单对象</SelectOption
        ><SelectOption value="multi-object"
        >
          多对象组合
        </SelectOption
        >
      </SelectField
      >
    </Form
    >
    <Text v-if="error" as="p" role="alert" class="error">{{ error }}</Text
    ><Text v-if="loading" as="p" role="status">正在搜索创意效果…</Text>
    <Box class="motion-grid"
    >
      <Article
        v-for="item in items"
        :key="item.id"
        :data-animation-id="item.id"
      >
        <Box class="demo"
        >
          <AnimationPreview :id="item.id" :title="item.title" :revision="item.revision" />
        </Box
        ><Heading as="h3">{{ item.title }}</Heading
        ><Text v-if="item.useCases[0]" as="p">{{ item.useCases[0] }}</Text
        ><Text as="p"
        >
          {{ item.scope === 'multi-object' ? '组合编排' : '单对象效果' }} ·
          {{ (item.durationMs / 1000).toFixed(1) }}s
        </Text
        ><Button variant="secondary" type="button" @click="choose(item)"
        >
          应用此效果
        </Button
        >
      </Article
      >
    </Box
    >
    <Box v-if="selected && motion" class="binding"
    >
      <Heading as="h3">将「{{ selected.title }}」绑定到当前页</Heading
      ><Text as="p">演示图形仅用于说明效果，应用时保留当前页内容。</Text
      ><Text as="p"
      >
        浏览器预览与 PowerPoint 的逐字、随机和复杂遮罩细节可能不同。
      </Text
      ><Text v-if="!anchors.length" as="p"
      >
        当前页暂无对象标识。创作时可让 Agent
        为文字、图片或图形设置动画对象，再绑定效果。
      </Text
      ><Field v-if="selected.targets.length > 1"
      >
        使用方式<SelectField v-model="applyMode"
        >
          <SelectOption value="single">提取单个对象效果</SelectOption
          ><SelectOption value="group">整组创意编排</SelectOption>
        </SelectField
        >
      </Field
      ><Field v-if="applyMode === 'single' && selected.targets.length > 1"
      >
        参考效果<SelectField v-model="sourceTarget"
        >
          <SelectOption
            v-for="target in selected.targets"
            :key="target"
            :value="target"
          >
            {{ sourceLabel(target) }}
          </SelectOption
          >
        </SelectField
        >
      </Field
      ><Field v-for="target in boundTargets" :key="target"
      >
        {{ sourceLabel(target)
        }}<SelectField v-model="bindings[target]"
        >
          <SelectOption value="">选择当前页对象</SelectOption
          ><SelectOption
            v-for="anchor in anchors"
            :key="anchor"
            :value="anchor"
          >
            {{ anchor }}
          </SelectOption
          >
        </SelectField
        >
      </Field
      ><Disclosure v-if="selected.warnings.length"
      >
        <DisclosureTrigger>预览与导出差异</DisclosureTrigger
        ><Text as="p">
          {{
            selected.warnings.map(warningLabel).join(' · ')
          }}
        </Text>
      </Disclosure
      ><Button
        variant="secondary"
        :disabled="disabled || !anchors.length"
        @click="apply"
      >
        应用到所选对象
      </Button
      >
    </Box
    >
    <Footer
    >
      <Button
        variant="secondary"
        :disabled="loading || offset === 0"
        @click="page(-1)"
      >
        上一页
      </Button
      ><Text
      >
        {{ total ? offset + 1 : 0 }}–{{ Math.min(total, offset + 8) }} /
        {{ total }}
      </Text
      ><Button
        variant="secondary"
        :disabled="loading || offset + 8 >= total"
        @click="page(1)"
      >
        下一页
      </Button
      >
    </Footer
    >
  </Panel>
</template>
<style scoped>
.creative-gallery {
  margin: 20px 0 30px;
}
header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}
header small {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--color-accent);
}
h2 {
  margin: 8px 0;
  font-size: 23px;
}
p,
header > span {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.6;
}
form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 18px 0;
}
input {
  flex: 1;
  min-width: 180px;
}
.motion-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
article {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--color-panel-raised);
  padding-bottom: 12px;
}
article > h3,
article > p,
article > button {
  margin-left: 12px;
  margin-right: 12px;
}
h3 {
  font-size: 13px;
}
.demo {
  height: 160px;
  background: var(--color-preview-shell);
}
.demo iframe,
.demo button {
  width: 100%;
  height: 100%;
}
.demo button {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 8px;
}
.demo span {
  font-size: 24px;
  color: var(--color-accent-strong);
}
.demo small {
  color: var(--color-muted);
}
.binding {
  padding: 20px;
  border: 1px solid var(--color-accent);
  border-radius: 12px;
  margin-top: 18px;
}
.binding label {
  display: flex;
  gap: 12px;
  align-items: center;
  margin: 9px 0;
}
.binding details {
  font-size: 11px;
  color: var(--color-muted);
  margin: 12px 0;
}
footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding-top: 16px;
  font-size: 12px;
}
.error {
  color: var(--color-danger);
}
</style>
