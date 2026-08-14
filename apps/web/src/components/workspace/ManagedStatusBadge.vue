<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import type {
  McpConfigStatus,
  SkillInstallStatus,
} from '@fastppt/protocol'

const props = defineProps<{
  skillStatuses: readonly SkillInstallStatus[]
  mcpStatus: McpConfigStatus | undefined
  harnessLabel?: string
}>()

const open = ref(false)

type Severity = 'healthy' | 'attention' | 'critical'
const CRITICAL_STATES = new Set(['missing', 'conflict', 'disabled'])
const ATTENTION_STATES = new Set(['update-available', 'pending-trust'])

const totalSkills = computed(() => props.skillStatuses.length)
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
    ? stateLabel[props.mcpStatus.state] ?? props.mcpStatus.state
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
  <button
    type="button"
    class="managed-badge-button"
    :class="severity"
    :title="`${installedSkills}/${totalSkills} 个 Skill 已安装 · MCP ${mcpStateLabel}`"
    aria-label="查看 Skill 与 MCP 安装状态"
    aria-haspopup="dialog"
    @click="open = true"
  >
    <span class="badge-dot" aria-hidden="true" />
    <span class="badge-count">{{ totalManaged }}</span>
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      class="modal-backdrop"
      role="presentation"
      @mousedown.self="close"
    >
      <section
        class="status-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Skill 与 MCP 安装状态"
      >
        <header class="modal-header">
          <div>
            <span class="eyebrow">安装状态</span>
            <h2>Skill 与 MCP</h2>
            <p v-if="harnessLabel" class="modal-harness">{{ harnessLabel }}</p>
          </div>
          <button
            type="button"
            class="close-button"
            aria-label="关闭"
            @click="close"
          >
            ×
          </button>
        </header>

        <div class="modal-content">
          <div class="modal-summary" :class="severity">
            <span>{{ installedSkills }}/{{ totalSkills }} 个 Skill 已安装</span>
            <span class="summary-mcp">MCP {{ mcpStateLabel }}</span>
          </div>

          <div class="status-list">
            <div
              v-for="skill in skillStatuses"
              :key="skill.skillId"
              class="status-row"
            >
              <span class="row-main">
                {{ skill.skillId }}
                <small v-if="skill.kind === 'theme'" class="row-theme">
                  {{ skill.themeId }}
                </small>
              </span>
              <span class="row-side">
                <small v-if="skill.expectedVersion" class="row-version">
                  {{ skill.expectedVersion }}
                </small>
                <em :class="['row-state', `state-${skill.state}`]">
                  {{ stateLabel[skill.state] ?? skill.state }}
                </em>
              </span>
              <p v-if="skill.message" class="row-message">{{ skill.message }}</p>
            </div>

            <div v-if="mcpStatus" class="status-row">
              <span class="row-main">fastppt MCP</span>
              <span class="row-side">
                <em :class="['row-state', `state-${mcpStatus.state}`]">
                  {{ stateLabel[mcpStatus.state] ?? mcpStatus.state }}
                </em>
              </span>
              <p v-if="mcpStatus.message" class="row-message">
                {{ mcpStatus.message }}
              </p>
            </div>

            <div v-if="!skillStatuses.length && !mcpStatus" class="status-empty">
              暂无状态信息
            </div>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/* Inline signal light beside the "FastPPT" brand text. */
.managed-badge-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 5px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-panel-raised);
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  line-height: 1;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;
}

.managed-badge-button:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.badge-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 16%, transparent);
  transition: background 120ms ease, box-shadow 120ms ease;
}

.managed-badge-button.attention .badge-dot {
  background: #fcd34d;
  box-shadow: 0 0 0 2px rgb(252 211 77 / 18%);
}

.managed-badge-button.critical .badge-dot {
  background: #f87171;
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
  background: rgb(3 8 7 / 76%);
  backdrop-filter: blur(8px);
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
  box-shadow: 0 24px 80px rgb(0 0 0 / 45%);
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
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.close-button:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
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
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  font-family: var(--font-mono);
  font-size: 11px;
}

.modal-summary.attention {
  color: #fcd34d;
  background: color-mix(in srgb, #fcd34d 14%, transparent);
}

.modal-summary.critical {
  color: #f87171;
  background: color-mix(in srgb, #f87171 14%, transparent);
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
  font-size: 9px;
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
  font-size: 9px;
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
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
}

.row-state.state-update-available,
.row-state.state-pending-trust {
  color: #fcd34d;
  background: color-mix(in srgb, #fcd34d 14%, transparent);
}

.row-state.state-missing,
.row-state.state-conflict,
.row-state.state-disabled {
  color: #f87171;
  background: color-mix(in srgb, #f87171 14%, transparent);
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
    padding: 0;
    justify-content: center;
    border-color: transparent;
    background: transparent;
  }
  .badge-count {
    display: none;
  }
}
</style>
