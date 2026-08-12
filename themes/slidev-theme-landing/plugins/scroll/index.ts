import type { App, Plugin } from 'vue'
import Scroll from './Scroll.vue'

const scrollPlugin: Plugin = {
  install(app: App) {
    app.component('Scroll', Scroll)
  },
}

export default scrollPlugin
