// Браузерная точка входа MiniTrello: собираем приложение из наших пакетов.
import { createApp } from '../../packages/minivue.js'
import { createPinia } from '../../packages/store/index.js'
import { createRouter, createWebHashHistory } from '../../packages/router/index.js'
import { App } from './components.js'
import { routes } from './routes.js'
import { focus, clickOutside } from './directives.js'

const app = createApp(App)
app.use(createPinia()) // стор
app.use(createRouter({ history: createWebHashHistory(), routes })) // роутер
app.directive('focus', focus) // кастомные директивы
app.directive('click-outside', clickOutside)
app.mount('#app')
