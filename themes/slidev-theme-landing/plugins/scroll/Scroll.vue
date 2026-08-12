<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useNav } from '@slidev/client'
import { useScrollStore } from './store' // 确保路径正确

const navigation = useNav()
const scrollStore = useScrollStore()

const THRESHOLD = 30; // 忽略极其微小的抖动

function onWheel(event: WheelEvent) {
    if (navigation.isPrintMode.value) return;

    // 1. 检查全局锁
    // 如果 lock() 返回 true，说明此时全局正处于冷却期
    if (scrollStore.lock()) {
        return;
    }

    // 2. 局部滚动判断 (保持原有的逻辑，防止干扰页面内的滚动条)
    let element = event.target as HTMLElement;
    let hasScrollableParent = false;
    while (element && element !== document.body) {
        const style = window.getComputedStyle(element);
        if (element.scrollHeight > element.clientHeight &&
            (style.overflowY === 'auto' || style.overflowY === 'scroll')) {
            const isAtBottom = element.scrollHeight - element.scrollTop <= element.clientHeight + 1;
            const isAtTop = element.scrollTop <= 0;
            if (event.deltaY > 0 && !isAtBottom) { hasScrollableParent = true; break; }
            if (event.deltaY < 0 && !isAtTop) { hasScrollableParent = true; break; }
        }
        element = element.parentElement as HTMLElement;
    }

    if (hasScrollableParent) return;

    // 3. 翻页逻辑
    if (Math.abs(event.deltaY) > THRESHOLD) {
        if (event.deltaY > 0) {
            navigation.next();
        } else {
            navigation.prev();
        }
    }
}

onMounted(() => {
    // 建议在全局只绑定一次，或者确保解绑逻辑正确
    window.addEventListener("wheel", onWheel, { passive: true });
});

onUnmounted(() => {
    window.removeEventListener("wheel", onWheel);
});
</script>
<template>
  <span hidden aria-hidden="true" />
</template>
