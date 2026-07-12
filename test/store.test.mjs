// Store tests (Pinia analog).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createRenderer } from '../packages/runtime-core/renderer.js'
import { createComponentSystem } from '../packages/runtime-core/component.js'
import { createVNode, h } from '../packages/runtime-core/vnode.js'
import { effect, ref, computed } from '../packages/reactivity/index.js'
import { nextTick } from '../packages/runtime-core/scheduler.js'
import {
  createPinia,
  defineStore,
  setActivePinia,
  storeToRefs,
} from '../packages/store/index.js'
import { testOptions, createRoot, serialize } from './helpers/testHost.mjs'

const renderer = createRenderer(testOptions)
renderer.__installComponents((internals) => createComponentSystem(internals))
const { render } = renderer

// Options store for most tests.
const useCounter = defineStore('counter', {
  state: () => ({ count: 0 }),
  getters: {
    double: (s) => s.count * 2,
  },
  actions: {
    inc() {
      this.count++
    },
    add(n) {
      this.count += n
    },
  },
})

test('options store: state, getter, action', () => {
  setActivePinia(createPinia())
  const store = useCounter()
  assert.equal(store.count, 0)
  assert.equal(store.double, 0)
  store.inc()
  assert.equal(store.count, 1)
  assert.equal(store.double, 2)
  store.add(5)
  assert.equal(store.count, 6)
})

test('store is a singleton: two useStore calls give the same instance', () => {
  setActivePinia(createPinia())
  const a = useCounter()
  const b = useCounter()
  assert.ok(a === b)
  a.inc()
  assert.equal(b.count, 1) // a change through a is visible in b — it's one store
})

test('store is reactive: effect catches changes', () => {
  setActivePinia(createPinia())
  const store = useCounter()
  const seen = []
  effect(() => seen.push(store.count))
  store.inc()
  store.inc()
  assert.deepEqual(seen, [0, 1, 2])
})

test('getter recomputes reactively', () => {
  setActivePinia(createPinia())
  const store = useCounter()
  const seen = []
  effect(() => seen.push(store.double))
  store.add(3)
  assert.deepEqual(seen, [0, 6])
})

test('setup store: ref/computed/function', () => {
  // Composition API style: return an object of refs, computeds and functions.
  const useCart = defineStore('cart', () => {
    const list = ref([])
    const total = computed(() => list.value.reduce((s, p) => s + p, 0))
    const addItem = (price) => (list.value = [...list.value, price])
    return { list, total, addItem }
  })
  setActivePinia(createPinia())
  const cart = useCart()
  assert.equal(cart.total, 0)
  cart.addItem(500)
  cart.addItem(300)
  assert.equal(cart.total, 800)
  assert.deepEqual(cart.list, [500, 300])
})

test('storeToRefs keeps reactivity across destructuring', () => {
  setActivePinia(createPinia())
  const store = useCounter()
  const { count, double } = storeToRefs(store)
  const seen = []
  effect(() => seen.push(count.value))
  store.inc()
  assert.deepEqual(seen, [0, 1])
  assert.equal(double.value, 2)
})

test('store in a component: a change re-renders', async () => {
  setActivePinia(createPinia())
  const Comp = {
    setup() {
      const store = useCounter()
      return { store }
    },
    render(ctx) {
      return h('span', 'Count: ' + ctx.store.count)
    },
  }
  const root = createRoot()
  render(createVNode(Comp), root)
  assert.equal(serialize(root), '<span>Count: 0</span>')

  const store = useCounter() // the same instance
  store.add(10)
  await nextTick()
  assert.equal(serialize(root), '<span>Count: 10</span>')
})
