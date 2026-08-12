import type { App, Plugin } from 'vue'
import MyTab from './MyTab.vue'
import MyTabPane from './MyTabPane.vue'

const tabPlugin: Plugin = {
  install(app: App) {
    app.component('MyTab', MyTab)
    app.component('MyTabPane', MyTabPane)
  },
}

export default tabPlugin
