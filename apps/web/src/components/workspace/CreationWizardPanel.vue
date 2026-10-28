<script setup lang="ts">
import {
  Panel,
  Modal,
  ModalBody,
  Box,
  Button,
  Field,
  Footer,
  Header,
  Heading,
  List,
  ListItem,
  SelectField,
  SelectOption,
  Text,
  TextArea,
  TextField,
} from '@fastppt/components'
import { computed, ref, shallowRef, watch } from 'vue'
import { useGatewayClient } from '../../api/useGatewayClient.js'
import {
  readWizardChoice,
  wizardSteps,
  wizardLabels,
  wizardChoices,
} from '../../workspace/creation-wizard.js'
import type { CreationWizard } from '@fastppt/protocol'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; committed: [wizard: CreationWizard] }>()
const client = useGatewayClient()
const wizard = shallowRef<CreationWizard>()
const loading = shallowRef(false)
const error = shallowRef<string>()
const note = ref('')
const choice = ref('')
const locked = ref(false)
const steps = wizardSteps
const labels = wizardLabels
const choices = wizardChoices
const currentIndex = computed(() =>
  Math.max(
    0,
    steps.indexOf(
      (wizard.value?.currentStep ?? 'task') as (typeof steps)[number],
    ),
  ),
)
const currentLabel = computed(() => labels[steps[currentIndex.value] ?? 'task'])
const currentChoices = computed(
  () => choices[steps[currentIndex.value] ?? 'task'],
)
const impactedOutputs = computed(() => {
  const impacts: Record<(typeof steps)[number], string[]> = {
    task: ['会话创建路线', '源 deck 与主题保留策略', '首轮生成提示'],
    content: ['研究与引用策略', '事实核查要求', '资料来源约束'],
    visual: ['主题与版式密度', '图片和图表策略', '母版快照'],
    delivery: ['PPTX 导出选项', '备注、动画与母版交付物', '输出文件命名策略'],
  }
  const current = impacts[steps[currentIndex.value] ?? 'task']
  return choice.value || note.value.trim() ? current : current.slice(0, 2)
})

function restoreStep(): void {
  const decision = wizard.value?.decisions.find(
    (d) => d.stepId === wizard.value?.currentStep,
  )
  const restored = readWizardChoice(decision)
  choice.value = restored.choice
  note.value = restored.note
  locked.value = decision?.locked ?? false
}
async function run(action: () => Promise<void>): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = undefined
  try {
    await action()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法保存向导'
  } finally {
    loading.value = false
  }
}
async function load(): Promise<void> {
  if (!props.open) return
  await run(async () => {
    const saved = localStorage.getItem('fastppt.creation-wizard')
    wizard.value = saved
      ? await client.getCreationWizard(saved)
      : await client.createCreationWizard()
    localStorage.setItem('fastppt.creation-wizard', wizard.value.id)
    if (wizard.value.status === 'committed') {
      emit('committed', wizard.value)
      emit('close')
      return
    }
    restoreStep()
  })
}
async function saveStep(next: string): Promise<void> {
  if (!wizard.value) return
  const existing = wizard.value.decisions.find(
    (d) => d.stepId === wizard.value?.currentStep,
  )
  const decision = existing?.locked
    ? existing
    : {
        version: 1 as const,
        stepId: wizard.value.currentStep,
        question: `${currentLabel.value}配置`,
        options: currentChoices.value,
        selected: JSON.stringify({
          choice: choice.value,
          note: note.value.trim(),
        }),
        actor: 'user' as const,
        locked: locked.value,
        timestamp: new Date().toISOString(),
      }
  wizard.value = await client.updateCreationWizard(wizard.value.id, {
    currentStep: next,
    decision,
  })
  restoreStep()
}
async function advance(): Promise<void> {
  await run(() =>
    saveStep(steps[Math.min(currentIndex.value + 1, steps.length - 1)]!),
  )
}
async function back(): Promise<void> {
  if (currentIndex.value === 0) return
  await run(() => saveStep(steps[currentIndex.value - 1]!))
}
async function close(): Promise<void> {
  if (!wizard.value || wizard.value.status !== 'draft') {
    emit('close')
    return
  }
  await run(async () => {
    await saveStep(wizard.value!.currentStep)
    emit('close')
  })
}
async function commit(): Promise<void> {
  await run(async () => {
    if (!wizard.value) return
    await saveStep(wizard.value.currentStep)
    wizard.value = await client.commitCreationWizard(wizard.value.id)
    // Keep the pointer until session creation succeeds, so a failed handoff is resumable.
    emit('committed', wizard.value)
    emit('close')
  })
}
watch(
  () => props.open,
  (open) => {
    if (open) void load()
  },
  { immediate: true },
)
</script>

