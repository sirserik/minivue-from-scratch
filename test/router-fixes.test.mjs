// Regression tests for router bug fixes (guards, matching, history).
// Same setup as router.test.mjs: in-memory history (no window) + fake host,
// plus small window stubs where a browser history is the subject under test.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import '../packages/compiler/index.js' // register the compiler (for template)
import { createRenderer } from '../packages/runtime-core/renderer.js'
import { createComponentSystem, createAppContext } from '../packages/runtime-core/component.js'
import { createVNode } from '../packages/runtime-core/vnode.js'
import { nextTick } from '../packages/runtime-core/scheduler.js'
import {
  createRouter,
  createMemoryHistory,
  createWebHistory,
  createWebHashHistory,
  useRoute,
} from '../packages/router/index.js'
import { testOptions, createRoot, serialize } from './helpers/testHost.mjs'

const renderer = createRenderer(testOptions)
renderer.__installComponents((internals) => createComponentSystem(internals))
const { render } = renderer

// Route components.
const Home = { template: '<h1>Home</h1>', setup: () => ({}) }
const About = { template: '<h1>About</h1>', setup: () => ({}) }
const Login = { template: '<h1>Login</h1>', setup: () => ({}) }
const User = {
  template: '<h1>User {{ route.params.id }}</h1>',
  setup: () => ({ route: useRoute() }),
}

// Build an app with the router (without createApp, since Node has no document).
function mountWithRouter(router, RootComponent) {
  const context = createAppContext()
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
  { path: '/login', component: Login },
  { path: '/user/:id', component: User },
]

// Capture console.warn during fn; returns collected messages.
function collectWarnings(fn) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    fn()
  } finally {
    console.warn = original
  }
  return warnings
}

// --- R1: redirect guards must not recurse forever ---------------------------

test('R1: unconditional redirect guard lands on the target instead of overflowing', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  router.beforeEach(() => '/login') // naive "always send to login" auth guard
  // Redirecting to where the navigation is already going counts as "allow",
  // so this settles at /login instead of a RangeError stack overflow.
  const ok = await router.push('/about')
  assert.equal(ok, true)
  assert.equal(router.currentRoute.path, '/login')
})

test('R1: a real redirect loop is aborted with a warning after 10 hops', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  // Two guards ping-ponging between /about and /login — a genuine loop.
  router.beforeEach((to) => (to.path === '/about' ? '/login' : '/about'))
  let result
  const warnings = collectWarnings(() => {
    result = router.push('/about')
  })
  assert.equal(await result, false) // navigation aborted, not crashed
  assert.equal(router.currentRoute.path, '/') // stayed put
  assert.ok(warnings.some((w) => w.includes('redirects')))
})

// --- R2: guards run on popstate and on the initial navigation ---------------

test('R2: external URL change (Back/Forward) goes through guards and rolls back on cancel', async () => {
  const history = createMemoryHistory('/')
  const router = createRouter({ history, routes })
  router.beforeEach((to) => to.path !== '/about') // /about is forbidden
  mountWithRouter(router, App)

  // Simulate the browser moving the URL (popstate): history changes first,
  // the router only learns about it from the listener.
  history.push('/about')
  await nextTick()
  assert.equal(router.currentRoute.path, '/') // guard blocked it
  assert.equal(history.location, '/') // and the URL was rolled back
})

test('R2: initial navigation runs through guards on install (cancel clears the match)', () => {
  const router = createRouter({ history: createMemoryHistory('/about'), routes })
  router.beforeEach((to) => to.path !== '/about')
  const { html } = mountWithRouter(router, App)
  // The forbidden initial page must not render.
  assert.equal(html(), '<div></div>')
  assert.equal(router.currentRoute.matched.length, 0)
})

test('R2: initial navigation guard can redirect (via replace, no extra history entry)', () => {
  const history = createMemoryHistory('/about')
  const router = createRouter({ history, routes })
  router.beforeEach((to) => (to.path === '/about' ? '/login' : true))
  const { html } = mountWithRouter(router, App)
  assert.equal(html(), '<div><h1>Login</h1></div>')
  assert.equal(history.location, '/login')
  // replace, not push: going back must not return to the rejected /about.
  history.back()
  assert.equal(history.location, '/login')
})

// --- R3: matching specificity ------------------------------------------------

test('R3: static route wins over :param regardless of declaration order', () => {
  const C = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory('/'),
    routes: [
      { path: '/user/:id', component: C, name: 'param' },
      { path: '/user/new', component: C, name: 'static' },
    ],
  })
  assert.equal(router.resolve('/user/new').matched[0].name, 'static')
  assert.deepEqual(router.resolve('/user/new').params, {})
  // Dynamic paths still reach the param route.
  assert.equal(router.resolve('/user/42').matched[0].name, 'param')
  assert.deepEqual(router.resolve('/user/42').params, { id: '42' })
})

// --- R4: async guards --------------------------------------------------------

