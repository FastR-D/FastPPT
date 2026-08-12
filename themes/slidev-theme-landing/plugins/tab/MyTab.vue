<script setup lang="ts">
import { ref, provide, computed } from 'vue'
import { useSlideContext } from '@slidev/client'

const props = withDefaults(defineProps<{
    type?: 'line' | 'card'
    size?: 'small' | 'medium' | 'large'
}>(), {
    type: 'line',
    size: 'medium'
})

export interface TabInfo {
    name: string
    tab: string
    click?: number
}

const { $slidev } = useSlideContext()
const tabs = ref<TabInfo[]>([])

const activeName = computed(() => {
    const currentClick = $slidev?.nav?.clicks || 0
    const currentTab = tabs.value.find(t => t.click === currentClick)
    return currentTab ? currentTab.name : (tabs.value[0]?.name || '')
})

const registerTab = (tab: TabInfo) => {
    if (!tabs.value.find(t => t.name === tab.name)) {
        tabs.value.push(tab)
    }
}

const unregisterTab = (name: string) => {
    tabs.value = tabs.value.filter(t => t.name !== name)
}

provide('SlidevTabsContext', {
    activeName,
    registerTab,
    unregisterTab
})

const handleTabClick = (tab: TabInfo) => {
    if (tab.click !== undefined && tab.click !== $slidev.nav.clicks) {

            $slidev.nav.go($slidev.nav.currentPage, tab.click)
            return
    }
}

const sizeClass = computed(() => {
    switch (props.size) {
        case 'small': return 'text-sm py-1 px-3'
        case 'large': return 'text-lg py-3 px-5'
        default: return 'text-base py-2 px-4'
    }
})
</script>

<template>
  <div class="w-full h-full flex flex-col min-h-0">
    <div class="flex border-b border-gray-200 dark:border-gray-700 mb-4 relative shrink-0">
      <div
        v-for="tab in tabs" :key="tab.name" class="cursor-pointer transition-colors duration-200 relative -mb-[1px] whitespace-nowrap"
        :class="[
          sizeClass,
          activeName === tab.name
            ? 'text-[var(--slidev-theme-primary)] font-medium border-b-2 border-[var(--slidev-theme-primary)]'
            : 'text-gray-500 dark:text-gray-400 border-b-2 border-transparent hover:text-gray-700'
        ]" @click="handleTabClick(tab)">
        {{ tab.tab }}
      </div>
    </div>

    <div class="relative flex-1 min-h-0">
      <slot />
    </div>
  </div>
</template>