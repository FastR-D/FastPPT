<script setup lang="ts">
import { computed, onUnmounted, shallowRef } from 'vue'

import { useGatewayClient } from '../../api/useGatewayClient.js'

import type { ThemeSkillDocument, ThemeSummary } from '@fastppt/protocol'
import type { DeepReadonly } from 'vue'

const props = defineProps<{
  themes: readonly DeepReadonly<ThemeSummary>[]
  loading: boolean
  error: string | undefined
}>()

const client = useGatewayClient()
const detailTheme = shallowRef<DeepReadonly<ThemeSummary>>()
const skillTheme = shallowRef<DeepReadonly<ThemeSummary>>()
const skillDocument = shallowRef<ThemeSkillDocument>()
const skillLoading = shallowRef(false)
const skillError = shallowRef<string>()

const sortedThemes = computed(() =>
  [...props.themes].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  ),
)

function closeModal(): void {
  detailTheme.value = undefined
  skillTheme.value = undefined
  skillDocument.value = undefined
  skillError.value = undefined
}

function openDetails(theme: DeepReadonly<ThemeSummary>): void {
  skillTheme.value = undefined
  detailTheme.value = theme
}

async function openSkill(theme: DeepReadonly<ThemeSummary>): Promise<void> {
  detailTheme.value = undefined
  skillTheme.value = theme
  skillDocument.value = undefined
  skillError.value = undefined
  skillLoading.value = true
  try {
    skillDocument.value = await client.getThemeSkill(theme.themeId)
  } catch (cause) {
    skillError.value =
      cause instanceof Error ? cause.message : '无法读取主题 Skill 文件'
  } finally {
    skillLoading.value = false
  }
}

function handleWindowKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeModal()
}

window.addEventListener('keydown', handleWindowKey)
onUnmounted(() => window.removeEventListener('keydown', handleWindowKey))
</script>

