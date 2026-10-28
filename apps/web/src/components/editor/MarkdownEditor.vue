<script setup lang="ts">
import {
  useColorMode,
  Box,
  Button,
  Header,
  Panel,
  Text,
} from '@fastppt/components'
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
const { isDark } = useColorMode()
let editorView: EditorView | undefined
let updateTheme: (() => void) | undefined

onMounted(async () => {
  if (!editorElement.value) return
  const [
    { basicSetup },
    { markdown },
    { EditorState, Compartment },
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
  const theme = new Compartment()
  updateTheme = () =>
    editorView?.dispatch({
      effects: theme.reconfigure(isDark.value ? oneDark : []),
    })
  editorView = new EditorView({
    parent: editorElement.value,
    state: EditorState.create({
      doc: props.content,
      extensions: [
        basicSetup,
        markdown(),
        theme.of(isDark.value ? oneDark : []),
        EditorView.theme({
          '&': {
            color: 'var(--color-text)',
            backgroundColor: 'var(--color-panel)',
          },
          '.cm-content': {
            caretColor: 'var(--color-accent-strong)',
            padding: '12px 0',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--color-panel-raised)',
            color: 'var(--color-muted)',
            borderRight: '1px solid var(--color-border)',
          },
          '.cm-activeLine, .cm-activeLineGutter': {
            backgroundColor: 'var(--color-selected)',
          },
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection':
            { backgroundColor: 'var(--color-selected)' },
          '&.cm-focused': { outline: 'none' },
        }),
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

watch(isDark, () => updateTheme?.())
onBeforeUnmount(() => editorView?.destroy())
</script>

<template>
  <Panel class="markdown-editor">
    <Header class="editor-toolbar">
      <Box class="file-identity">
        <Text class="file-path">{{ path }}</Text>
        <Text v-if="dirty" class="dirty-mark">未保存</Text>
      </Box>
      <Box class="editor-actions">
        <Button
          variant="secondary"
          type="button"
          :disabled="dirty || saving"
          @click="$emit('format')"
        >
          格式化
        </Button>
        <Button
          variant="primary"
          type="button"
          :disabled="!dirty || saving"
          @click="$emit('save')"
        >
          {{ saving ? '保存中…' : '保存' }}
        </Button>
      </Box>
    </Header>
    <Box
      v-if="error"
      class="editor-error"
      :class="{ conflict: externalChange }"
    >
      {{ error }}
    </Box>
    <Box ref="editorElement" class="editor-mount"></Box>
  </Panel>
</template>

<style scoped>
.markdown-editor {
  display: flex;
  flex-direction: column;
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
  color: var(--color-warning);
  font-size: 10px;
}

.editor-error {
  padding: 8px 14px;
  background: rgb(255 130 119 / 10%);
  color: var(--color-danger);
  font-size: 11px;
}

.editor-error.conflict {
  background: rgb(252 211 77 / 10%);
  color: var(--color-warning);
}

.editor-mount {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.editor-mount :deep(.cm-editor) {
  height: 100%;
  background: var(--color-panel);
  font-family: var(--font-mono);
  font-size: 12px;
}

.editor-mount :deep(.cm-scroller) {
  overflow: auto;
}
</style>
