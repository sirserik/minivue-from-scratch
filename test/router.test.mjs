// Тесты роутера. Используем историю «в памяти» (без window) и фейковый хост.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import '../packages/compiler/index.js' // регистрируем компилятор (для template)
import { createRenderer } from '../packages/runtime-core/renderer.js'
import { createComponentSystem, createAppContext } from '../packages/runtime-core/component.js'
import { createVNode } from '../packages/runtime-core/vnode.js'
import { nextTick } from '../packages/runtime-core/scheduler.js'
import { createRouter, createMemoryHistory, useRoute } from '../packages/router/index.js'
import { testOptions, createRoot, serialize } from './helpers/testHost.mjs'

const renderer = createRenderer(testOptions)
renderer.__installComponents((internals) => createComponentSystem(internals))
const { render } = renderer

// Маршрутные компоненты.
const Home = { template: '<h1>Главная</h1>', setup: () => ({}) }
const About = { template: '<h1>О нас</h1>', setup: () => ({}) }
const User = {
  template: '<h1>Пользователь {{ route.params.id }}</h1>',
  setup: () => ({ route: useRoute() }),
}

// Собрать приложение с роутером (без createApp, т.к. в Node нет document).
function mountWithRouter(router, RootComponent) {
  const context = createAppContext()
  // Имитируем app.use(router): даём плагину минимальный app.
  const app = {
    provide: (k, v) => (context.provides[k] = v),
    component: (n, c) => (context.components[n] = c),
    config: context.config,
  }
  router.install(app)

  const root = createRoot()
  const vnode = createVNode(RootComponent)
  vnode.appContext = context
  render(vnode, root)
  return { root, html: () => serialize(root) }
}

const App = { template: '<div><RouterView /></div>', setup: () => ({}) }

const routes = [
  { path: '/', component: Home },
  { path: '/about', component: About },
  { path: '/user/:id', component: User },
]

test('роутер: показывает компонент стартового маршрута', () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  const { html } = mountWithRouter(router, App)
  assert.equal(html(), '<div><h1>Главная</h1></div>')
})

test('роутер: push меняет отображаемый компонент', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  const { html } = mountWithRouter(router, App)
  router.push('/about')
  await nextTick()
  assert.equal(html(), '<div><h1>О нас</h1></div>')
})

test('роутер: параметры пути (:id) доходят до компонента', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  const { html } = mountWithRouter(router, App)
  router.push('/user/42')
  await nextTick()
  assert.equal(html(), '<div><h1>Пользователь 42</h1></div>')
  assert.deepEqual(router.currentRoute.params, { id: '42' })
})

test('роутер: несуществующий путь — пустой RouterView', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  const { html } = mountWithRouter(router, App)
  router.push('/nope')
  await nextTick()
  assert.equal(html(), '<div></div>')
})

test('роутер: beforeEach может отменить переход', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  router.beforeEach((to) => to.path !== '/about') // на /about не пускаем
  const { html } = mountWithRouter(router, App)
  router.push('/about')
  await nextTick()
  assert.equal(html(), '<div><h1>Главная</h1></div>') // остались на месте
})

test('роутер: beforeEach может перенаправить', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  router.beforeEach((to) => (to.path === '/about' ? '/user/7' : true))
  const { html } = mountWithRouter(router, App)
  router.push('/about')
  await nextTick()
  assert.equal(html(), '<div><h1>Пользователь 7</h1></div>')
})
