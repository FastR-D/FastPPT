<script setup lang="ts">
import { computed, useId } from 'vue'
import { shortLogoMarkPath, shortLogoMarkRectX, shortLogoMarkRadius, shortLogoMarkSize, shortLogoMarkTransform } from '../composables/logo-mark.mjs'

const props = defineProps({
  size: {
    type: String as () => 'short' | 'full',
    default: 'short',
  },
  title: {
    type: String,
    default: 'Theme logo',
  },
  background: {
    type: String,
    default: 'var(--theme-color-dark-0)',
  },
  foreground: {
    type: String,
    default: 'var(--theme-color-light-0)',
  },
  contrast: {
    type: String,
    default: 'var(--theme-color-light-0)',
  },
  favicon: {
    type: Boolean,
    default: false,
  },
})

const clipId = useId()
const isFull = computed(() => props.size === 'full')
const isFavicon = computed(() => !isFull.value && props.favicon)
const shortLogoStyle = computed(() => ({
  '--theme-logo-short-background': props.background,
  '--theme-logo-short-foreground': props.foreground,
}))
</script>

<template>
  <svg v-if="isFull"
       width="330"
       height="48"
       viewBox="0 0 330 48"
       fill="none"
       xmlns="http://www.w3.org/2000/svg"
       class="Logo"
       :style="{
         '--theme-logo-full-foreground': props.foreground,
         '--theme-logo-full-contrast': props.contrast,
       }"
       role="img"
       :aria-label="props.title">
    <title>{{ props.title }}</title>
    <g :clip-path="`url(#${clipId})`">
      <circle cx="23.0016" cy="23.0016" r="23.0016" fill="#FC3F1D" />
      <path d="M26.242 36.8255H31.0475V9.22363H24.0577C17.0281 9.22363 13.3347 12.8377 13.3347 18.1595C13.3347 22.409 15.3601 24.911 18.9742 27.4925L12.6992 36.8255H17.9019L24.8917 26.3805L22.4691 24.7522C19.5302 22.7664 18.1005 21.2176 18.1005 17.8815C18.1005 14.9426 20.1656 12.9568 24.0974 12.9568H26.242V36.8255Z"
            fill="white" />
    </g>
    <rect x="49.0703"
          width="46.0032"
          height="46.0032"
          rx="17.2512"
          fill="var(--theme-logo-full-foreground)" />
    <path fill-rule="evenodd"
          clip-rule="evenodd"
          d="M72.9351 5.63477L72.9351 21.3443L85.7096 12.3995L86.6991 13.8127L73.7934 22.8493L88.0794 29.511L87.3504 31.0745L72.9359 24.3529V40.2527H71.2108V32.8571L69.9266 40.1402L68.2276 39.8406L70.0528 29.4897L65.6461 38.94L64.0826 38.2109L69.7354 26.0885L59.4119 34.7509L58.303 33.4293L69.4227 24.0989L54.9628 25.3639L54.8125 23.6454L69.9235 22.3234L58.3037 12.5732L59.4126 11.2517L71.21 21.151L71.21 5.63477H72.9351Z"
          fill="var(--theme-logo-full-contrast)" />
    <path fill-rule="evenodd"
          clip-rule="evenodd"
          d="M130.356 40.2752V5.63867H107.531V40.2752H113.561V10.3233H124.326V40.2752H130.356ZM141.102 18.4468C141.866 17.2175 142.813 16.2872 143.943 15.6559C145.105 15.0247 146.385 14.709 147.78 14.709C149.175 14.709 150.455 14.9914 151.617 15.5562C152.78 16.1211 153.777 16.9683 154.608 18.0979C155.438 19.1943 156.086 20.5565 156.551 22.1845C157.016 23.7793 157.249 25.6233 157.249 27.7164C157.249 29.8096 157 31.6701 156.501 33.2981C156.036 34.9261 155.372 36.3049 154.508 37.4346C153.677 38.531 152.647 39.3616 151.418 39.9264C150.222 40.4912 148.91 40.7736 147.481 40.7736C144.856 40.7736 142.78 39.6274 141.251 37.3349V47.5016H135.321V15.2074H140.803L141.102 18.4468ZM145.986 36.089C147.714 36.089 148.993 35.4245 149.823 34.0955C150.687 32.7665 151.119 30.6402 151.119 27.7164C151.119 24.7927 150.72 22.6829 149.923 21.3871C149.126 20.0582 147.913 19.3937 146.285 19.3937C144.624 19.3937 143.378 20.0249 142.547 21.2875C141.717 22.55 141.285 24.5767 141.251 27.3676V27.7663C141.251 30.69 141.633 32.8164 142.398 34.1454C143.195 35.4411 144.391 36.089 145.986 36.089ZM173.173 28.8626H174.021V34.2948C173.655 34.8597 173.123 35.3414 172.426 35.7401C171.728 36.1056 170.848 36.2883 169.784 36.2883C168.522 36.2883 167.575 35.9727 166.944 35.3414C166.346 34.6769 166.047 33.8131 166.047 32.7499C166.047 31.3212 166.595 30.3245 167.691 29.7597C168.788 29.1617 170.615 28.8626 173.173 28.8626ZM180.25 40.2753C180.051 38.2486 179.951 36.2053 179.951 34.1453V23.1812C179.951 20.1246 179.17 17.965 177.609 16.7025C176.08 15.4399 173.738 14.8087 170.582 14.8087C168.588 14.8087 166.844 15.0579 165.349 15.5562C163.854 16.0546 162.658 16.5696 161.761 17.1012V22.035C162.159 21.736 162.658 21.437 163.256 21.1379C163.887 20.8389 164.552 20.5731 165.249 20.3406C165.98 20.108 166.744 19.9252 167.542 19.7923C168.339 19.6262 169.12 19.5432 169.884 19.5432C171.313 19.5432 172.359 19.8256 173.024 20.3904C173.688 20.922 174.021 21.8689 174.021 23.2311V24.6265H173.074C168.522 24.6265 165.199 25.3408 163.106 26.7695C161.013 28.1649 159.967 30.1418 159.967 32.7001C159.967 35.2584 160.664 37.2186 162.06 38.5808C163.488 39.943 165.349 40.6241 167.641 40.6241C169.369 40.6241 170.681 40.3915 171.579 39.9264C172.476 39.428 173.207 38.8798 173.771 38.2818H174.021C174.054 38.614 174.104 38.9629 174.17 39.3284C174.27 39.6938 174.369 40.0095 174.469 40.2753H180.25ZM190.65 28.1651V40.2755H184.72V15.2076H190.65V26.9691L199.023 15.2076H205.003L196.631 26.9691L206.15 40.2755H199.422L190.65 28.1651ZM220.321 40.2755V19.8922H227.299V15.2076H207.414V19.8922H214.391V40.2755H220.321ZM236.541 15.2076V30.7566L245.612 15.2076H250.894V40.2755H245.163V24.7762L236.093 40.2755H230.81V15.2076H236.541ZM261.804 40.2755V28.1651L270.575 40.2755H277.303L267.784 26.9691L276.157 15.2076H270.176L261.804 26.9691V15.2076H255.873V40.2755H261.804ZM283.251 48.0002C282.653 48.0002 282.154 47.9503 281.756 47.8507C281.357 47.7842 281.025 47.7011 280.759 47.6015C280.46 47.4686 280.211 47.3191 280.011 47.1529V42.3188C280.676 42.9833 281.573 43.3155 282.702 43.3155C283.533 43.3155 284.198 43.1328 284.696 42.7673C285.194 42.4351 285.61 41.9699 285.942 41.3719L277.32 15.2076H283.55L289.082 34.0957L294.613 15.2076H300.345L292.52 38.9299C292.088 40.2256 291.623 41.4217 291.125 42.5181C290.626 43.6145 290.028 44.5614 289.331 45.3588C288.633 46.1894 287.786 46.8373 286.789 47.3025C285.826 47.7676 284.646 48.0002 283.251 48.0002ZM329.757 40.2755H323.976V21.5369L317.895 40.2755H313.061L307.629 21.5867V40.2755H302.596V15.2076H311.217L316.101 31.9029L321.534 15.2076H329.657L329.757 40.2755Z"
          fill="var(--theme-logo-full-foreground)" />
    <defs>
      <clipPath :id="clipId">
        <rect width="46.0032" height="46.0032" fill="white" />
      </clipPath>
    </defs>
  </svg>

  <svg v-else-if="isFavicon"
       width="43"
       height="43"
       viewBox="0 0 43 43"
       fill="none"
       xmlns="http://www.w3.org/2000/svg"
       class="Logo"
       :style="shortLogoStyle"
       role="img"
       :aria-label="props.title">
    <title>{{ props.title }}</title>
    <g :transform="shortLogoMarkTransform">
      <rect :x="shortLogoMarkRectX"
            :width="shortLogoMarkSize"
            :height="shortLogoMarkSize"
            :rx="shortLogoMarkRadius"
            fill="var(--theme-logo-short-background)" />
      <path fill-rule="evenodd"
            clip-rule="evenodd"
            :d="shortLogoMarkPath"
            fill="var(--theme-logo-short-foreground)" />
    </g>
  </svg>

  <svg v-else
       width="89"
       height="43"
       viewBox="0 0 89 43"
       fill="none"
       xmlns="http://www.w3.org/2000/svg"
       class="Logo"
       :style="shortLogoStyle"
       role="img"
       :aria-label="props.title">
    <title>{{ props.title }}</title>
    <g :clip-path="`url(#${clipId})`">
      <circle cx="21.5" cy="21.5" r="21.5" fill="var(--theme-logo-short-background)" />
      <path d="M24.5298 34.4211H29.0216V8.62109H22.4881C15.9174 8.62109 12.4651 11.9992 12.4651 16.9736C12.4651 20.9457 14.3583 23.2844 17.7364 25.6974L11.8711 34.4211H16.7341L23.2676 24.6579L21.0032 23.1359C18.2561 21.2798 16.9197 19.832 16.9197 16.7138C16.9197 13.9667 18.8501 12.1106 22.5252 12.1106H24.5298V34.4211Z"
            fill="var(--theme-logo-short-foreground)" />
    </g>
    <rect :x="shortLogoMarkRectX"
          :width="shortLogoMarkSize"
          :height="shortLogoMarkSize"
          :rx="shortLogoMarkRadius"
          fill="var(--theme-logo-short-background)" />
    <path fill-rule="evenodd"
          clip-rule="evenodd"
          :d="shortLogoMarkPath"
          fill="var(--theme-logo-short-foreground)" />
    <defs>
      <clipPath :id="clipId">
        <rect width="43" height="43" fill="white" />
      </clipPath>
    </defs>
  </svg>
</template>

<style scoped>
.Logo {
  display: block;
}
</style>
