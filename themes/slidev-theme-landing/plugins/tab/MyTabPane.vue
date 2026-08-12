<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted } from 'vue'
import type { ComputedRef } from 'vue'
import type { TabInfo } from './MyTab.vue'

const props = defineProps<{
    name: string
    tab: string
    click?: number
}>()

const context = inject<{
    activeName: ComputedRef<string>
    registerTab: (tab: TabInfo) => void
    unregisterTab: (name: string) => void
}>('SlidevTabsContext')

if (!context) throw new Error('[MyTabPane] Must be used inside <MyTab>')

onMounted(() => {
    context.registerTab({
        name: props.name,
        tab: props.tab,
        ...(props.click === undefined ? {} : { click: props.click })
    })
})

onUnmounted(() => {
    context.unregisterTab(props.name)
})

const isActive = computed(() => context.activeName.value === props.name)
</script>

<template>
  <div v-show="isActive" class="w-full h-full flex flex-col min-h-0 slidev-tab-pane" v-bind="$attrs">
    <slot />
  </div>
</template>

<style scoped>
.slidev-tab-pane :deep(img) {
    max-width: 100%;
    min-height: 0;
    object-fit: contain;
    align-self: center;

}
</style>
