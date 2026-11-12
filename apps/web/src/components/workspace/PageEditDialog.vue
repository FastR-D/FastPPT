<script setup lang="ts">
import {
  Modal,
  Box,
  Button,
  Footer,
  Header,
  Heading,
  Text,
  TextArea,
} from '@fastrd/ui-vue'
import { computed, shallowRef, watch } from 'vue'
import ResourceGallery from './ResourceGallery.vue'
import type { LayoutResourceSummary, SlideRegion } from '@fastppt/protocol'
import type { PageEditRequest } from '../../workspace/visual-edit.js'
const props = defineProps<{
  open: boolean
  path: string
  page: number
  sending: boolean
  browseInitially?: boolean
  resource?: LayoutResourceSummary | undefined
  region?: SlideRegion | undefined
}>()
const emit = defineEmits<{ close: []; submit: [input: PageEditRequest] }>()
const instruction = shallowRef('')
const chosen = shallowRef<LayoutResourceSummary>()
const browsing = shallowRef(false)
function chooseLayout(resource: LayoutResourceSummary): void {
  chosen.value = resource
  browsing.value = false
}
watch(
  () => props.open,
  (open) => {
    if (open) {
      instruction.value = ''
      chosen.value = props.resource
      browsing.value = props.browseInitially ?? false
    }
  },
  { immediate: true },
)
const canSubmit = computed(
  () => (instruction.value.trim() || chosen.value) && !props.sending,
)
function submit(): void {
  if (canSubmit.value)
    emit('submit', {
      instruction: instruction.value.trim() || '使用所选版式重做目标内容',
      resource: chosen.value,
      region: props.region,
    })
}
</script>

<template>
  <Modal
    :open="open"
    :dismissible="!sending"
    size="lg"
    labelledby="page-edit-title"
    class="page-dialog"
    @close="emit('close')"
  >
    <Header>
      <Box>
        <Text as="small">{{ region ? '选区修改' : '单页修改' }}</Text>
        <Heading id="page-edit-title" as="h2"
        >
          {{ path }} · 第 {{ page }} 页
        </Heading
        >
      </Box>
      <Button
        variant="icon"
        :disabled="sending"
        aria-label="关闭单页编辑"
        @click="emit('close')"
      >
        ×
      </Button>
    </Header>
    <Text as="p" class="branch-note">
      沿用当前对话的上下文创建编辑分支，其他页面保持不变。
    </Text>
    <Text v-if="region" as="p" class="selection-note">
      选区：左 {{ Math.round(region.x * 100) }}% · 上
      {{ Math.round(region.y * 100) }}% · 宽
      {{ Math.round(region.width * 100) }}% · 高
      {{ Math.round(region.height * 100) }}%
    </Text>
    <Box class="layout-choice">
      <Button
        variant="secondary"
        :disabled="sending"
        @click="browsing = !browsing"
      >
        {{ chosen ? '更换版式' : '选择版式 / 逻辑图' }}
      </Button
      ><Text v-if="chosen">
        {{ chosen.title }}
        <Button
          variant="icon"
          :disabled="sending"
          aria-label="移除版式"
          @click="chosen = undefined"
        >
          ×
        </Button>
      </Text
      ><Text v-else as="small">也可以让 Agent 自由设计</Text>
    </Box>
    <ResourceGallery
      v-if="browsing"
      compact
      @choose="chooseLayout"
    />
    <TextArea
      v-model="instruction"
      :disabled="sending"
      rows="5"
      autofocus
      aria-label="单页修改要求"
      :placeholder="
        region
          ? '例如：把这里改成三步流程，缩短说明并保持配色。'
          : '描述修改要求，或选择一个版式重做这一页。'
      "
      @keydown.ctrl.enter.prevent="submit"
      @keydown.meta.enter.prevent="submit"
    ></TextArea>
    <Footer>
      <Button
        size="md"
        variant="secondary"
        type="button"
        :disabled="sending"
        class="secondary"
        @click="emit('close')"
      >
        取消
      </Button
      ><Button
        size="md"
        variant="primary"
        type="button"
        class="primary"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ sending ? '创建中…' : '创建分支并修改' }}
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
  padding: 16px 18px;
}
header {
  border-bottom: 1px solid var(--color-border);
}
footer {
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--color-border);
}
h2 {
  margin: 3px 0 0;
  font-size: 15px;
}
small {
  color: var(--color-muted);
}
textarea {
  width: calc(100% - 36px);
  margin: 18px;
  resize: vertical;
  box-sizing: border-box;
}
.branch-note,
.selection-note {
  margin: 14px 18px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}
.selection-note {
  color: var(--color-accent-strong);
}
.layout-choice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin: 18px;
  font-size: 12px;
}
.layout-choice span {
  color: var(--color-accent-strong);
}
</style>
