<script setup lang="ts">
defineProps<{ heading?: string }>()
</script>

<template>
  <div class="slidev-layout frame profile">
    <div v-if="heading" class="frame-header">{{ heading }}</div>
    <div class="frame-content">
      <div class="profile-inner">
        <div class="profile-main">
          <div class="profile-name"><slot name="name" /></div>
          <div class="profile-body"><slot /></div>
        </div>
        <div v-if="$slots.aside" class="profile-aside soft-panel">
          <slot name="aside" />
        </div>
      </div>
    </div>
  </div>
</template>
