import { initColorMode } from '@fastrd/ui-foundation'
import { computed, shallowRef } from 'vue'

const controller = initColorMode({ storageKey: 'fastppt.color-mode' })
const resolved = shallowRef(controller.resolved)
const unsubscribe = controller.subscribe(state => { resolved.value = state.resolved })
export const isDark = computed(() => resolved.value === 'dark')
export const toggleColorMode = () => controller.setMode(isDark.value ? 'light' : 'dark')
if (import.meta.hot) import.meta.hot.dispose(() => { unsubscribe(); controller.dispose() })
