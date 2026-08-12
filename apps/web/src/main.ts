import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import './styles/tokens.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { router } from './router.js'

createApp(App).use(createPinia()).use(router).mount('#app')
