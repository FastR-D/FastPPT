import { defineStore } from "pinia";
import { ref } from "vue";

export const useScrollStore = defineStore("scroll", () => {
  const isLocked = ref(false);
  const cooldown = 600; // 全局冷却时间

  function lock() {
    if (isLocked.value) return true; // 已经被锁定了

    isLocked.value = true;
    setTimeout(() => {
      isLocked.value = false;
    }, cooldown);

    return false; // 刚刚执行锁定
  }

  return { isLocked, lock };
});
