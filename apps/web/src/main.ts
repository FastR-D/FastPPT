import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import '@fastrd/ui-vue/styles.css'
import './styles/app.css'
import { fastpptIconUrl } from './components/ui/index.js'
import './color-mode.js'

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { router } from './router.js'

const favicon = document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/svg+xml'
favicon.href = fastpptIconUrl
document.head.append(favicon)

createApp(App).use(createPinia()).use(router).mount('#app')
