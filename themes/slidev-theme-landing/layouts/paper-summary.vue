<script setup lang="ts">
import { computed } from 'vue'
import BaseLayout from './base.vue'
import ColBlock from '../components/ColBlock.vue';
import MyCite from '../plugins/references/MyCite.vue';

const props = defineProps({
    chapter: { type: String, default: '' },
    section: { type: String, default: '' },
    paperABBR: { type: String, default: '' },
    paperDOI: { type: String, default: '' },
})

const splitItems = (text: string) => text.split('/').map((item) => item.trim()).filter((item) => item.length > 0)

const groupedLabels = computed(() => splitItems(props.paperABBR))
const groupedDois = computed(() => splitItems(props.paperDOI))
const groupedCitations = computed(() => {
    if (groupedLabels.value.length > 1 && groupedLabels.value.length === groupedDois.value.length) {
        return groupedLabels.value.flatMap((label, index) => {
            const doi = groupedDois.value[index]
            return doi ? [{ label, doi }] : []
        })
    }
    return []
})


</script>
<template>
  <BaseLayout :chapter="chapter" :section="section">
    <template #header>
      <div class="flex items-stretch h-full w-full border-primary">
        <div
          class="bg-primary text-white flex items-center justify-center px-8 font-bold text-xl min-w-[150px]">
          {{ chapter }}
        </div>
        <div class="flex-grow flex items-center px-6 text-black font-bold text-xl">
          {{ section }}
        </div>
      </div>
    </template>
    <template #main>
      <div class="p-4 w-full h-full flex flex-col min-h-0">
        <div v-if="$slots.up" class="w-full shrink-0">
          <slot name="up" />
        </div>

        <div class="flex-1 min-h-0 grid grid-cols-12 gap-6 items-stretch">
          <div class="col-span-4 h-full flex flex-col min-h-0">
            <ColBlock class="h-full">
              <template #title>
                <template v-if="groupedCitations.length">
                  <span class="inline-flex items-baseline gap-1">
                    <template v-for="(item, index) in groupedCitations" :key="item.doi">
                      <MyCite :doi="item.doi">{{ item.label }}</MyCite>
                      <span v-if="index < groupedCitations.length - 1">/</span>
                    </template>
                  </span>
                </template>
                <template v-else>
                  <MyCite :doi="props.paperDOI">{{ paperABBR }}</MyCite>
                </template>
              </template>
              <div class="h-full">
                <slot name="summary" />
              </div>
            </ColBlock>
          </div>

          <div class="col-span-8 h-full flex flex-col overflow-hidden min-h-0">
            <slot name="details" />
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div v-if="$slots.bottom" class="w-full shrink-0 px-2">
        <slot name="bottom" />
      </div>
      <div class="flex flex-col w-full">
        <div class="px-2 py-1">
          <References />
        </div>
      </div>
    </template>
  </BaseLayout>
</template>
