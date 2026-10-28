<script setup lang="ts">
import Layout from './default.vue'
</script>
<template>
  <Layout
    ><slot /><template #left><slot name="left" /></template
    ><template #right><slot name="right" /></template
  ></Layout>
</template>
