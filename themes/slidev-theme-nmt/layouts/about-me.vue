<script setup lang="ts">
import {computed} from 'vue'
import {handleBackground} from '../utils/layoutHelper.ts'

const props = defineProps<{
  imageSrc?: string
  helloMsg?: string
  name?: string
  company?: string
  jobRole?: string
  position?: string
  subjects?: string
  skills?: string
  line1?: string
  line2?: string
  line3?: string
  email?: string
  msTeams?: string
  website?: string
  github?: string
  facebook?: string
  twitter?: string
  instagram?: string
}>()

const style = computed(() => handleBackground(props.imageSrc, false))
const flexRow = computed(() => props.position === 'left' ? 'flex-row-reverse' : 'flex-row')
const textItems = computed(() => props.position === 'left' ? 'items-start' : 'items-end')
const textAlign = computed(() => props.position === 'left' ? 'text-left' : 'text-right')
</script>

<template>
  <div class="slidev-layout about-me p-0">
    <div class="flex h-full" :class="flexRow">
      <div class="w-1/3 h-full flex flex-col justify-end bg-contain" :style="style">
      </div>

      <div class="w-2/3 flex flex-col justify-between px-8 pt-8" :class="textItems">
        <h1 v-if="helloMsg" class="flex">{{ helloMsg }}</h1>

        <div class="flex flex-col pb-16 ml-6" :class="[textItems, textAlign]">
          <h2 class="font-extrabold">{{ name }}</h2>

          <dl class="mt-2 flex flex-wrap gap-0 -ml-4">
            <dt v-if="company" class="w-1/10">
              <fa-solid-building class="text-zinc-500 block mx-auto"/>
            </dt>
            <dd v-if="company" class="w-9/10 company">{{ company }}</dd>

            <dt v-if="jobRole" class="w-1/10">
              <fa-solid-user-circle class="text-zinc-500 block mx-auto"/>
            </dt>
            <dd v-if="jobRole" class="w-9/10 line-1">{{ jobRole }}</dd>

            <dt v-if="subjects" class="w-1/10">
              <fa-solid-book class="text-zinc-500 block mx-auto"/>
            </dt>
            <dd v-if="subjects" class="w-9/10 line-2">{{ subjects }}</dd>

            <dt v-if="skills" class="w-1/10">
              <fa-solid-check class="text-zinc-500 block mx-auto"/>
            </dt>
            <dd v-if="skills" class="w-9/10 line-3">{{ skills }}</dd>

            <dt v-if="website" class="w-1/10">
              <fa-solid-sitemap class="text-zinc-500 block mx-auto"/>
            </dt>
            <dd v-if="website" class="w-9/10 line-3">{{ website }}</dd>

            <dt v-if="email" class="w-1/10">
              <fa-solid-envelope class="text-zinc-500 block mx-auto"/>
            </dt>
            <dd v-if="email" class="w-9/10 line-3">{{ email }}</dd>

            <dt v-if="msTeams" class="w-1/10">
              <fa-brands-microsoft class="text-zinc-500 block mx-auto"/>
            </dt>
            <dd v-if="msTeams" class="w-9/10 line-3">{{ msTeams }}</dd>

            <dt v-if="facebook" class="w-1/10">
              <fa-brands-facebook class="text-zinc-500 block mx-auto"/>
            </dt>
            <dd v-if="facebook" class="w-9/10 line-3">{{ facebook }}</dd>

            <dt v-if="twitter" class="w-1/10">
              <fa-brands-twitter class="text-zinc-500 block mx-auto"/>
            </dt>
            <dd v-if="twitter" class="w-9/10 line-3">{{ twitter }}</dd>

            <dt v-if="instagram" class="w-1/10">
              <fa-brands-instagram class="text-zinc-500 block mx-auto"/>
            </dt>
            <dd v-if="instagram" class="w-9/10 line-3">{{ instagram }}</dd>
          </dl>

          <div class="mt-4 flex flex-wrap gap-0 border-t p-2 w-full class=text-xs w-full">
            <p v-if="line1" class="text-xs w-full">{{ line1 }}</p>
            <p v-if="line2" class="text-xs w-full">{{ line2 }}</p>
            <p v-if="line3" class="text-xs w-full">{{ line3 }}</p>
          </div>

        </div>
      </div>
    </div>

    <slot/>
  </div>
</template>
