<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import type { EditorView } from '@codemirror/view'

const props = defineProps<{
  path: string
  content: string
  saving: boolean
  dirty: boolean
  error: string | undefined
  externalChange: boolean
}>()

const emit = defineEmits<{
  'update:content': [content: string]
  save: []
  format: []
}>()

const editorElement = useTemplateRef<HTMLDivElement>('editorElement')
let editorView: EditorView | undefined

onMounted(async () => {
  if (!editorElement.value) return
  const [
    { basicSetup },
    { markdown },
    { EditorState },
    { oneDark },
    { EditorView, keymap },
  ] = await Promise.all([
    import('codemirror'),
    import('@codemirror/lang-markdown'),
    import('@codemirror/state'),
    import('@codemirror/theme-one-dark'),
    import('@codemirror/view'),
  ])
  if (!editorElement.value) return // 等待期间组件已卸载(如切换文件),不再创建编辑器
  editorView = new EditorView({
    parent: editorElement.value,
    state: EditorState.create({
      doc: props.content,
      extensions: [
        basicSetup,
        markdown(),
        oneDark,
        EditorView.lineWrapping,
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              emit('save')
              return true
            },
          },
          {
            key: 'Shift-Alt-f',
            preventDefault: true,
            run: () => {
              emit('format')
              return true
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged)
            emit('update:content', update.state.doc.toString())
        }),
      ],
    }),
  })
})

watch(
  () => props.content,
  (content) => {
    if (!editorView || editorView.state.doc.toString() === content) return
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: content },
    })
  },
)

onBeforeUnmount(() => editorView?.destroy())
</script>

<template>
  <section class="markdown-editor">
    <header class="editor-toolbar">
      <div class="file-identity">
        <span class="file-path">{{ path }}</span>
        <span v-if="dirty" class="dirty-mark">未保存</span>
      </div>
      <div class="editor-actions">
        <button
          type="button"
          :disabled="dirty || saving"
          @click="$emit('format')"
        >
          格式化
        </button>
        <button
          type="button"
          :disabled="!dirty || saving"
          @click="$emit('save')"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </header>
    <div
      v-if="error"
      class="editor-error"
      :class="{ conflict: externalChange }"
    >
      {{ error }}
    </div>
    <div ref="editorElement" class="editor-mount"></div>
  </section>
</template>

<style scoped>
.markdown-editor {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: 0;
}

.editor-toolbar,
.file-identity,
.editor-actions {
  display: flex;
  align-items: center;
}

.editor-actions {
  gap: 6px;
}

.editor-toolbar {
  justify-content: space-between;
  padding: 9px 14px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel-raised);
}

.file-identity {
  min-width: 0;
  gap: 9px;
}

.file-path {
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dirty-mark {
  color: #fcd34d;
  font-size: 10px;
}

.editor-toolbar button {
  padding: 6px 11px;
  border: 1px solid var(--color-border-strong);
  border-radius: 6px;
  background: var(--color-accent);
  color: #071612;
  font-size: 11px;
  font-weight: 700;
}

.editor-toolbar button:disabled {
  background: var(--color-disabled);
  color: var(--color-muted);
}

.editor-error {
  padding: 8px 14px;
  background: rgb(255 130 119 / 10%);
  color: var(--color-danger);
  font-size: 11px;
}

.editor-error.conflict {
  background: rgb(252 211 77 / 10%);
  color: #fcd34d;
}

.editor-mount {
  min-height: 0;
  overflow: hidden;
}

.editor-mount :deep(.cm-editor) {
  height: 100%;
  background: #0d1210;
  font-family: var(--font-mono);
  font-size: 12px;
}

.editor-mount :deep(.cm-scroller) {
  overflow: auto;
}
</style>
