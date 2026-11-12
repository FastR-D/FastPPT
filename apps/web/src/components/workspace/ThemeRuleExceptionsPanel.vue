<script setup lang="ts">
import {
  Box,
  Button,
  Disclosure,
  DisclosureTrigger,
  Field,
  SelectField,
  SelectOption,
  Text,
  TextArea,
} from '@fastrd/ui-vue'
import { computed, ref, watch, type DeepReadonly } from 'vue'
import {
  ThemeRuleExceptionContextRequestSchema,
  type ExportJob,
  type ThemeRuleExceptionReview,
} from '@fastppt/protocol'
import { useGatewayClient } from '../../api/useGatewayClient.js'

const props = defineProps<{
  deckId: string
  options: {
    policy: 'editable' | 'strict-editable' | 'visual-fidelity'
    master: boolean
    notes: boolean
    animations: boolean
    diagrams: boolean
    review: boolean
  }
  exportJob?: DeepReadonly<ExportJob> | undefined
}>()
const emit = defineEmits<{ changed: [] }>()
const client = useGatewayClient()
const opened = ref(false)
const phase = ref<'export' | 'readback'>('export')
const review = ref<ThemeRuleExceptionReview>()
const reasons = ref<Record<string, string>>({})
const error = ref('')
const notice = ref('')
const busy = ref(false)
let generation = 0
const context = computed(() =>
  ThemeRuleExceptionContextRequestSchema.parse({
    phase: phase.value,
    options: props.options,
    profileDigest:
      phase.value === 'readback'
        ? (props.exportJob?.themeRules?.binding?.profileDigest ?? null)
        : null,
    ...(phase.value === 'readback' ? { exportId: props.exportJob?.id } : {}),
  }),
)
const hasReadback = computed(
  () =>
    props.exportJob?.deckId === props.deckId &&
    props.exportJob?.themeRules?.binding &&
    props.exportJob?.themeRules?.readback &&
    !props.exportJob.themeRules.readback.error,
)

async function load(): Promise<void> {
  const request = ++generation
  const deckId = props.deckId,
    input = context.value
  review.value = undefined
  error.value = ''
  busy.value = true
  try {
    const result = await client.reviewRuleExceptions(deckId, input)
    if (request === generation) review.value = result
  } catch (cause) {
    if (request === generation)
      error.value = cause instanceof Error ? cause.message : '规则例外审查失败'
  } finally {
    if (request === generation) busy.value = false
  }
}
watch(
  [
    () => props.deckId,
    context,
    () => props.exportJob?.themeRules?.readback?.checkedAt,
  ],
  () => {
    ++generation
    review.value = undefined
    reasons.value = {}
    notice.value = ''
    busy.value = false
    if (opened.value) void load()
  },
)
function toggle(event: Event): void {
  opened.value = (event.target as HTMLDetailsElement).open
  if (opened.value) void load()
}
async function approve(fingerprint: string): Promise<void> {
  if (!review.value || busy.value) return
  const reason = reasons.value[fingerprint]?.trim()
  if (!reason) return
  const request = generation,
    deckId = props.deckId
  busy.value = true
  try {
    await client.approveRuleException(deckId, {
      ...context.value,
      expectedBinding: review.value.binding,
      issueFingerprint: fingerprint,
      reason,
    })
    if (request !== generation) return
    reasons.value[fingerprint] = ''
    notice.value = '例外已记录。请重新导出；原始违规或未验证状态仍保留。'
    emit('changed')
    await load()
  } catch (cause) {
    if (request === generation)
      error.value = cause instanceof Error ? cause.message : '记录例外失败'
  } finally {
    if (request === generation) busy.value = false
  }
}
async function revoke(id: string): Promise<void> {
  if (busy.value) return
  const request = generation,
    deckId = props.deckId
  busy.value = true
  try {
    await client.revokeRuleException(deckId, id)
    if (request !== generation) return
    notice.value = '例外已撤销。使用此例外的导出须重新检查。'
    emit('changed')
    await load()
  } catch (cause) {
    if (request === generation)
      error.value = cause instanceof Error ? cause.message : '撤销失败'
  } finally {
    if (request === generation) busy.value = false
  }
}
</script>

