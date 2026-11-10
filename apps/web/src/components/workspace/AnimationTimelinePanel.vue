<script setup lang="ts">
import {
  Box,
  Button,
  Disclosure,
  DisclosureTrigger,
  Field,
  Footer,
  Header,
  Heading,
  List,
  ListItem,
  Panel,
  SelectField,
  SelectOption,
  Text,
  TextField,
} from '@fastrd/ui-vue'
import AnimationGallery from './AnimationGallery.vue'
import { orderedNativeEffects } from '@fastppt/slidewave/native-motion'
import {
  applyMotionPreset,
  mergeSourceAnimations,
  motionPresets,
  type MotionPreset,
  type PresetPage,
} from '../../workspace/motion-presets.js'
import { rebindAnimationEffect } from '../../workspace/animation-edit.js'
import { scheduleMotion } from '@fastppt/slidewave/motion-schedule'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useGatewayClient } from '../../api/useGatewayClient.js'
import type {
  AnimationDocumentV1,
  DeckAnimationsDocument,
  DeckSummary,
} from '@fastppt/protocol'

const props = defineProps<{ deck: DeckSummary | undefined; page?: number }>()
const emit = defineEmits<{ 'update:page': [page: number] }>()
const client = useGatewayClient()
const document = ref<DeckAnimationsDocument>({ version: 1, animations: [] })
const slide = ref(1)
const slideIds = ref<string[]>([])
const currentSlideId = computed(
  () => slideIds.value[slide.value - 1] ?? `slide-${slide.value}`,
)
const orphanPages = computed(() =>
  document.value.animations.filter(
    (page) => !slideIds.value.includes(page.slideId),
  ),
)
function removeOrphanPage(slideId: string): void {
  document.value = {
    ...document.value,
    animations: document.value.animations.filter(
      (page) => page.slideId !== slideId,
    ),
  }
}
const pageCount = ref(1)
const loading = ref(false)
const saving = ref(false)
const dirty = ref(false)
const message = ref('')
const anchors = ref<string[]>([])
const selectedTarget = ref('')
const selectedPreset = ref<MotionPreset>('static')
const presetScope = ref<'page' | 'all'>('page')
const replaceUserAnimations = ref(false)
async function applyPreset(): Promise<void> {
  const deckId = props.deck?.id
  if (!deckId || loading.value) return
  const scope = presetScope.value
  const targetSlideId = currentSlideId.value
  const preset = selectedPreset.value
  const replaceUser = replaceUserAnimations.value
  loading.value = true
  try {
    const ir = (await client.getDeckIr(deckId)) as {
      slides: Array<{
        slideId: string
        animation?: AnimationDocumentV1
        animationTargets?: Array<{
          anchor: string
          role: string
          static: boolean
        }>
      }>
    }
    if (props.deck?.id !== deckId) return
    const selected =
      scope === 'all'
        ? ir.slides
        : ir.slides.filter((item) => item.slideId === targetSlideId)
    const pages: PresetPage[] = selected.map((item) => ({
      slideId: item.slideId,
      targets: (item.animationTargets ?? []).map((target) => ({
        ...target,
        role:
          target.role === 'title' || target.role === 'content'
            ? target.role
            : 'unknown',
      })),
    }))
    const result = applyMotionPreset(
      mergeSourceAnimations(document.value, ir.slides),
      pages,
      preset,
      replaceUser,
    )
    resetPreview()
    document.value = result.document
    dirty.value = true
    message.value = result.preserved.length
      ? `已应用预设，保留 ${result.preserved.length} 页已有修改；请保存。`
      : '预设已应用，请保存。'
  } catch (cause) {
    if (props.deck?.id === deckId)
      message.value = cause instanceof Error ? cause.message : '无法应用预设'
  } finally {
    if (props.deck?.id === deckId) loading.value = false
  }
}

