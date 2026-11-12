<script setup lang="ts">
import {
  Box,
  Button,
  Footer,
  Header,
  Heading,
  Panel,
  Text,
  TextArea,
  TextField,
} from '@fastrd/ui-vue'
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  resolveGatewayUrl,
  useGatewayClient,
} from '../../api/useGatewayClient.js'
import {
  estimateNotesSeconds,
  type DeckNotesDocument,
  type DeckSummary,
  type SpeakerNotesDocumentV1,
} from '@fastppt/protocol'

const props = defineProps<{ deck: DeckSummary | undefined; page: number }>()
const emit = defineEmits<{ 'update:page': [page: number] }>()
const client = useGatewayClient()
const document = ref<DeckNotesDocument>({ version: 1, notes: [] })
const drafts = ref<Record<string, SpeakerNotesDocumentV1>>({})
const slide = computed(() => props.page)
const slideIds = ref<string[]>([])
const currentSlideId = computed(
  () => slideIds.value[slide.value - 1] ?? `slide-${slide.value}`,
)
const loading = ref(false)
const loadError = ref('')
let loadGeneration = 0
const saving = ref(false)
const saveError = ref('')
const message = ref('')
let messageTimer: ReturnType<typeof setTimeout> | undefined
const query = ref('')
const current = computed<SpeakerNotesDocumentV1>(
  () =>
    drafts.value[currentSlideId.value] ?? document.value.notes.find(
      (note) => note.slideId === currentSlideId.value,
    ) ?? {
      version: 1,
      slideId: currentSlideId.value,
      spokenText: '',
      format: 'plain',
      language: 'zh-CN',
      estimatedSeconds: 0,
      cues: [],
      status: 'draft',
    },
)
function updateNote(changes: Partial<Pick<SpeakerNotesDocumentV1, 'spokenText' | 'cues'>>): void {
  drafts.value[currentSlideId.value] = { ...current.value, ...changes }
  message.value = ''
  saveError.value = ''
}
const text = computed({
  get: () => current.value.spokenText,
  set: (spokenText: string) => updateNote({ spokenText }),
})
const cues = computed(() => current.value.cues)
const seconds = computed(() => estimateNotesSeconds(text.value))
const matches = computed(() =>
  slideIds.value.flatMap((slideId, index) => {
    const note = drafts.value[slideId] ?? document.value.notes.find((note) => note.slideId === slideId)
    return note &&
      query.value.trim() &&
      note.spokenText.toLowerCase().includes(query.value.trim().toLowerCase())
      ? [{ page: index + 1, slideId }]
      : []
  }),
)
const editable = computed(() => !!props.deck && !loading.value && !loadError.value && !!slideIds.value[slide.value - 1])
function selectPage(page: number): void {
  if (!slideIds.value.length) return
  emit('update:page', Math.max(1, Math.min(page, slideIds.value.length)))
}
async function loadNotes(): Promise<void> {
  const generation = ++loadGeneration
  const deckId = props.deck?.id
  document.value = { version: 1, notes: [] }
  drafts.value = {}
  slideIds.value = []
  message.value = ''
  loadError.value = ''
  saveError.value = ''
  query.value = ''
  loading.value = false
  if (!deckId) return
  loading.value = true
  try {
    const result = await client.initializeDeckIdentities(deckId)
    const notes = await client.getNotes(deckId)
    if (generation !== loadGeneration) return
    slideIds.value = result.slides.map((page) => page.slideId)
    document.value = notes
    selectPage(slide.value)
  } catch (cause) {
    if (generation === loadGeneration)
      loadError.value = cause instanceof Error ? cause.message : '无法加载讲稿'
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}
watch(() => props.deck?.id, loadNotes, { immediate: true })
onUnmounted(() => {
  loadGeneration++
  clearTimeout(messageTimer)
})
function addCue(): void {
  const start = cues.value.at(-1)?.endSeconds ?? 0
  updateNote({ cues: [...cues.value, {
    startSeconds: start,
    endSeconds: Math.max(start + 1, start + 2),
    text: '',
  }] })
}
function removeCue(index: number): void {
  updateNote({ cues: cues.value.filter((_cue, cueIndex) => cueIndex !== index) })
}
function updateCue(index: number, changes: Partial<SpeakerNotesDocumentV1['cues'][number]>): void {
  updateNote({ cues: cues.value.map((cue, cueIndex) => cueIndex === index ? { ...cue, ...changes } : cue) })
}
async function save(): Promise<void> {
  if (!props.deck || !editable.value || saving.value) return
  const deckId = props.deck.id
  const generation = loadGeneration
  const draft = drafts.value[currentSlideId.value]
  saving.value = true
  saveError.value = ''
  const normalizedCues = cues.value.map((cue) => ({
    startSeconds: Math.max(0, Number(cue.startSeconds) || 0),
    endSeconds: Math.max(
      Math.max(0, Number(cue.startSeconds) || 0),
      Number(cue.endSeconds) || 0,
    ),
    text: cue.text,
  }))
  const note = {
    ...current.value,
    spokenText: text.value,
    estimatedSeconds: seconds.value,
    cues: normalizedCues,
  }
  const nextDocument: DeckNotesDocument = {
    ...document.value,
    notes: [
      ...document.value.notes.filter((item) => item.slideId !== note.slideId),
      note,
    ],
  }
  try {
    await client.putNotes(deckId, nextDocument)
    if (generation !== loadGeneration) return
    document.value = nextDocument
    if (drafts.value[note.slideId] === draft) delete drafts.value[note.slideId]
    message.value = '备注已保存'
    clearTimeout(messageTimer)
    messageTimer = setTimeout(() => {
      message.value = ''
    }, 1600)
  } catch (cause) {
    if (generation === loadGeneration)
      saveError.value = cause instanceof Error ? cause.message : '保存备注失败'
  } finally {
    saving.value = false
  }
}
async function downloadSrt(): Promise<void> {
  if (!props.deck) return
  const response = await fetch(
    `${resolveGatewayUrl()}/api/v1/decks/${encodeURIComponent(props.deck.id)}/notes.srt`,
  )
  if (!response.ok) throw new Error('SRT 导出失败')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url
  link.download = `${props.deck.name || 'deck'}.srt`
  link.click()
  URL.revokeObjectURL(url)
}
</script>
<template>
  <Panel class="notes-panel">
    <Header>
      <Box>
        <Text class="eyebrow">SPEAKER NOTES</Text>
        <Heading as="h2">讲稿备注</Heading>
      </Box>
      <Text v-if="message" class="saved" role="status">{{ message }}</Text>
    </Header>
    <Text v-if="loadError" as="p" role="alert"
    >
      {{ loadError }}
      <Button variant="secondary" @click="loadNotes">重试加载</Button>
    </Text
    >
    <Text v-if="saveError" as="p" class="error" role="alert">{{ saveError }}</Text>
    <Text v-if="!deck" as="p" class="muted">先选择一个演示文稿。</Text>
    <template v-else>
      <Box class="search-row">
        <TextField
          v-model="query"
          aria-label="搜索备注"
          placeholder="搜索备注"
        /><Button
          v-for="note in matches"
          :key="note.slideId"
          variant="secondary"
          type="button"
          @click="selectPage(note.page)"
        >
          第 {{ note.page }} 页
        </Button>
      </Box>
      <Box class="note-toolbar">
        <Button
          variant="secondary"
          type="button"
          :disabled="!editable || slide <= 1"
          @click="selectPage(slide - 1)"
        >
          上一页
        </Button
        ><Text>第 {{ slide }} 页</Text
        ><Button variant="secondary" type="button" :disabled="!editable || slide >= slideIds.length" @click="selectPage(slide + 1)"
        >
          下一页
        </Button
        ><Text class="estimate">预计 {{ seconds }} 秒</Text>
      </Box>
      <TextArea
        v-model="text"
        :disabled="!editable"
        aria-label="当前页备注"
        placeholder="写下这一页要说的话…"
      />
      <Panel class="cue-editor">
        <Box class="cue-header">
          <Heading as="h3">讲稿时间线</Heading>
          <Box
          >
            <Button variant="secondary" type="button" :disabled="!editable" @click="addCue"
            >
              添加 cue
            </Button
            ><Button variant="secondary" type="button" :disabled="!editable" @click="downloadSrt"
            >
              下载 SRT
            </Button
            >
          </Box
          >
        </Box>
        <Text v-if="!cues.length" as="p" class="muted">
          暂无 cue，可按语句添加时间标记。
        </Text>
        <Box v-for="(cue, index) in cues" :key="index" class="cue-row">
          <TextField
            :model-value="cue.startSeconds"
            :disabled="!editable"
            type="number"
            min="0"
            step="0.1"
            aria-label="cue 开始时间"
            @update:model-value="updateCue(index, { startSeconds: Number($event) || 0 })"
          /><TextField
            :model-value="cue.endSeconds"
            :disabled="!editable"
            type="number"
            min="0"
            step="0.1"
            aria-label="cue 结束时间"
            @update:model-value="updateCue(index, { endSeconds: Number($event) || 0 })"
          /><TextField
            :model-value="cue.text"
            :disabled="!editable"
            aria-label="cue 文本"
            placeholder="这一段要说的话"
            @update:model-value="updateCue(index, { text: String($event) })"
          /><Button
            variant="secondary"
            type="button"
            aria-label="删除 cue"
            @click="removeCue(index)"
          >
            ×
          </Button>
        </Box>
      </Panel>
      <Footer>
        <Text class="muted">原始备注会随 deck 保存，并可在导出审查中检查。</Text
        ><Button
          variant="primary"
          type="button"
          class="primary"
          :disabled="!editable || saving"
          @click="save"
        >
          {{ saving ? '保存中…' : '保存备注' }}
        </Button>
      </Footer>
    </template>
  </Panel>
</template>
<style scoped>
.notes-panel {
  container-type: inline-size;
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
.search-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 16px 0;
}
.search-row input {
  width: min(300px, 100%);
  min-width: 0;
}
.note-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 18px 0;
  color: var(--color-muted);
}
.estimate {
  margin-left: auto;
}
.notes-panel textarea {
  width: 100%;
  min-height: 280px;
  resize: vertical;
  line-height: 1.7;
}
.cue-editor {
  width: 100%;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}
.cue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}
.cue-header > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cue-header h3 {
  margin: 0;
}
.cue-row {
  display: grid;
  grid-template-columns: 90px 90px minmax(0, 1fr) 34px;
  gap: 8px;
  margin-top: 8px;
}
.cue-row input {
  min-width: 0;
}
.notes-panel footer {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  max-width: 760px;
  padding-top: 16px;
}
.notes-panel footer .primary {
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
.error {
  color: var(--color-danger);
}
@container (max-width: 420px) {
  .cue-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 30px;
  }
  .cue-row input:nth-child(3) {
    grid-column: 1 / 3;
    grid-row: 2;
  }
  .cue-row button {
    grid-column: 3;
    grid-row: 1 / 3;
  }
}
@media (max-width: 600px) {
  .notes-panel {
    padding: 16px;
  }
}
</style>
