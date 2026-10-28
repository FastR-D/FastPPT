import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import '@fastppt/components/styles.css'
import { fastpptIconUrl, initializeColorMode } from '@fastppt/components'

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { router } from './router.js'

initializeColorMode()
const favicon = document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/svg+xml'
favicon.href = fastpptIconUrl
document.head.append(favicon)

createApp(App).use(createPinia()).use(router).mount('#app')
