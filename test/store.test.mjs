// Тесты стора (Pinia-аналог).
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

// Options-стор для большинства тестов.
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

test('options-стор: state, getter, action', () => {
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

test('стор — одиночка: два вызова useStore дают тот же экземпляр', () => {
  setActivePinia(createPinia())
  const a = useCounter()
  const b = useCounter()
  assert.ok(a === b)
  a.inc()
  assert.equal(b.count, 1) // изменение через a видно в b — это один стор
})

test('стор реактивен: effect ловит изменения', () => {
  setActivePinia(createPinia())
  const store = useCounter()
  const seen = []
  effect(() => seen.push(store.count))
  store.inc()
  store.inc()
  assert.deepEqual(seen, [0, 1, 2])
})

test('getter реактивно пересчитывается', () => {
  setActivePinia(createPinia())
  const store = useCounter()
  const seen = []
  effect(() => seen.push(store.double))
  store.add(3)
  assert.deepEqual(seen, [0, 6])
})

test('setup-стор: ref/computed/функция', () => {
  // Стиль Composition API: возвращаем объект из ref, computed и функций.
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

test('storeToRefs сохраняет реактивность при деструктуризации', () => {
  setActivePinia(createPinia())
  const store = useCounter()
  const { count, double } = storeToRefs(store)
  const seen = []
  effect(() => seen.push(count.value))
  store.inc()
  assert.deepEqual(seen, [0, 1])
  assert.equal(double.value, 2)
})

test('стор в компоненте: изменение перерисовывает', async () => {
  setActivePinia(createPinia())
  const Comp = {
    setup() {
      const store = useCounter()
      return { store }
    },
    render(ctx) {
      return h('span', 'Счёт: ' + ctx.store.count)
    },
  }
  const root = createRoot()
  render(createVNode(Comp), root)
  assert.equal(serialize(root), '<span>Счёт: 0</span>')

  const store = useCounter() // тот же экземпляр
  store.add(10)
  await nextTick()
  assert.equal(serialize(root), '<span>Счёт: 10</span>')
})
