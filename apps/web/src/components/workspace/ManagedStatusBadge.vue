<script setup lang="ts">
import { Box, Button, Header, Heading, Panel, Text } from '@fastppt/components'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import type { McpConfigStatus, SkillInstallStatus } from '@fastppt/protocol'

const props = defineProps<{
  skillStatuses: readonly SkillInstallStatus[]
  mcpStatus: McpConfigStatus | undefined
  harnessLabel?: string
}>()

const open = ref(false)

type Severity = 'healthy' | 'attention' | 'critical'
const CRITICAL_STATES = new Set(['missing', 'conflict', 'disabled'])
const ATTENTION_STATES = new Set(['update-available', 'pending-trust'])

const totalSkills = computed(() => props.skillStatuses.filter(status => status.state !== 'on-demand').length)
const installedSkills = computed(
  () => props.skillStatuses.filter((s) => s.state === 'installed').length,
)
const totalManaged = computed(
  () => totalSkills.value + (props.mcpStatus ? 1 : 0),
)

const severity = computed<Severity>(() => {
  const criticalSkill = props.skillStatuses.some((s) =>
    CRITICAL_STATES.has(s.state),
  )
  const criticalMcp =
    props.mcpStatus !== undefined && CRITICAL_STATES.has(props.mcpStatus.state)
  if (criticalSkill || criticalMcp) return 'critical'
  const attentionSkill = props.skillStatuses.some((s) =>
    ATTENTION_STATES.has(s.state),
  )
  const attentionMcp = props.mcpStatus?.state === 'pending-trust'
  if (attentionSkill || attentionMcp) return 'attention'
  return 'healthy'
})

const stateLabel: Record<string, string> = {
  'on-demand': '按需接入',
  installed: '已安装',
  configured: '已配置',
  missing: '缺失',
  'update-available': '有更新',
  conflict: '冲突',
  disabled: '已禁用',
  'pending-trust': '待信任',
}

const mcpStateLabel = computed(() =>
  props.mcpStatus
    ? (stateLabel[props.mcpStatus.state] ?? props.mcpStatus.state)
    : '未配置',
)

function close(): void {
  open.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Button
    size="xs"
    variant="quiet"
    type="button"
    class="managed-badge-button"
    :class="severity"
    :title="`${installedSkills}/${totalSkills} 个 Skill 已安装 · MCP ${mcpStateLabel}`"
    aria-label="查看 Skill 与 MCP 安装状态"
    aria-haspopup="dialog"
    @click="open = true"
  >
    <Text class="badge-dot" aria-hidden="true" />
    <Text class="badge-count">
      {{
        severity === 'critical'
          ? '环境需修复'
          : severity === 'attention'
            ? '环境待确认'
            : '环境就绪'
      }}
      · {{ totalManaged }}
    </Text>
  </Button>

  <Teleport to="body">
    <Box
      v-if="open"
      class="modal-backdrop"
      role="presentation"
      @mousedown.self="close"
    >
      <Panel
        class="status-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Skill 与 MCP 安装状态"
      >
        <Header class="modal-header">
          <Box>
            <Text class="eyebrow">安装状态</Text>
            <Heading as="h2">Skill 与 MCP</Heading>
            <Text v-if="harnessLabel" as="p" class="modal-harness">
              {{
                harnessLabel
              }}
            </Text>
          </Box>
          <Button
            variant="secondary"
            type="button"
            class="close-button"
            aria-label="关闭"
            @click="close"
          >
            ×
          </Button>
        </Header>

        <Box class="modal-content">
          <Box class="modal-summary" :class="severity">
            <Text>{{ installedSkills }}/{{ totalSkills }} 个 Skill 已安装</Text>
            <Text class="summary-mcp">MCP {{ mcpStateLabel }}</Text>
          </Box>

          <Box class="status-list">
            <Box
              v-for="skill in skillStatuses"
              :key="skill.skillId"
              class="status-row"
            >
              <Text class="row-main">
                {{ skill.skillId }}
                <Text
                  v-if="skill.kind === 'theme'"
                  as="small"
                  class="row-theme"
                >
                  {{ skill.themeId }}
                </Text>
              </Text>
              <Text class="row-side">
                <Text
                  v-if="skill.expectedVersion"
                  as="small"
                  class="row-version"
                >
                  {{ skill.expectedVersion }}
                </Text>
                <Text as="em" :class="['row-state', `state-${skill.state}`]">
                  {{ stateLabel[skill.state] ?? skill.state }}
                </Text>
              </Text>
              <Text v-if="skill.message" as="p" class="row-message">
                {{ skill.message }}
              </Text>
            </Box>

            <Box v-if="mcpStatus" class="status-row">
              <Text class="row-main">fastppt MCP</Text>
              <Text class="row-side">
                <Text
                  as="em"
                  :class="['row-state', `state-${mcpStatus.state}`]"
                >
                  {{ stateLabel[mcpStatus.state] ?? mcpStatus.state }}
                </Text>
              </Text>
              <Text v-if="mcpStatus.message" as="p" class="row-message">
                {{ mcpStatus.message }}
              </Text>
            </Box>

            <Box
              v-if="!skillStatuses.length && !mcpStatus"
              class="status-empty"
            >
              暂无状态信息
            </Box>
          </Box>
        </Box>
      </Panel>
    </Box>
  </Teleport>
</template>

<style scoped>
/* Compact environment status in the workbench status bar. */
.managed-badge-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  line-height: 1;
}

