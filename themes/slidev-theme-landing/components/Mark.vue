<script setup>
// 接收一个 prop 来决定使用哪个主题色
defineProps({
    colorName: {
        type: String,
        default: 'primary'
    }
});
</script>

<template>
  <span
    class="font-bold bg-gradient-to-b from-transparent from-35% via-whu-pink via-35% via-whu-pink via-80% to-transparent to-80%">
    <slot />
  </span>
</template>

<style scoped>
/* 注意：UnoCSS 的变量名格式通常为 --un-preset-theme-xxx 或 --un-palette-xxx */
/* 如果不确定，可以在浏览器 F12 查看 html 标签上的变量名 */
</style>