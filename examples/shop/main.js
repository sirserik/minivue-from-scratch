// Browser entry point for MiniShop: assemble the app from our own packages.
import { createApp } from '../../packages/minivue.js'
import { createPinia } from '../../packages/store/index.js'
import { createRouter, createWebHashHistory } from '../../packages/router/index.js'
import { App } from './components.js'
import { routes } from './routes.js'
import { focus, imgFallback } from './directives.js'

const app = createApp(App)
app.use(createPinia()) // stores (catalog + cart)
app.use(createRouter({ history: createWebHashHistory(), routes })) // routing
app.directive('focus', focus) // custom directives
app.directive('img-fallback', imgFallback)
app.mount('#app')