const savedMotion = localStorage.getItem('fastppt.motion-preference')
const motionPreference = ref(
  savedMotion === 'reduce' || savedMotion === 'full' ? savedMotion : 'system',
)
watch(motionPreference, (value) => {
  localStorage.setItem('fastppt.motion-preference', value)
  stopTimer()
  playing.value = false
  window.dispatchEvent(
    new CustomEvent('fastppt-animation-preview', { detail: { reset: true } }),
  )
})

const current = computed<AnimationDocumentV1>(
  () =>
    document.value.animations.find(
      (item) => item.slideId === currentSlideId.value,
    ) ?? {
      version: 1,
      slideId: currentSlideId.value,
      transition: { kind: 'none', durationMs: 500 },
      groups: [],
      source: 'user',
      diagnostics: [],
    },
)
const effectKinds = [
  'entrance_fade',
  'appear',
  'fly',
  'zoom',
  'emphasis_pulse',
  'teeter',
  'path_line',
  'path_arc',
  'exit_fade',
  'native',
] as const
const selectedKind = ref<(typeof effectKinds)[number]>('entrance_fade')
const selectedTrigger = ref<'on-click' | 'with-previous' | 'after-previous'>(
  'on-click',
)
const selectedDelay = ref(0)
const selectedDuration = ref(400)
const selectedPath = ref('')
const playing = ref(false)
const playheadMs = ref(0)
const activeEffect = ref(-1)
let timer: ReturnType<typeof setInterval> | undefined
const timelineEffects = computed(() =>
  orderedNativeEffects(
    current.value.groups.map((group) => ({
      effects: group.effects.map((effect) => ({
        ...effect,
        groupId: group.id,
      })),
    })),
  ),
)
const orphanEffects = computed(() =>
  timelineEffects.value.filter(
    (effect) => !anchors.value.includes(effect.target),
  ),
)
const schedule = computed(() => scheduleMotion(timelineEffects.value))
const totalMs = computed(() =>
  Math.max(0, ...schedule.value.map((item) => item.previewEndMs)),
)
function stopTimer(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}
function syncActive(): void {
  activeEffect.value = -1
  const visible = new Map<string, (typeof schedule.value)[number]>()
  for (const item of schedule.value) {
    if (
      playheadMs.value >= item.previewStartMs &&
      playheadMs.value < item.previewEndMs
    )
      activeEffect.value = item.index
    if (
      !visible.has(item.effect.target) ||
      playheadMs.value >= item.previewStartMs
    )
      visible.set(item.effect.target, item)
  }
  for (const item of visible.values()) {
    const elapsedMs = Math.min(
      item.effect.durationMs,
      playheadMs.value - item.previewStartMs,
    )
    window.dispatchEvent(
      new CustomEvent('fastppt-animation-preview', {
        detail: { slide: slide.value, effect: item.effect, elapsedMs },
      }),
    )
  }
}