<template>
  <section class="theme-catalog" aria-labelledby="theme-catalog-title">
    <header class="catalog-header">
      <div>
        <span class="eyebrow">Local theme registry</span>
        <h1 id="theme-catalog-title">可用主题</h1>
        <p>查看本地已注册主题、功能清单及 Agent Skill 原文。</p>
      </div>
      <span class="theme-count">{{ sortedThemes.length }} 个主题</span>
    </header>

    <div v-if="loading && !sortedThemes.length" class="catalog-state">
      正在读取主题注册表…
    </div>
    <div v-else-if="error && !sortedThemes.length" class="catalog-state error">
      {{ error }}
    </div>
    <div v-else class="table-shell">
      <table>
        <thead>
          <tr>
            <th>主题</th>
            <th>简要描述</th>
            <th>Skill</th>
            <th>版本</th>
            <th class="repo-heading">原始 Repo</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="theme in sortedThemes" :key="theme.themeId">
            <td>
              <strong>{{ theme.displayName }}</strong>
              <code>{{ theme.packageName }}</code>
            </td>
            <td class="description-cell">
              <span>{{ theme.description }}</span>
              <button
                class="expand-button"
                type="button"
                :aria-label="`查看 ${theme.displayName} 详细功能`"
                @click="openDetails(theme)"
              >
                展开
              </button>
            </td>
            <td>
              <div class="skill-cell">
                <code>{{ theme.skillId }}</code>
                <button
                  class="expand-button"
                  type="button"
                  :aria-label="`查看 ${theme.skillId} 文件`"
                  @click="openSkill(theme)"
                >
                  展开
                </button>
              </div>
            </td>
            <td><code>{{ theme.version }}</code></td>
            <td class="repo-cell">
              <a
                class="repo-link"
                :href="theme.repositoryUrl"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="`打开 ${theme.displayName} 原始仓库`"
                :title="theme.repositoryUrl"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.82a9.5 9.5 0 0 1 2.5.34c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86V21c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
                  />
                </svg>
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div
        v-if="detailTheme || skillTheme"
        class="modal-backdrop"
        role="presentation"
        @mousedown.self="closeModal"
      >
        <section
          class="theme-modal"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="detailTheme ? 'theme-detail-title' : 'skill-title'"
        >
          <header class="modal-header">
            <div v-if="detailTheme">
              <span class="eyebrow">Theme capabilities</span>
              <h2 id="theme-detail-title">{{ detailTheme.displayName }}</h2>
              <p>{{ detailTheme.description }}</p>
            </div>
            <div v-else-if="skillTheme">
              <span class="eyebrow">Agent skill source</span>
              <h2 id="skill-title">{{ skillTheme.skillId }}</h2>
              <p>{{ skillTheme.skillVersion }} · SKILL.md</p>
            </div>
            <button
              class="close-button"
              type="button"
              aria-label="关闭弹窗"
              @click="closeModal"
            >
              ×
            </button>
          </header>

          <div v-if="detailTheme" class="modal-content feature-list">
            <article
              v-for="feature in detailTheme.supportedFeatures"
              :key="feature.id"
            >
              <strong>{{ feature.label }}</strong>
              <code>{{ feature.id }}</code>
              <p>{{ feature.description }}</p>
            </article>
            <section class="layout-list">
              <strong>可用布局</strong>
              <div>
                <span v-for="layout in detailTheme.layouts" :key="layout.id">
                  {{ layout.label }}
                </span>
              </div>
            </section>
          </div>
          <div v-else class="modal-content skill-source">
            <p v-if="skillLoading" class="catalog-state">正在读取 SKILL.md…</p>
            <p v-else-if="skillError" class="catalog-state error">
              {{ skillError }}
            </p>
            <pre v-else><code>{{ skillDocument?.content }}</code></pre>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.theme-catalog {
  min-width: 0;
  min-height: 0;
  padding: 28px;
  overflow: auto;
  background: var(--color-canvas);
}
.catalog-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}
.eyebrow {
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
h1,
h2,
p {
  margin: 0;
}
h1 {
  margin-top: 5px;
  font-size: 26px;
}
.catalog-header p,
.modal-header p {
  margin-top: 6px;
  color: var(--color-muted);
  font-size: 12px;
}
.theme-count {
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}
.table-shell {
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-panel);
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
th,
td {
  padding: 15px 16px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}
th {
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
tbody tr:last-child td {
  border-bottom: 0;
}
tbody tr:hover {
  background: color-mix(in srgb, var(--color-accent) 4%, transparent);
}
td strong,
td code {
  display: block;
}
td strong {
  margin-bottom: 5px;
}
code {
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}
.description-cell {
  min-width: 270px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.6;
}
.description-cell span {
  display: block;
}
.expand-button {
  margin-top: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-accent);
  font-size: 11px;
}
.skill-cell {
  min-width: 180px;
}
.repo-heading,
.repo-cell {
  width: 74px;
  text-align: center;
}
.repo-link {
  display: inline-grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  color: var(--color-text);
}
.repo-link:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.repo-link svg {
  width: 17px;
  height: 17px;
}
.catalog-state {
  padding: 32px;
  color: var(--color-muted);
  text-align: center;
}
.catalog-state.error {
  color: var(--color-danger);
}
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
.theme-modal {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(820px, 100%);
  max-height: min(760px, calc(100dvh - 48px));
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
  padding: 20px 22px;
  border-bottom: 1px solid var(--color-border);
}
.modal-header h2 {
  margin-top: 4px;
  font-size: 20px;
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
}
.modal-content {
  min-height: 0;
  padding: 20px 22px;
  overflow: auto;
}
.feature-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.feature-list article,
.layout-list {
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-panel);
}
.feature-list article strong,
.feature-list article code {
  display: block;
}
.feature-list article code {
  margin-top: 3px;
}
.feature-list article p {
  margin-top: 9px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.6;
}
.layout-list {
  grid-column: 1 / -1;
}
.layout-list > div {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 10px;
}
.layout-list span {
  padding: 5px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  color: var(--color-accent);
  font-size: 10px;
}
.skill-source pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.skill-source code {
  color: var(--color-text);
  font-size: 11px;
  line-height: 1.65;
}
@media (max-width: 720px) {
  .theme-catalog {
    padding: 18px;
  }
  .catalog-header {
    align-items: start;
    flex-direction: column;
  }
  .feature-list {
    grid-template-columns: minmax(0, 1fr);
  }
  .layout-list {
    grid-column: 1;
  }
}
</style>
