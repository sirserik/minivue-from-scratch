// Reactivity layer tests. Run: node --test (Node's built-in test runner,
// no dependencies). We test behavior, not implementation.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ref,
  reactive,
  computed,
  effect,
  watch,
  isRef,
  isReactive,
  toRefs,
  proxyRefs,
} from '../packages/reactivity/index.js'

test('ref: read and write via .value', () => {
  const count = ref(0)
  assert.equal(count.value, 0)
  count.value = 5
  assert.equal(count.value, 5)
  assert.ok(isRef(count))
})

test('effect: re-runs when a ref changes', () => {
  const count = ref(1)
  let doubled = 0
  effect(() => {
    doubled = count.value * 2
  })
  assert.equal(doubled, 2) // effect ran immediately
  count.value = 10
  assert.equal(doubled, 20) // and re-ran on change
})

test('reactive: intercepts nested objects', () => {
  const state = reactive({ user: { name: 'Anna' }, tags: ['a'] })
  assert.ok(isReactive(state))
  let seen = ''
  effect(() => {
    seen = state.user.name
  })
  assert.equal(seen, 'Anna')
  state.user.name = 'Boris'
  assert.equal(seen, 'Boris') // deep reactivity works
})

test('reactive: arrays (push updates length and elements)', () => {
  const list = reactive([1, 2])
  let sum = 0
  effect(() => {
    sum = list.reduce((a, b) => a + b, 0)
  })
  assert.equal(sum, 3)
  list.push(3)
  assert.equal(sum, 6)
})

test('effect: does not fire when the value is unchanged', () => {
  const count = ref(1)
  let runs = 0
  effect(() => {
    count.value
    runs++
  })
  assert.equal(runs, 1)
  count.value = 1 // same value
  assert.equal(runs, 1) // no re-run
})

test('effect: branching — unsubscribe from an unused dependency (cleanup)', () => {
  const show = ref(true)
  const a = ref('A')
  const b = ref('B')
  let out = ''
  let runs = 0
  effect(() => {
    runs++
    out = show.value ? a.value : b.value
  })
  assert.equal(out, 'A')
  assert.equal(runs, 1)

  // Switch to branch b — now a is no longer read.
  show.value = false
  assert.equal(out, 'B')
  assert.equal(runs, 2)

  // Change a: the effect must NOT re-run, since it unsubscribed from a.
  a.value = 'A2'
  assert.equal(runs, 2)

  // Change b: the effect re-runs.
  b.value = 'B2'
  assert.equal(out, 'B2')
  assert.equal(runs, 3)
})

test('computed: computed lazily and cached', () => {
  const n = ref(2)
  let calls = 0
  const squared = computed(() => {
    calls++
    return n.value * n.value
  })
  // Until it's read, the formula hasn't run.
  assert.equal(calls, 0)
  assert.equal(squared.value, 4)
  assert.equal(calls, 1)
  // Reading again without changes — from cache.
  assert.equal(squared.value, 4)
  assert.equal(calls, 1)
  // Changed the dependency — the next access recomputes.
  n.value = 3
  assert.equal(squared.value, 9)
  assert.equal(calls, 2)
})

test('computed: reactive inside an effect', () => {
  const n = ref(1)
  const twice = computed(() => n.value * 2)
  let seen = 0
  effect(() => {
    seen = twice.value
  })
  assert.equal(seen, 2)
  n.value = 5
  assert.equal(seen, 10)
})

test('watch: receives new and old value', () => {
  const count = ref(0)
  const calls = []
  watch(count, (n, o) => calls.push([n, o]))
  count.value = 1
  count.value = 2
  assert.deepEqual(calls, [
    [1, 0],
    [2, 1],
  ])
})

test('watch: getter and immediate', () => {
  const state = reactive({ a: 1, b: 2 })
  const calls = []
  watch(
    () => state.a + state.b,
    (n) => calls.push(n),
    { immediate: true },
  )
  assert.deepEqual(calls, [3]) // right away
  state.a = 10
  assert.deepEqual(calls, [3, 12])
})

test('watch: deep watching of a reactive object', () => {
  const state = reactive({ nested: { value: 1 } })
  let fired = 0
  watch(state, () => fired++)
  state.nested.value = 2
  assert.equal(fired, 1)
})

test('proxyRefs: automatic .value unwrapping', () => {
  const wrapped = proxyRefs({ count: ref(10), name: 'x' })
  assert.equal(wrapped.count, 10) // no .value
  wrapped.count = 20 // writing goes into ref.value
  assert.equal(wrapped.count, 20)
})

test('toRefs: keeps the reactive link across destructuring', () => {
  const state = reactive({ count: 1 })
  const { count } = toRefs(state)
  let seen = 0
  effect(() => {
    seen = count.value
  })
  state.count = 42 // change the source object
  assert.equal(seen, 42) // the ref from toRefs saw the change
})
