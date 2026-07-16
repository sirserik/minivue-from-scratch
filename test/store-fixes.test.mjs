// Regression tests for the store fixes (S1–S5).
// $subscribe rides on the deep watch (flush: 'pre'), so callbacks land on the
// next microtask after a mutation — tests await Promise.resolve() before asserting.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createPinia, defineStore, setActivePinia } from '../packages/store/index.js'
import { ref, computed } from '../packages/reactivity/index.js'
import { h } from '../packages/runtime-core/index.js'
import { createSSRApp } from '../packages/server-renderer/index.js'

const tick = () => Promise.resolve()

// --- S1: $subscribe sees DEEP mutations in both store styles -----------------
test('S1: setup store $subscribe fires on mutations inside a ref (push, nested, new key)', async () => {
  setActivePinia(createPinia())
  const useCart = defineStore('cart-deep', () => {
    const items = ref([])
    const user = ref({ profile: { name: 'anon' } })
    const addItem = (i) => items.value.push(i)
    return { items, user, addItem }
  })
  const cart = useCart()
  let calls = 0
  cart.$subscribe(() => calls++)

  cart.addItem({ id: 1 }) // array push inside a ref
  await tick()
  assert.equal(calls, 1)

  cart.user.profile.name = 'kim' // nested object inside a ref
  await tick()
  assert.equal(calls, 2)

  cart.user.profile.age = 30 // brand-new key inside a ref
  await tick()
  assert.equal(calls, 3)
})

test('S1: setup store $subscribe does not double-fire through computed', async () => {
  setActivePinia(createPinia())
  const useC = defineStore('c-computed', () => {
    const n = ref(1)
    const double = computed(() => n.value * 2)
    return { n, double }
  })
  const store = useC()
  let calls = 0
  store.$subscribe(() => calls++)
  store.n = 5 // changes n AND double — must still be ONE callback
  await tick()
  assert.equal(calls, 1)
})

test('S1: options store $subscribe fires on push, nested change and new key', async () => {
  setActivePinia(createPinia())
  const useList = defineStore('list-deep', {
    state: () => ({ items: [], meta: { count: 0 } }),
    actions: {
      add(i) {
        this.items.push(i)
      },
    },
  })
  const store = useList()
  let calls = 0
  store.$subscribe(() => calls++)

  store.add('a') // array push
  await tick()
  assert.equal(calls, 1)

  store.meta.count = 1 // nested scalar
  await tick()
  assert.equal(calls, 2)

  store.$state.extra = true // newly-added state key
  await tick()
  assert.equal(calls, 3)
})

// --- S2: pinia is resolved via inject — per app, no cross-app leaks ----------
const useUser = defineStore('user', () => {
  const name = ref('guest')
  return { name }
})

test('S2: two apps with two pinias get their own store instances via inject', () => {
  const p1 = createPinia()
  const p2 = createPinia()
  const mk = (label) => ({
    setup() {
      const user = useUser()
      if (label) user.name = label
      return () => h('p', null, user.name)
    },
  })
  // Both installed before either renders: activePinia now points at p2, but
  // useStore() inside setup resolves through inject and finds ITS app's pinia.
  const app1 = createSSRApp(mk('alice')).use(p1)
  const app2 = createSSRApp(mk(null)).use(p2)
  assert.equal(app1.renderToString(), '<p>alice</p>')
  assert.equal(app2.renderToString(), '<p>guest</p>')
  assert.notEqual(p1._stores.get('user'), p2._stores.get('user'))
})

test('S2: sequential SSR renders with a fresh pinia per request do not leak state', () => {
  const render = (sessionName) => {
    const App = {
      setup() {
        const user = useUser()
        if (sessionName) user.name = sessionName
        return () => h('p', null, user.name)
      },
    }
    // The documented per-request pattern: new pinia + new app for every request.
    return createSSRApp(App).use(createPinia()).renderToString()
  }
  assert.equal(render('alice'), '<p>alice</p>')
  assert.equal(render(null), '<p>guest</p>') // no trace of alice
})

// --- S3: $state assignment patches into the existing reactive state ----------
test('S3: store.$state = obj patches keys (no longer a silent no-op)', async () => {
  setActivePinia(createPinia())
  const useS = defineStore('state-assign', { state: () => ({ a: 1, b: 2 }) })
  const store = useS()
  let calls = 0
  store.$subscribe(() => calls++)

  store.$state = { a: 100 }
  assert.equal(store.a, 100)
  assert.equal(store.b, 2) // untouched keys survive — it's a patch, not a swap
  await tick()
  assert.equal(calls, 1) // and subscribers do see it
})

// --- S4: one $patch = one $subscribe callback, with mutation info ------------
test('S4: $patch of several keys fires a single callback with { type, storeId }', async () => {
  setActivePinia(createPinia())
  const useS = defineStore('batch', { state: () => ({ a: 1, b: 2, c: 3 }) })
  const store = useS()
  const seen = []
  store.$subscribe((mutation) => seen.push(mutation))

  store.$patch({ a: 10, b: 20, c: 30 })
  await tick()
  assert.equal(seen.length, 1) // batched: NOT once per key
  assert.deepEqual(seen[0], { type: 'patch object', storeId: 'batch' })

  store.$patch((s) => {
    s.a++
    s.b++
  })
  await tick()
  assert.equal(seen.length, 2)
  assert.equal(seen[1].type, 'patch function')

  store.a = 99 // a later plain assignment reports 'direct' again
  await tick()
  assert.equal(seen.length, 3)
  assert.equal(seen[2].type, 'direct')
})

// --- S5: $reset on a setup store throws like Pinia ----------------------------
test('S5: $reset throws on a setup store, works on an options store', () => {
  setActivePinia(createPinia())
  const useSetup = defineStore('setup-reset', () => ({ n: ref(1) }))
  const setupStore = useSetup()
  assert.throws(
    () => setupStore.$reset(),
    /Store "setup-reset" is built using the setup syntax and does not implement \$reset\(\)/,
  )

  const useOpts = defineStore('opts-reset', { state: () => ({ n: 1 }) })
  const optsStore = useOpts()
  optsStore.n = 42
  optsStore.$reset()
  assert.equal(optsStore.n, 1)
})
