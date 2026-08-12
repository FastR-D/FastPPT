<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ content: string }>()

type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'strong'; value: string }

type MessageBlock =
  | { kind: 'paragraph'; lines: InlineToken[][] }
  | { kind: 'heading'; level: number; content: InlineToken[] }
  | { kind: 'quote'; content: InlineToken[] }
  | { kind: 'list'; ordered: boolean; items: InlineToken[][] }
  | { kind: 'code'; language: string; content: string }

function inlineTokens(value: string): InlineToken[] {
  const tokens: InlineToken[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let offset = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > offset)
      tokens.push({ kind: 'text', value: value.slice(offset, index) })
    const token = match[0]
    tokens.push(
      token.startsWith('`')
        ? { kind: 'code', value: token.slice(1, -1) }
        : { kind: 'strong', value: token.slice(2, -2) },
    )
    offset = index + token.length
  }
  if (offset < value.length)
    tokens.push({ kind: 'text', value: value.slice(offset) })
  return tokens
}

function parseMessage(content: string): MessageBlock[] {
  const lines = content.replaceAll('\r\n', '\n').split('\n')
  const blocks: MessageBlock[] = []
  let paragraph: string[] = []
  let list: Extract<MessageBlock, { kind: 'list' }> | undefined

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push({
      kind: 'paragraph',
      lines: paragraph.map((line) => inlineTokens(line)),
    })
    paragraph = []
  }
  const flushList = () => {
    if (list) blocks.push(list)
    list = undefined
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const fence = /^```\s*([\w-]*)/.exec(line)
    if (fence) {
      flushParagraph()
      flushList()
      const code: string[] = []
      while (++index < lines.length && !/^```\s*$/.test(lines[index]!))
        code.push(lines[index]!)
      blocks.push({
        kind: 'code',
        language: fence[1] ?? '',
        content: code.join('\n'),
      })
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length,
        content: inlineTokens(heading[2]!),
      })
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push({ kind: 'quote', content: inlineTokens(quote[1]!) })
      continue
    }
    const item = /^\s*(?:(\d+)[.)]|[-*])\s+(.+)$/.exec(line)
    if (item) {
      flushParagraph()
      const ordered = item[1] !== undefined
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { kind: 'list', ordered, items: [] }
      }
      list.items.push(inlineTokens(item[2]!))
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }
    flushList()
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  return blocks
}

const blocks = computed(() => parseMessage(props.content))
</script>

<template>
  <div class="message-markdown">
    <template v-for="(block, blockIndex) in blocks" :key="blockIndex">
      <component :is="`h${block.level}`" v-if="block.kind === 'heading'">
        <template
          v-for="(token, tokenIndex) in block.content"
          :key="tokenIndex"
        >
          <code v-if="token.kind === 'code'">{{ token.value }}</code>
          <strong v-else-if="token.kind === 'strong'">{{ token.value }}</strong>
          <template v-else>{{ token.value }}</template>
        </template>
      </component>
      <blockquote v-else-if="block.kind === 'quote'">
        <template
          v-for="(token, tokenIndex) in block.content"
          :key="tokenIndex"
        >
          <code v-if="token.kind === 'code'">{{ token.value }}</code>
          <strong v-else-if="token.kind === 'strong'">{{ token.value }}</strong>
          <template v-else>{{ token.value }}</template>
        </template>
      </blockquote>
      <component
        :is="block.ordered ? 'ol' : 'ul'"
        v-else-if="block.kind === 'list'"
      >
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <template v-for="(token, tokenIndex) in item" :key="tokenIndex">
            <code v-if="token.kind === 'code'">{{ token.value }}</code>
            <strong v-else-if="token.kind === 'strong'">{{
              token.value
            }}</strong>
            <template v-else>{{ token.value }}</template>
          </template>
        </li>
      </component>
      <pre
        v-else-if="block.kind === 'code'"
      ><span v-if="block.language" class="code-language">{{ block.language }}</span><code>{{ block.content }}</code></pre>
      <p v-else>
        <template v-for="(line, lineIndex) in block.lines" :key="lineIndex">
          <br v-if="lineIndex" />
          <template v-for="(token, tokenIndex) in line" :key="tokenIndex">
            <code v-if="token.kind === 'code'">{{ token.value }}</code>
            <strong v-else-if="token.kind === 'strong'">{{
              token.value
            }}</strong>
            <template v-else>{{ token.value }}</template>
          </template>
        </template>
      </p>
    </template>
  </div>
</template>

<style scoped>
.message-markdown {
  display: grid;
  gap: 9px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.message-markdown :is(h1, h2, h3, p, ul, ol, blockquote, pre) {
  margin: 0;
}
.message-markdown h1 {
  font-size: 1.25em;
}
.message-markdown h2 {
  font-size: 1.14em;
}
.message-markdown h3 {
  font-size: 1.05em;
}
.message-markdown :is(ul, ol) {
  display: grid;
  gap: 4px;
  padding-left: 1.45em;
}
.message-markdown blockquote {
  padding: 4px 0 4px 12px;
  border-left: 3px solid var(--color-accent);
  color: var(--color-muted);
}
.message-markdown :not(pre) > code {
  padding: 0.12em 0.38em;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-canvas);
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: 0.9em;
}
.message-markdown pre {
  position: relative;
  overflow: auto;
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  background: var(--color-canvas);
}
.message-markdown pre code {
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: pre;
}
.code-language {
  display: block;
  margin-bottom: 7px;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
}
</style>
