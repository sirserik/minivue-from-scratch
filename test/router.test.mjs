// Router tests. We use in-memory history (no window) and the fake host.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import '../packages/compiler/index.js' // register the compiler (for template)
import { createRenderer } from '../packages/runtime-core/renderer.js'
import { createComponentSystem, createAppContext } from '../packages/runtime-core/component.js'
import { createVNode } from '../packages/runtime-core/vnode.js'
import { nextTick } from '../packages/runtime-core/scheduler.js'
import { createRouter, createMemoryHistory, useRoute } from '../packages/router/index.js'
import { testOptions, createRoot, serialize } from './helpers/testHost.mjs'

const renderer = createRenderer(testOptions)
renderer.__installComponents((internals) => createComponentSystem(internals))
const { render } = renderer

// Route components.
const Home = { template: '<h1>Home</h1>', setup: () => ({}) }
const About = { template: '<h1>About</h1>', setup: () => ({}) }
const User = {
  template: '<h1>User {{ route.params.id }}</h1>',
  setup: () => ({ route: useRoute() }),
}

// Build an app with the router (without createApp, since Node has no document).
function mountWithRouter(router, RootComponent) {
  const context = createAppContext()
  // Simulate app.use(router): give the plugin a minimal app.
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

test('router: shows the component for the start route', () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  const { html } = mountWithRouter(router, App)
  assert.equal(html(), '<div><h1>Home</h1></div>')
})

test('router: push changes the displayed component', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  const { html } = mountWithRouter(router, App)
  router.push('/about')
  await nextTick()
  assert.equal(html(), '<div><h1>About</h1></div>')
})

test('router: path params (:id) reach the component', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  const { html } = mountWithRouter(router, App)
  router.push('/user/42')
  await nextTick()
  assert.equal(html(), '<div><h1>User 42</h1></div>')
  assert.deepEqual(router.currentRoute.params, { id: '42' })
})

test('router: unknown path — empty RouterView', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  const { html } = mountWithRouter(router, App)
  router.push('/nope')
  await nextTick()
  assert.equal(html(), '<div></div>')
})

test('router: beforeEach can cancel navigation', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  router.beforeEach((to) => to.path !== '/about') // don't allow /about
  const { html } = mountWithRouter(router, App)
  router.push('/about')
  await nextTick()
  assert.equal(html(), '<div><h1>Home</h1></div>') // stayed put
})

test('router: beforeEach can redirect', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  router.beforeEach((to) => (to.path === '/about' ? '/user/7' : true))
  const { html } = mountWithRouter(router, App)
  router.push('/about')
  await nextTick()
  assert.equal(html(), '<div><h1>User 7</h1></div>')
})