.badge-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 16%, transparent);
  transition:
    background 120ms ease,
    box-shadow 120ms ease;
}

.managed-badge-button.attention .badge-dot {
  background: var(--color-warning);
  box-shadow: 0 0 0 2px rgb(252 211 77 / 18%);
}

.managed-badge-button.critical .badge-dot {
  background: var(--color-danger);
  box-shadow: 0 0 0 2px rgb(248 113 113 / 18%);
}

.badge-count {
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

/* Modal — matches the theme-catalog modal pattern: dimmed + blurred backdrop,
   centered panel with its own top/bottom bounds and internal scrolling. */
.modal-backdrop {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--color-overlay);
}

.status-modal {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(520px, 100%);
  max-height: min(620px, calc(100dvh - 48px));
  overflow: hidden;
  border: 1px solid var(--color-border-strong);
  border-radius: 14px;
  background: var(--color-panel-raised);
  box-shadow: var(--shadow-modal);
}

.modal-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--color-border);
}

.eyebrow {
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.modal-header h2 {
  margin-top: 3px;
  font-size: 18px;
}

.modal-harness {
  margin-top: 3px;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.close-button {
  width: 30px;
  height: 30px;
  line-height: 1;
}

.modal-content {
  min-height: 0;
  padding: 14px 22px 20px;
  overflow: auto;
}

.modal-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px 12px;
  border-radius: 9px;
  color: var(--color-accent-strong);
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  font-family: var(--font-mono);
  font-size: 11px;
}

.modal-summary.attention {
  color: var(--color-warning);
  background: color-mix(in srgb, var(--color-warning) 14%, transparent);
}

.modal-summary.critical {
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 14%, transparent);
}

.status-list {
  display: grid;
  gap: 2px;
}

.status-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 8px;
  padding: 8px 10px;
  border-radius: 8px;
}

.status-row:hover {
  background: var(--color-panel);
}

.row-main {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-theme {
  margin-left: 5px;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.row-side {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

.row-version {
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.row-state {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-style: normal;
  white-space: nowrap;
}

.row-state.state-installed,
.row-state.state-configured {
  color: var(--color-accent-strong);
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
}

.row-state.state-update-available,
.row-state.state-pending-trust {
  color: var(--color-warning);
  background: color-mix(in srgb, var(--color-warning) 14%, transparent);
}

.row-state.state-missing,
.row-state.state-conflict,
.row-state.state-disabled {
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 14%, transparent);
}

.row-message {
  flex-basis: 100%;
  margin: 0;
  color: var(--color-muted);
  font-size: 10px;
  line-height: 1.4;
}

.status-empty {
  padding: 18px 8px;
  color: var(--color-muted);
  font-size: 11px;
  text-align: center;
}

/* Narrow screens: keep just the signal dot beside the brand text. */
@media (max-width: 720px) {
  .managed-badge-button {
    width: 16px;
    justify-content: center;
  }
  .badge-count {
    display: none;
  }
}
</style>
