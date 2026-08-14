<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSlideContext } from '@slidev/client'
import { Cite } from '@citation-js/core'
import '@citation-js/plugin-doi'
import '@citation-js/plugin-bibtex'
import '@citation-js/plugin-csl'
import { type SlideCitation, useCitationStore } from './store'

interface CiteDetail {
  doi: string
  text: string
  link: string
}

const { $page } = useSlideContext()
const store = useCitationStore()

const cites = computed(() => store.getSlideCitations($page.value))
const sorted_links = computed(() => [...cites.value].sort((a, b) => a.number - b.number))
const refs = ref<Record<number, CiteDetail>>({})

const TEMPLATES = ['mla', 'apa']

/**
 * 规范化文本，移除多余空格
 */
function str_trim(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 清洗并补全 DOI
 */
function doi_clean(doi: string): string {
  const raw = doi.trim()
  if (/^\d{4}\.\d{4,5}$/.test(raw)) {
    return `10.48550/arXiv.${raw}`
  }
  return raw
}

/**
 * 核心格式化逻辑：尝试不同模板解析 DOI
 */
async function doi_format(doi: string): Promise<string> {
  const target = doi_clean(doi)

  for (const tpl of TEMPLATES) {
    try {
      const cite = await Cite.async(target)
      const out = cite.format('bibliography', {
        format: 'text',
        template: tpl,
        lang: 'en-US',
      })

      const res = str_trim(out).replace(/^\[?\d+\]?\s*/, '')
      if (res) return res
    } catch {
      console.warn(`[Cite] Template ${tpl} failed for: ${target}`)
    }
  }
  return doi
}

/**
 * 解析引用项，生成元数据字典
 */
async function resolve_cite(item: SlideCitation): Promise<[number, CiteDetail]> {
  const cleaned = item.doi ? doi_clean(item.doi) : ''
  const formatted = item.doi ? await doi_format(item.doi) : (item.url || ' ')

  return [
    item.number,
    {
      doi: cleaned,
      text: formatted,
      link: item.doi ? `https://doi.org/${cleaned}` : (item.url || '#'),
    }
  ]
}

watch(
  cites,
  async (items, _, onCleanup) => {
    let cancelled = false
    onCleanup(() => (cancelled = true))

    if (!items.length) {
      refs.value = {}
      return
    }

    const entries = await Promise.all(items.map(resolve_cite))

    if (!cancelled) {
      refs.value = Object.fromEntries(entries)
    }
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <div v-if="sorted_links.length > 0" class="border-t border-gray-100 pt-1">
    <div
      v-for="c in sorted_links" :key="c.number"
      class="flex flex-items-start gap-0 text-[7px] leading-[1.2]  mb-0.5 hover:text-gray-700 transition-colors">
      <a :href="refs[c.number]?.link" target="_blank" class="flex flex-1 no-underline color-inherit decoration-none">
        <span class="font-mono inline-block w-[2.5em] shrink-0">[{{ c.number }}]</span>
        <span class="inline-block break-words flex-1">
          {{ refs[c.number]?.text || c.doi || c.url }}
          <span v-if="c.suffix" class="opacity-80">{{ c.suffix }}</span>
        </span>
      </a>
    </div>
  </div>
</template>
