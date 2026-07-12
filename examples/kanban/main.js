// MiniTrello browser entry point: assemble the app from our packages.
import { createApp } from '../../packages/minivue.js'
import { createPinia } from '../../packages/store/index.js'
import { createRouter, createWebHashHistory } from '../../packages/router/index.js'
import { App } from './components.js'
import { routes } from './routes.js'
import { focus, clickOutside } from './directives.js'

const app = createApp(App)
app.use(createPinia()) // store
app.use(createRouter({ history: createWebHashHistory(), routes })) // router
app.directive('focus', focus) // custom directives
app.directive('click-outside', clickOutside)
app.mount('#app')