function togglePlayback(): void {
  if (playing.value) {
    playing.value = false
    stopTimer()
    return
  }
  if (!timelineEffects.value.length || totalMs.value <= 0) return
  if (playheadMs.value >= totalMs.value) playheadMs.value = 0
  playing.value = true
  stopTimer()
  syncActive()
  timer = setInterval(() => {
    playheadMs.value = Math.min(totalMs.value, playheadMs.value + 50)
    syncActive()
    if (playheadMs.value >= totalMs.value) {
      playheadMs.value = 0
      window.dispatchEvent(new CustomEvent('fastppt-animation-preview', { detail: { reset: true } }))
      syncActive()
    }
  }, 50)
}
function stepEffect(direction: -1 | 1): void {
  if (!timelineEffects.value.length) return
  const next = Math.max(
    0,
    Math.min(timelineEffects.value.length - 1, activeEffect.value + direction),
  )
  activeEffect.value = next
  playheadMs.value = schedule.value[next]?.previewStartMs ?? 0
  syncActive()
  activeEffect.value = next
  playing.value = false
  stopTimer()
}
function formatMs(value: number): string {
  return `${(value / 1000).toFixed(1)}s`
}
function resetPreview(): void {
  playheadMs.value = 0
  activeEffect.value = -1
  stopTimer()
  playing.value = false
  window.dispatchEvent(
    new CustomEvent('fastppt-animation-preview', { detail: { reset: true } }),
  )
}
onUnmounted(resetPreview)
watch([loading, currentSlideId], ([busy]) => {
  if (!busy && !playing.value && motionPreference.value !== 'reduce') togglePlayback()
}, { flush: 'post' })
watch(
  () => props.deck?.id,
  async (deckId, _previous, onCleanup) => {
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    resetPreview()
    document.value = { version: 1, animations: [] }
    dirty.value = false
    slideIds.value = []
    anchors.value = []
    selectedTarget.value = ''
    pageCount.value = 1
    message.value = ''
    selectedPreset.value = 'static'
    loading.value = Boolean(deckId)
    if (!deckId) return
    try {
      const identities = await client.initializeDeckIdentities(deckId)
      if (cancelled) return
      const [animations, result] = await Promise.all([
        client.getAnimations(deckId),
        client.getDeckIr(deckId),
      ])
      if (cancelled) return
      const ir = result as {
        slides: Array<{ anchors?: string[]; animation?: AnimationDocumentV1 }>
      }
      slideIds.value = identities.slides.map((page) => page.slideId)
      document.value = mergeSourceAnimations(animations, ir.slides)
      selectedPreset.value = result.motionPreset ?? 'static'
      pageCount.value = Math.max(1, ir.slides.length)
      slide.value = Math.max(1, Math.min(pageCount.value, props.page ?? 1))
      anchors.value = ir.slides[slide.value - 1]?.anchors ?? []
      selectedTarget.value = anchors.value[0] ?? ''
    } catch (cause) {
      if (!cancelled)
        message.value = cause instanceof Error ? cause.message : '无法加载动画'
    } finally {
      if (!cancelled) loading.value = false
    }
  },
  { immediate: true },
)
watch(
  () => props.page,
  (page) => {
    if (page !== undefined && Number.isInteger(page))
      slide.value = Math.max(1, Math.min(pageCount.value, page))
  },
)
watch(slide, async () => {
  emit('update:page', slide.value)
  resetPreview()
  if (!props.deck) return
  const deckId = props.deck.id
  const page = slide.value
  const result = await client.getDeckIr(deckId)
  if (props.deck?.id !== deckId || slide.value !== page) return
  const ir = result as {
    slides: Array<{ anchors?: string[]; animation?: AnimationDocumentV1 }>
  }
  anchors.value = ir.slides[page - 1]?.anchors ?? []
  selectedTarget.value = anchors.value[0] ?? ''
})
watch([slide, pageCount], () => {
  if (slide.value > pageCount.value) slide.value = pageCount.value
})
function setCurrent(next: AnimationDocumentV1): void {
  dirty.value = true
  document.value = {
    ...document.value,
    animations: [
      ...document.value.animations.filter(
        (item) => item.slideId !== next.slideId,
      ),
      { ...next, source: 'user' },
    ],
  }
}
function isPathEffect(kind: (typeof effectKinds)[number]): boolean {
  return kind === 'path_line' || kind === 'path_arc'
}
function addEffect(): void {
  const target = selectedTarget.value || anchors.value[0]
  if (!target) return
  if (selectedKind.value === 'native') {
    message.value = '请从创意动效库选择原生效果。'
    return
  }
  const groupId = target
  const groups = current.value.groups.some((group) => group.id === groupId)
    ? current.value.groups
    : [
        ...current.value.groups,
        { id: groupId, label: groupId, effects: [], static: false },
      ]
  const params =
    isPathEffect(selectedKind.value) && selectedPath.value.trim()
      ? { path: selectedPath.value.trim() }
      : {}
  setCurrent({
    ...current.value,
    groups: groups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            effects: [
              ...group.effects,
              {
                id: `effect-${Date.now()}`,
                kind: selectedKind.value,
                target,
                trigger: selectedTrigger.value,
                delayMs: Math.max(0, selectedDelay.value),
                durationMs: Math.max(1, selectedDuration.value),
                params,
              },
            ],
          }
        : group,
    ),
  })
}
function moveEffect(
  groupId: string,
  effectIndex: number,
  direction: -1 | 1,
): void {
  const groups = current.value.groups.map((group) => {
    if (group.id !== groupId) return group
    const nextIndex = effectIndex + direction
    if (nextIndex < 0 || nextIndex >= group.effects.length) return group
    const effects = [...group.effects]
    const [effect] = effects.splice(effectIndex, 1)
    if (effect) effects.splice(nextIndex, 0, effect)
    const slots = group.effects
      .map((item, index) => Number(item.params.sourceOrder ?? index))
      .sort((a, b) => a - b)
    return {
      ...group,
      effects: effects.map((item, index) => ({
        ...item,
        params: { ...item.params, sourceOrder: slots[index] },
      })),
    }
  })
  setCurrent({ ...current.value, groups })
}
function removeEffect(groupId: string, effectId: string): void {
  setCurrent({
    ...current.value,
    groups: current.value.groups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            effects: group.effects.filter((effect) => effect.id !== effectId),
          }
        : group,
    ),
  })
}
function updateEffect(
  groupId: string,
  effectId: string,
  patch: Partial<AnimationDocumentV1['groups'][number]['effects'][number]>,
): void {
  if (patch.target && patch.target !== groupId) {
    try {
      setCurrent(
        rebindAnimationEffect(current.value, groupId, effectId, {
          ...patch,
          target: patch.target,
        }),
      )
    } catch (cause) {
      message.value = cause instanceof Error ? cause.message : String(cause)
      return
    }
    resetPreview()
    return
  }
  setCurrent({
    ...current.value,
    groups: current.value.groups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            effects: group.effects.map((effect) =>
              effect.id === effectId ? { ...effect, ...patch } : effect,
            ),
          }
        : group,
    ),
  })
}
function applyCreative(next: AnimationDocumentV1): void {
  resetPreview()
  // Replace motion only on explicitly selected targets; retain other objects.
  const targets = new Set(
    next.groups.flatMap((group) =>
      group.effects.map((effect) => effect.target),
    ),
  )
  const retained = current.value.groups
    .map((group) => ({
      ...group,
      effects: group.effects.filter((effect) => !targets.has(effect.target)),
    }))
    .filter((group) => group.effects.length)
  const ordered = [
    ...orderedNativeEffects(retained),
    ...orderedNativeEffects(next.groups),
  ]
  const positions = new Map(ordered.map((effect, index) => [effect.id, index]))
  setCurrent({
    ...next,
    groups: [...retained, ...next.groups].map((group) => ({
      ...group,
      effects: group.effects.map((effect) => ({
        ...effect,
        params: { ...effect.params, sourceOrder: positions.get(effect.id) },
      })),
    })),
  })
  message.value = '创意效果已绑定，请保存动画。'
}
async function save(): Promise<void> {
  if (!props.deck) return
  saving.value = true
  try {
    await client.putAnimations(props.deck.id, document.value)
    dirty.value = false
    message.value = '动画已保存'
    setTimeout(() => {
      message.value = ''
    }, 1600)
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <Panel class="animation-panel">
    <Header>
      <Box>
        <Text class="eyebrow">CREATIVE ANIMATION</Text>
        <Heading as="h2">创意动效工作台</Heading>
      </Box>
      <Text v-if="message" class="saved">{{ message }}</Text
      ><Button
        v-if="dirty"
        variant="primary"
        class="primary"
        :disabled="saving || loading"
        @click="save"
      >
        {{ saving ? '保存中…' : '保存已绑定效果' }}
      </Button
      >
    </Header>
    <AnimationGallery
      :anchors="anchors"
      :slide-id="currentSlideId"
      :disabled="!deck || loading"
      @apply="applyCreative"
    />
    <Disclosure class="timeline-details">
      <DisclosureTrigger>当前页动画时间线</DisclosureTrigger>
      <Field>
        预览动态效果
        <SelectField v-model="motionPreference" aria-label="预览动态效果">
          <SelectOption value="system">跟随系统</SelectOption>
          <SelectOption value="reduce">减少动态效果</SelectOption>
          <SelectOption value="full">完整动态效果</SelectOption>
        </SelectField>
      </Field>
      <Text as="p" class="muted">仅影响本机预览，导出保留已保存的动画。</Text>
      <Box class="timeline-toolbar">
        <Field
        >
          动效预设<SelectField v-model="selectedPreset" aria-label="动效预设"
          >
            <SelectOption
              v-for="(preset, id) in motionPresets"
              :key="id"
              :value="id"
            >
              {{ preset.label }}
            </SelectOption
            >
          </SelectField
          >
        </Field
        >
        <Field
        >
          应用范围<SelectField v-model="presetScope" aria-label="动效应用范围"
          >
            <SelectOption value="page">仅本页</SelectOption
            ><SelectOption value="all">全部页面</SelectOption>
          </SelectField
          >
        </Field
        >
        <Field
        >
          <TextField
            v-model="replaceUserAnimations"
            type="checkbox"
          />替换已有动画修改
        </Field
        >
        <Button
          variant="secondary"
          :disabled="!deck || loading"
          @click="applyPreset"
        >
          应用预设
        </Button
        >
      </Box>
      <Text as="p" class="muted"
      >
        预设仅作用于已标记的标题和内容对象，品牌框架保持静态。
      </Text
      >
      <Text v-if="!deck" as="p" class="muted">先选择一个演示文稿。</Text>
      <template v-else>
        <Box class="timeline-toolbar">
          <Button variant="secondary" :disabled="slide <= 1" @click="slide--"
          >
            上一页
          </Button
          ><Text>第 {{ slide }} 页</Text
          ><Button
            variant="secondary"
            :disabled="slide >= pageCount"
            @click="slide++"
          >
            下一页
          </Button
          ><Field>
            对象<SelectField
              v-model="selectedTarget"
              :disabled="!anchors.length"
            >
              <SelectOption v-if="!anchors.length" value=""
              >
                没有可动画对象
              </SelectOption
              >
              <SelectOption
                v-for="anchor in anchors"
                :key="anchor"
                :value="anchor"
              >
                {{ anchor }}
              </SelectOption>
            </SelectField>
          </Field
          ><SelectField v-model="selectedKind">
            <SelectOption v-for="kind in effectKinds" :key="kind" :value="kind">
              {{ kind }}
            </SelectOption>
          </SelectField
          ><SelectField v-model="selectedTrigger">
            <SelectOption value="on-click">点击触发</SelectOption>
            <SelectOption value="with-previous">与上一效果同时</SelectOption>
            <SelectOption value="after-previous"
            >
              上一效果后
            </SelectOption
            >
          </SelectField
          ><Field>
            延迟<TextField
              v-model.number="selectedDelay"
              type="number"
              min="0"
              step="50"
            />ms
          </Field
          ><Field>
            时长<TextField
              v-model.number="selectedDuration"
              type="number"
              min="1"
              step="50"
            />ms
          </Field
          ><Field v-if="isPathEffect(selectedKind)">
            路径<TextField
              v-model="selectedPath"
              placeholder="M 0 0 L 1 0"
              aria-label="动画路径"
            />
          </Field
          ><Button
            variant="primary"
            class="primary"
            :disabled="!anchors.length"
            @click="addEffect"
          >
            添加效果
          </Button>
        </Box>
        <Box class="playback-row">
          <Button variant="secondary" @click="resetPreview">静态预览</Button>
          <Button
            variant="secondary"
            :disabled="!timelineEffects.length"
            @click="stepEffect(-1)"
          >
            上一效果
          </Button
          >
          <Button
            variant="secondary"
            :disabled="!timelineEffects.length"
            @click="togglePlayback"
          >
            {{ playing ? '暂停' : '播放' }}
          </Button
          >
          <Button
            variant="secondary"
            :disabled="!timelineEffects.length"
            @click="stepEffect(1)"
          >
            下一效果
          </Button
          >
          <Text class="muted"
          >
            {{
              activeEffect >= 0
                ? `效果 ${activeEffect + 1}/${timelineEffects.length}`
                : '未开始'
            }}
            · {{ formatMs(playheadMs) }} / {{ formatMs(totalMs) }}
          </Text
          >
          <TextField
            v-model.number="playheadMs"
            type="range"
            min="0"
            :max="Math.max(1, totalMs)"
            step="50"
            aria-label="动画播放进度"
            @input="syncActive"
          />
        </Box>
        <Box class="transition-row">
          <Field>
            页面过渡<SelectField
              :value="current.transition.kind"
              @change="
                setCurrent({
                  ...current,
                  transition: {
                    ...current.transition,
                    kind: ($event.target as HTMLSelectElement)
                      .value as AnimationDocumentV1['transition']['kind'],
                  },
                })
              "
            >
              <SelectOption
                v-for="kind in ['none', 'fade', 'push', 'wipe', 'morph']"
                :key="kind"
              >
                {{ kind }}
              </SelectOption>
            </SelectField>
          </Field>
        </Box>
        <Box v-if="orphanPages.length" class="orphan-warning" role="alert">
          以下动画对应的页面已不存在，原记录仍保留。删除记录后请保存。
          <Text
            v-for="orphanPage in orphanPages"
            :key="orphanPage.slideId"
            as="p"
          >
            {{ orphanPage.slideId }}
            <Button
              variant="secondary"
              @click="removeOrphanPage(orphanPage.slideId)"
            >
              删除失效页面动画
            </Button
            >
          </Text
          >
        </Box>
        <Text
          v-if="orphanEffects.length"
          as="p"
          role="alert"
          class="orphan-warning"
        >
          {{
            orphanEffects.length
          }}
          个效果的对象已不存在。请选择新对象或删除效果；这些绑定会阻止原生导出。
        </Text
        >
        <List as="ol" class="effect-list">
          <ListItem v-for="group in current.groups" :key="group.id">
            <Text as="strong">{{ group.label || group.id }}</Text>
            <Box
              v-for="(effect, effectIndex) in group.effects"
              :key="effect.id"
              class="effect-row"
              :class="{
                active:
                  timelineEffects.findIndex((item) => item.id === effect.id) ===
                  activeEffect,
              }"
            >
              <Field class="effect-target">
                绑定对象
                <SelectField
                  :value="effect.target"
                  :aria-label="`效果 ${effect.id} 的对象`"
                  @change="
                    updateEffect(group.id, effect.id, {
                      target: ($event.target as HTMLSelectElement).value,
                    })
                  "
                >
                  <SelectOption
                    v-if="!anchors.includes(effect.target)"
                    :value="effect.target"
                  >
                    已缺失：{{ effect.target }}
                  </SelectOption
                  >
                  <SelectOption
                    v-for="anchor in anchors"
                    :key="anchor"
                    :value="anchor"
                  >
                    {{ anchor }}
                  </SelectOption
                  >
                </SelectField>
              </Field>
              <SelectField
                :value="effect.kind"
                @change="
                  updateEffect(group.id, effect.id, {
                    kind: ($event.target as HTMLSelectElement)
                      .value as typeof effect.kind,
                  })
                "
              >
                <SelectOption
                  v-for="kind in effectKinds"
                  :key="kind"
                  :value="kind"
                >
                  {{ kind }}
                </SelectOption>
              </SelectField
              ><SelectField
                :value="effect.trigger"
                @change="
                  updateEffect(group.id, effect.id, {
                    trigger: ($event.target as HTMLSelectElement)
                      .value as typeof effect.trigger,
                  })
                "
              >
                <SelectOption value="on-click">点击</SelectOption>
                <SelectOption value="with-previous">同时</SelectOption>
                <SelectOption value="after-previous"
                >
                  之后
                </SelectOption
                >
              </SelectField
              ><TextField
                :value="effect.delayMs"
                type="number"
                min="0"
                step="50"
                aria-label="动画延迟"
                @change="
                  updateEffect(group.id, effect.id, {
                    delayMs: Math.max(
                      0,
                      Number(($event.target as HTMLInputElement).value),
                    ),
                  })
                "
              /><TextField
                :value="effect.durationMs"
                type="number"
                min="1"
                step="50"
                aria-label="动画时长"
                @change="
                  updateEffect(group.id, effect.id, {
                    durationMs: Math.max(
                      1,
                      Number(($event.target as HTMLInputElement).value),
                    ),
                  })
                "
              /><TextField
                v-if="isPathEffect(effect.kind)"
                :value="
                  typeof effect.params.path === 'string'
                    ? effect.params.path
                    : ''
                "
                placeholder="M 0 0 L 1 0"
                aria-label="动画路径"
                @change="
                  updateEffect(group.id, effect.id, {
                    params: {
                      ...effect.params,
                      path: ($event.target as HTMLInputElement).value,
                    },
                  })
                "
              /><Button
                variant="secondary"
                title="上移"
                :disabled="effectIndex === 0"
                @click="moveEffect(group.id, effectIndex, -1)"
              >
                ↑
              </Button
              ><Button
                variant="secondary"
                title="下移"
                :disabled="effectIndex === group.effects.length - 1"
                @click="moveEffect(group.id, effectIndex, 1)"
              >
                ↓
              </Button
              ><Button
                variant="secondary"
                title="删除"
                @click="removeEffect(group.id, effect.id)"
              >
                ×
              </Button>
            </Box>
          </ListItem>
          <ListItem
            v-if="!current.groups.some((group) => group.effects.length)"
            class="muted"
          >
            当前页面还没有对象动画。
          </ListItem>
        </List>
        <Footer>
          <Text class="muted">
            动画只写入 animations.json，导出不支持的效果会显示 warning。
          </Text
          ><Button
            variant="primary"
            class="primary"
            :disabled="saving || loading"
            @click="save"
          >
            {{ saving ? '保存中…' : '保存动画' }}
          </Button>
        </Footer>
      </template>
    </Disclosure>
  </Panel>
</template>
<style scoped>
.orphan-warning {
  color: var(--color-danger);
  border: 1px solid var(--color-danger);
  padding: 10px;
}
.effect-target {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.animation-panel {
  height: 100%;
  padding: 28px;
  overflow: auto;
  color: var(--color-text);
  background: var(--color-panel);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
.timeline-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 18px 0;
  border-bottom: 1px solid var(--color-border);
}
.transition-row {
  padding: 18px 0;
}
.playback-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
}
.playback-row input[type='range'] {
  flex: 1;
  min-width: 180px;
}
.effect-row.active {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
.transition-row label {
  display: flex;
  align-items: center;
  gap: 12px;
}
.effect-list {
  display: grid;
  gap: 12px;
  padding: 0;
  list-style: none;
}
.effect-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-panel-raised);
}
.effect-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.effect-chip {
  padding: 5px 8px;
  border: 1px solid var(--color-border-strong);
  font-size: 12px;
  color: var(--color-accent-strong);
}
footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 18px;
  border-top: 1px solid var(--color-border);
}
footer .primary {
  margin-left: auto;
}
.muted {
  color: var(--color-muted);
  font-size: 13px;
}
.eyebrow {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--color-muted);
}
</style>