<template>
  <Disclosure class="rule-exceptions" @toggle="toggle">
    <DisclosureTrigger>审查模板规则例外</DisclosureTrigger>
    <Text as="p">
      例外仅适用于当前文稿、主题、母版和导出配置。导出前与导出后分别批准；内容缺失或文件损坏仍会阻止交付。
    </Text>
    <Field>
      检查阶段
      <SelectField v-model="phase" :disabled="busy" aria-label="例外检查阶段">
        <SelectOption value="export">导出前规则</SelectOption>
        <SelectOption value="readback" :disabled="!hasReadback">
          导出后 PPTX 回读
        </SelectOption>
      </SelectField>
    </Field>
    <Button variant="secondary" type="button" :disabled="busy" @click="load"
    >
      重新检查例外
    </Button
    >
    <Text v-if="error" as="p" role="alert">{{ error }}</Text>
    <Text v-if="notice" as="p" role="status">{{ notice }}</Text>
    <Text v-if="busy" as="p">正在检查…</Text>
    <template v-if="review">
      <Text v-if="!review.issues.length" as="p">此阶段没有模板规则问题。</Text>
      <Box
        v-for="item in review.issues"
        :key="item.fingerprint"
        class="rule-issue"
      >
        <Text as="strong">{{ item.issue.ruleId }}</Text> ·
        {{ item.issue.severity
        }}<Text v-if="item.issue.slide"> · 第 {{ item.issue.slide }} 页</Text>
        <Text as="p">
          {{ item.issue.status === 'unverified' ? '未验证：' : ''
          }}{{ item.issue.message }}
        </Text>
        <Text v-if="item.issue.source" as="p"
        >
          来源：{{ item.issue.source }}
        </Text
        >
        <Text v-if="item.issue.suggestedFix" as="p">
          {{
            item.issue.suggestedFix
          }}
        </Text>
        <Text v-if="item.issue.exception" as="p">
          已批准例外：{{ item.issue.exception.reason }}
        </Text>
        <template v-else>
          <Field :for="`exception-${item.fingerprint}`">
            批准原因 · {{ item.issue.ruleId
            }}<Text v-if="item.issue.slide">
              · 第 {{ item.issue.slide }} 页
            </Text>
          </Field>
          <TextArea
            :id="`exception-${item.fingerprint}`"
            v-model="reasons[item.fingerprint]"
            :disabled="busy"
            maxlength="1000"
            rows="2"
          />
          <Button
            variant="secondary"
            type="button"
            :disabled="busy || !reasons[item.fingerprint]?.trim()"
            @click="approve(item.fingerprint)"
          >
            批准此问题例外
          </Button>
        </template>
      </Box>
      <Disclosure v-if="review.entries.length" class="exception-history" open>
        <DisclosureTrigger
        >
          例外记录 · {{ review.entries.length }}
        </DisclosureTrigger
        >
        <Box
          v-for="entry in review.entries"
          :key="entry.exception.id"
          class="exception-record"
        >
          <Text as="strong">{{ entry.exception.issue.ruleId }}</Text> ·
          {{ entry.exception.phase === 'export' ? '导出前' : '导出后' }} ·
          {{
            { active: '当前有效', expired: '已失效', revoked: '已撤销' }[
              entry.state
            ]
          }}
          <Text as="p">{{ entry.exception.reason }}</Text>
          <Text as="small">
            用户批准于 {{ entry.exception.approvedAt
            }}<Text v-if="entry.exception.revokedAt">
              · 撤销于 {{ entry.exception.revokedAt }}
            </Text>
          </Text>
          <Button
            v-if="entry.state !== 'revoked'"
            variant="secondary"
            type="button"
            :disabled="busy"
            @click="revoke(entry.exception.id)"
          >
            撤销例外
          </Button>
        </Box>
      </Disclosure>
    </template>
  </Disclosure>
</template>

<style scoped>
.rule-exceptions {
  padding: 12px;
  border: 1px solid var(--color-border);
  font-size: 13px;
  overflow-wrap: anywhere;
}
p {
  margin: 8px 0;
  line-height: 1.5;
}
textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 6px 0;
  resize: vertical;
}
button {
  margin: 6px;
}
.rule-issue,
.exception-record {
  border-top: 1px solid var(--color-border);
  margin-top: 10px;
  padding-top: 10px;
}
[role='alert'] {
  color: var(--color-danger);
}
[role='status'] {
  color: var(--color-accent-strong);
}
small {
  display: block;
  color: var(--color-muted);
}
</style>
