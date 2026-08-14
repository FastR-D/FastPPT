import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export interface SlideCitation {
  doi?: string
  url?: string
  suffix?: string
  displayName: string
  number: number
}

function normalizeDoi(doi: string | undefined): string {
  return doi?.trim().toLowerCase() || ''
}

export const useCitationStore = defineStore('slidev-citations', () => {
  const citationsBySlide = ref<Record<number, SlideCitation[]>>({})

  function getSlideCitations(slide: number): SlideCitation[] {
    return citationsBySlide.value[slide] ?? []
  }

  function getCitationNumber(slide: number, doi: string): number | null {
    const normalized = normalizeDoi(doi)
    const found = getSlideCitations(slide).find((item) => normalizeDoi(item.doi) === normalized)
    return found ? found.number : null
  }

  function addCitation(slide: number, doi: string, displayName: string): number {
    if (!doi || !doi?.trim()) {
      return 0
    }

    if (!citationsBySlide.value[slide]) {
      citationsBySlide.value[slide] = []
    }

    const normalized = normalizeDoi(doi)
    const existed = citationsBySlide.value[slide].find((item) => normalizeDoi(item.doi) === normalized)

    if (existed) {
      return existed.number
    }

    const number = citationsBySlide.value[slide].length + 1
    citationsBySlide.value[slide].push({
      doi,
      displayName,
      number,
    })

    return number
  }

  function clearSlide(slide: number): void {
    delete citationsBySlide.value[slide]
  }

  function clearAll(): void {
    citationsBySlide.value = {}
  }

  const allCitations = computed(() => citationsBySlide.value)

  return {
    citationsBySlide,
    allCitations,
    getSlideCitations,
    getCitationNumber,
    addCitation,
    clearSlide,
    clearAll,
  }
})