<template>
  <Modal
    :open="open"
    labelledby="wizard-title"
    class="wizard-panel"
    @close="close"
  >
    <Header>
      <Box>
        <Text class="eyebrow">CREATION WIZARD</Text>
        <Heading id="wizard-title" as="h2">创建向导</Heading>
      </Box>
      <Button
        variant="icon"
        class="icon-button"
        aria-label="关闭"
        @click="close"
      >
        ×
      </Button
      >
    </Header>
    <Box class="wizard-steps">
      <Text
        v-for="(step, index) in steps"
        :key="step"
        :class="{
          active: index === currentIndex,
          done: index < currentIndex,
        }"
      >
        {{ index + 1 }} {{ labels[step] }}
      </Text>
    </Box>
    <ModalBody class="wizard-body" :aria-busy="loading">
      <Text v-if="loading" as="p">正在恢复向导…</Text>
      <Text v-if="error" as="p" class="error">{{ error }}</Text>
      <template v-if="wizard && !loading">
        <Box class="wizard-intro">
          <Text as="strong">{{ currentLabel }}设置</Text>
          <Text as="p">当前选择会被保存为可审计决策，稍后可继续编辑。</Text>
        </Box>
        <Field>
          推荐选项<SelectField v-model="choice" :disabled="locked">
            <SelectOption value="">自定义</SelectOption>
            <SelectOption
              v-for="item in currentChoices"
              :key="item"
              :value="item"
            >
              {{ item }}
            </SelectOption>
          </SelectField>
        </Field
        ><Field>
          本步备注<TextArea
            v-model="note"
            :disabled="locked"
            placeholder="记录本步的约束或决定"
          />
        </Field
        ><Field class="lock-choice">
          <TextField
            v-model="locked"
            type="checkbox"
            :disabled="
              wizard?.decisions.some(
                (d) => d.stepId === wizard?.currentStep && d.locked,
              )
            "
          />锁定本步决策，防止后续自动修改
        </Field>
        <Panel class="impact">
          <Text as="strong">受影响的输出</Text>
          <List>
            <ListItem v-for="item in impactedOutputs" :key="item">
              {{
                item
              }}
            </ListItem>
          </List>
        </Panel>
      </template>
    </ModalBody>
    <Footer>
      <Button size="md" variant="secondary" class="secondary" @click="close"
      >
        稍后继续
      </Button
      ><Button
        v-if="currentIndex > 0"
        size="md"
        variant="secondary"
        class="secondary"
        :disabled="loading || !wizard"
        @click="back"
      >
        上一步
      </Button
      ><Button
        v-if="currentIndex < steps.length - 1"
        size="md"
        variant="primary"
        class="primary"
        :disabled="loading || !wizard"
        @click="advance"
      >
        保存并继续
      </Button
      ><Button
        v-else
        size="md"
        variant="primary"
        class="primary"
        :disabled="loading || !wizard"
        @click="commit"
      >
        保存并配置会话
      </Button>
    </Footer>
  </Modal>
</template>

<style scoped>
.wizard-panel h2 {
  margin: 4px 0 0;
}
.eyebrow {
  color: var(--color-muted);
  font-size: 10px;
  letter-spacing: 0.1em;
}
.wizard-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px var(--fp-modal-padding);
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
  color: var(--color-muted);
}
.wizard-steps span.active {
  color: var(--color-accent-strong);
  font-weight: 700;
}
.wizard-steps span.done {
  color: var(--color-text);
}
.wizard-body {
  min-height: 180px;
}
.wizard-intro {
  display: grid;
  gap: 6px;
}
.wizard-body p {
  margin: 0;
  color: var(--color-muted);
}
.impact {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-panel-raised);
  font-size: 12px;
}
.impact ul {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
}
textarea {
  width: 100%;
  min-height: 76px;
  resize: vertical;
}
.lock-choice {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-muted);
  font-size: 13px;
}
.error {
  color: var(--color-danger);
}
</style>
