import type { App, Plugin } from 'vue'
import MyCite from './MyCite.vue'
import References from './References.vue'
const referencesPlugin: Plugin = {
  install(app: App) {
    app.component('MyCite', MyCite)
    app.component('References', References)
  },
}

export default referencesPlugin