test('R4: async guard returning false cancels navigation; push returns a Promise', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  router.beforeEach(async () => false)
  const result = router.push('/about')
  assert.ok(typeof result.then === 'function')
  assert.equal(await result, false)
  assert.equal(router.currentRoute.path, '/')
})

test('R4: async guard returning a string redirects', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  router.beforeEach(async (to) => (to.path === '/about' ? '/user/7' : true))
  assert.equal(await router.push('/about'), true)
  assert.equal(router.currentRoute.path, '/user/7')
  assert.deepEqual(router.currentRoute.params, { id: '7' })
})

test('R4: sync fast-path preserved — route applies synchronously with sync guards', () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  router.beforeEach(() => true) // sync guard — no await happens
  router.push('/about')
  // No await: callers relying on synchronous application keep working.
  assert.equal(router.currentRoute.path, '/about')
})

test('R4: a newer navigation supersedes one stuck in an async guard', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  let release
  const gate = new Promise((resolve) => (release = resolve))
  router.beforeEach((to) => (to.path === '/about' ? gate : true))
  const first = router.push('/about') // parked in the guard
  const second = router.push('/login') // starts later, wins
  assert.equal(await second, true)
  release(true) // guard finally allows /about — too late
  assert.equal(await first, false)
  assert.equal(router.currentRoute.path, '/login')
})

// --- R5: query and hash ------------------------------------------------------

test('R5: query string and hash are parsed into the route', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  await router.push('/about?a=1&b=two%20words#frag')
  assert.equal(router.currentRoute.path, '/about')
  assert.deepEqual(router.currentRoute.query, { a: '1', b: 'two words' })
  assert.equal(router.currentRoute.hash, '#frag')
  assert.equal(router.currentRoute.fullPath, '/about?a=1&b=two%20words#frag')
})

test('R5: push accepts an object location { path, query, hash }', async () => {
  const history = createMemoryHistory('/')
  const router = createRouter({ history, routes })
  await router.push({ path: '/about', query: { q: 'vue router' }, hash: 'top' })
  assert.equal(router.currentRoute.path, '/about')
  assert.deepEqual(router.currentRoute.query, { q: 'vue router' })
  assert.equal(router.currentRoute.hash, '#top')
  assert.equal(history.location, '/about?q=vue%20router#top')
})

// --- R6: regex special characters in paths ------------------------------------

test('R6: dots in static paths are literal, and "(" does not break createRouter', () => {
  const C = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory('/'),
    routes: [
      { path: '/file.txt', component: C },
      { path: '/a(b', component: C }, // used to throw "Unterminated group"
    ],
  })
  assert.equal(router.resolve('/file.txt').matched.length, 1)
  assert.equal(router.resolve('/fileXtxt').matched.length, 0) // '.' is not a wildcard
  assert.equal(router.resolve('/a(b').matched.length, 1)
})

// --- R7: malformed percent-encoding -------------------------------------------

test('R7: malformed percent-encoding falls back to the raw value instead of throwing', async () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  let result
  const warnings = collectWarnings(() => {
    result = router.push('/user/100%')
  })
  assert.equal(await result, true)
  assert.equal(router.currentRoute.params.id, '100%')
  assert.ok(warnings.some((w) => w.includes('decode')))
})

// --- R8: trailing slash --------------------------------------------------------

test('R8: trailing slash matches (non-strict mode)', () => {
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  assert.equal(router.resolve('/about/').matched[0].component, About)
  assert.equal(router.resolve('/user/42/').params.id, '42')
})

// --- R9 + destroy: listener teardown -------------------------------------------

test('R9: history.listen returns an unlisten function', () => {
  const history = createMemoryHistory('/')
  const seen = []
  const unlisten = history.listen((path) => seen.push(path))
  history.push('/a')
  unlisten()
  history.push('/b')
  assert.deepEqual(seen, ['/a'])
})

test('R9: createWebHistory().destroy() removes the popstate listener; router.destroy() wires it', () => {
  // Minimal window stub that counts listeners like a real EventTarget.
  const popstate = []
  globalThis.window = {
    location: { pathname: '/' },
    history: {
      pushState: (_s, _t, p) => (window.location.pathname = p),
      replaceState: (_s, _t, p) => (window.location.pathname = p),
    },
    addEventListener: (name, cb) => name === 'popstate' && popstate.push(cb),
    removeEventListener: (name, cb) => {
      const i = popstate.indexOf(cb)
      if (name === 'popstate' && i > -1) popstate.splice(i, 1)
    },
  }
  try {
    const history = createWebHistory()
    assert.equal(popstate.length, 1)
    const router = createRouter({ history, routes })
    router.destroy() // unlisten + history.destroy()
    assert.equal(popstate.length, 0) // the window listener is gone
  } finally {
    delete globalThis.window
  }
})

// --- RouterLink: active classes and object `to` ---------------------------------

