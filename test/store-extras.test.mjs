// Layer 12 tests: $patch / $subscribe / $reset.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createPinia, defineStore, setActivePinia } from '../packages/store/index.js'
import { ref, computed } from '../packages/reactivity/index.js'

const useCounter = defineStore('counter', {
  state: () => ({ count: 0, name: 'x' }),
  actions: {
    inc() {
      this.count++
    },
  },
})

test('$patch with an object and a function', () => {
  setActivePinia(createPinia())
  const store = useCounter()
  store.$patch({ count: 5 })
  assert.equal(store.count, 5)
  store.$patch((s) => {
    s.count += 10
    s.name = 'y'
  })
  assert.equal(store.count, 15)
  assert.equal(store.name, 'y')
})

test('$subscribe is called on change', async () => {
  setActivePinia(createPinia())
  const store = useCounter()
  let calls = 0
  store.$subscribe(() => calls++)
  // $subscribe rides on watch, whose callbacks are batched into a microtask
  // (flush: 'pre', like Vue/Pinia) — so we await between the changes.
  store.inc()
  await Promise.resolve()
  assert.equal(calls, 1)
  store.$patch({ count: 100 })
  await Promise.resolve()
  assert.equal(calls, 2)
})

test('$reset restores the initial state', () => {
  setActivePinia(createPinia())
  const store = useCounter()
  store.$patch({ count: 42, name: 'z' })
  store.$reset()
  assert.equal(store.count, 0)
  assert.equal(store.name, 'x')
})

test('$patch and $subscribe on a setup store', async () => {
  const useCart = defineStore('cart', () => {
    const items = ref([])
    const total = computed(() => items.value.reduce((s, p) => s + p, 0))
    return { items, total }
  })
  setActivePinia(createPinia())
  const cart = useCart()
  let notified = 0
  cart.$subscribe(() => notified++)

  cart.$patch({ items: [100, 200] })
  assert.deepEqual(cart.items, [100, 200])
  assert.equal(cart.total, 300)
  await Promise.resolve() // let the batched watch callback fire
  assert.equal(notified, 1)
})

test('$reset on a setup store throws (as in Pinia)', () => {
  const useThing = defineStore('thing', () => ({ x: ref(1) }))
  setActivePinia(createPinia())
  const store = useThing()
  // A setup store has no state() factory to rebuild the initial state from,
  // so Pinia throws instead of guessing — and so do we.
  assert.throws(() => store.$reset(), /setup syntax and does not implement \$reset/)
})