test('RouterLink: active/exact-active classes and string href', async () => {
  const LinkApp = {
    template:
      '<div>' +
      '<RouterLink to="/user/42">u42</RouterLink>' +
      '<RouterLink to="/about">about</RouterLink>' +
      '<RouterView />' +
      '</div>',
    setup: () => ({}),
  }
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  const { html } = mountWithRouter(router, LinkApp)
  // At '/': neither link is active.
  assert.ok(!html().includes('router-link-active'))

  await router.push('/user/42')
  await nextTick()
  assert.ok(html().includes('<a class="router-link-active router-link-exact-active" href="/user/42">u42</a>'))
  assert.ok(html().includes('<a href="/about">about</a>')) // still inactive

  await router.push('/about')
  await nextTick()
  assert.ok(html().includes('<a class="router-link-active router-link-exact-active" href="/about">about</a>'))
})

test('RouterLink: object `to` resolves to a URL href (not [object Object])', () => {
  const LinkApp = {
    template: '<div><RouterLink :to="target">go</RouterLink></div>',
    setup: () => ({ target: { path: '/about', query: { a: '1' }, hash: 'x' } }),
  }
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  const { html } = mountWithRouter(router, LinkApp)
  assert.ok(html().includes('href="/about?a=1#x"'))
  assert.ok(!html().includes('[object Object]'))
})

test('RouterLink: prefix match gives active (but not exact) class; root link only exact', async () => {
  const C = { render: () => null }
  const LinkApp = {
    template:
      '<div>' +
      '<RouterLink to="/">home</RouterLink>' +
      '<RouterLink to="/user">users</RouterLink>' +
      '<RouterView />' +
      '</div>',
    setup: () => ({}),
  }
  const router = createRouter({
    history: createMemoryHistory('/'),
    routes: [...routes, { path: '/user', component: C }],
  })
  const { html } = mountWithRouter(router, LinkApp)
  await router.push('/user/42')
  await nextTick()
  // '/user' is a prefix of '/user/42' → active, not exact.
  assert.ok(html().includes('<a class="router-link-active" href="/user">users</a>'))
  // '/' is a prefix of everything — it must NOT light up away from home.
  assert.ok(html().includes('<a href="/">home</a>'))
})

// --- Same-route push deduplication ----------------------------------------------

test('push to the current full path adds no duplicate history entry', async () => {
  const history = createMemoryHistory('/')
  const router = createRouter({ history, routes })
  await router.push('/about')
  await router.push('/about') // duplicate — must be a no-op
  history.back()
  // One back step lands on '/', proving only one '/about' entry exists.
  assert.equal(history.location, '/')
})

// --- Hash history: replace must notify exactly once -------------------------------

test('hash history: replace notifies listeners once, not twice', () => {
  // Stub that mimics a real browser: location.replace changes the hash AND
  // fires hashchange — the old code then notified a second time manually.
  const hashchange = []
  globalThis.window = {
    location: {
      hash: '#/',
      href: 'http://x/#/',
      replace(href) {
        window.location.href = href
        window.location.hash = href.slice(href.indexOf('#'))
        hashchange.forEach((cb) => cb()) // browser fires hashchange
      },
    },
    addEventListener: (name, cb) => name === 'hashchange' && hashchange.push(cb),
    removeEventListener: (name, cb) => {
      const i = hashchange.indexOf(cb)
      if (name === 'hashchange' && i > -1) hashchange.splice(i, 1)
    },
    history: { go: () => {} },
  }
  try {
    const history = createWebHashHistory()
    const seen = []
    history.listen((path) => seen.push(path))
    history.replace('/about')
    assert.deepEqual(seen, ['/about']) // exactly one notification
    history.destroy()
    assert.equal(hashchange.length, 0)
  } finally {
    delete globalThis.window
  }
})

// --- Memory history: go/back/forward ----------------------------------------------

test('memory history: go/back/forward walk a real stack', () => {
  const history = createMemoryHistory('/')
  history.push('/a')
  history.push('/b')
  history.back()
  assert.equal(history.location, '/a')
  history.back()
  assert.equal(history.location, '/')
  history.back() // out of bounds — ignored, like a real browser
  assert.equal(history.location, '/')
  history.forward()
  assert.equal(history.location, '/a')
  history.go(1)
  assert.equal(history.location, '/b')
  // A push after going back erases the forward entries.
  history.back()
  history.push('/c')
  history.forward() // nowhere to go
  assert.equal(history.location, '/c')
})

// --- End-to-end: Back/Forward drive the rendered component -------------------------

test('browser-style back/forward re-render through the guarded pipeline', async () => {
  const history = createMemoryHistory('/')
  const router = createRouter({ history, routes })
  const { html } = mountWithRouter(router, App)
  await router.push('/about')
  await router.push('/user/9')
  history.back() // "browser" Back
  await nextTick()
  assert.equal(html(), '<div><h1>About</h1></div>')
  history.forward()
  await nextTick()
  assert.equal(html(), '<div><h1>User 9</h1></div>')
})
