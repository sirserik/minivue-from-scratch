// Regression tests for the reactivity bug-fix round: effect scopes, array
// semantics, collections (Map/Set), nested refs, iteration tracking, computed
// glitches, watch batching and the readonly/shallow refactor. Each block names
// the behavior it pins down. Run: node --test.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ref,
  reactive,
  computed,
  effect,
  watch,
  watchEffect,
  readonly,
  shallowReactive,
  isReactive,
  toRaw,
  effectScope,
} from '../packages/reactivity/index.js'

import { createRenderer } from '../packages/runtime-core/renderer.js'
import { createComponentSystem } from '../packages/runtime-core/component.js'
import { h } from '../packages/runtime-core/vnode.js'
import { nextTick } from '../packages/runtime-core/scheduler.js'
import { testOptions, createRoot } from './helpers/testHost.mjs'

// A microtask "tick" — watch callbacks are batched (flush: 'pre', like Vue).
const tick = () => Promise.resolve()

// ---- C-1: effect scopes and component unmount -------------------------------

test('effectScope: collects effects and stops them as a group', () => {
  const scope = effectScope()
  const count = ref(0)
  let runs = 0
  scope.run(() => {
    effect(() => {
      runs++
      count.value
    })
  })
  assert.equal(runs, 1)
  count.value = 1
  assert.equal(runs, 2)

  scope.stop()
  count.value = 2
  assert.equal(runs, 2, 'stopped scope: the effect no longer reacts')
})

test('unmounted component stops rendering and its watchers', async () => {
  const renderer = createRenderer(testOptions)
  renderer.__installComponents((internals) => createComponentSystem(internals))

  const store = reactive({ n: 0 })
  let renders = 0
  let watchCalls = 0

  const Comp = {
    setup() {
      watch(
        () => store.n,
        () => watchCalls++,
      )
      return () => {
        renders++
        return h('div', null, String(store.n))
      }
    },
  }

  const root = createRoot()
  renderer.render(h(Comp), root)
  assert.equal(renders, 1)

  renderer.render(null, root) // unmount
  store.n++
  await nextTick()
  await tick()
  assert.equal(renders, 1, 'dead component does not re-render')
  assert.equal(watchCalls, 0, 'watcher created in setup was stopped')
})

// ---- C-2: array mutators pause tracking -------------------------------------

test('two effects pushing to the same array do not recurse', () => {
  const arr = reactive([])
  effect(() => arr.push(1))
  effect(() => arr.push(2)) // used to throw RangeError (infinite recursion)
  assert.deepEqual([...arr], [1, 2])
})

// ---- C-3: collections and non-proxyable objects ------------------------------

test('reactive Map: get/set/has/delete/size/forEach are reactive', () => {
  const m = reactive(new Map([['a', 1]]))
  assert.ok(isReactive(m))

  let seen, size, sum
  effect(() => (seen = m.get('a')))
  effect(() => (size = m.size))
  effect(() => {
    sum = 0
    m.forEach((v) => (sum += v))
  })
  assert.deepEqual([seen, size, sum], [1, 1, 1])

  m.set('a', 10) // existing key: value readers and iterations re-run
  assert.equal(seen, 10)
  assert.equal(sum, 10)

  m.set('b', 5) // new key: size and iterations re-run
  assert.equal(size, 2)
  assert.equal(sum, 15)

  m.delete('b')
  assert.equal(size, 1)
  assert.equal(sum, 10)
})

test('reactive Set: add/delete/has/iteration are reactive', () => {
  const s = reactive(new Set([1]))
  let has2, size
  effect(() => (has2 = s.has(2)))
  effect(() => (size = s.size))
  assert.deepEqual([has2, size], [false, 1])

  s.add(2)
  assert.deepEqual([has2, size], [true, 2])
  assert.deepEqual([...s], [1, 2]) // iterator works through the proxy

  s.clear()
  assert.deepEqual([has2, size], [false, 0])
})

test('Map nested in a reactive object works and its values wrap deeply', () => {
  const state = reactive({ m: new Map([['user', { name: 'Anna' }]]) })
  let name
  effect(() => (name = state.m.get('user').name))
  assert.equal(name, 'Anna')
  state.m.get('user').name = 'Boris' // nested object came out reactive
  assert.equal(name, 'Boris')
})

test('non-proxyable objects (Date, RegExp, Promise) stay raw and usable', () => {
  const d = new Date()
  const state = reactive({ d, r: /x/, p: Promise.resolve(1) })
  assert.equal(typeof state.d.getTime(), 'number') // used to throw TypeError
  assert.equal(state.d, d, 'returned as-is, not wrapped')
  assert.ok(state.r.test('x'))
  assert.equal(typeof state.p.then, 'function')
})

// ---- C-4: refs nested in reactive objects ------------------------------------

test('ref inside reactive: unwrapped on read, written through on assign', () => {
  const r = ref(0)
  const state = reactive({ count: r })
  assert.equal(state.count, 0, 'read gives the value, not the ref')

  state.count = 7
  assert.equal(r.value, 7, 'write goes into ref.value, the ref survives')
  assert.equal(state.count, 7)

  // Arrays do NOT unwrap by index (Vue semantics).
  const list = reactive([ref(1)])
  assert.equal(list[0].value, 1)
})

// ---- M-1: array length semantics ---------------------------------------------

test('array: setting an index beyond length triggers length readers', () => {
  const arr = reactive([1, 2])
  let len
  effect(() => (len = arr.length))
  arr[5] = 99
  assert.equal(len, 6)
})

test('array: shrinking length triggers readers of removed indices', () => {
  const arr = reactive([1, 2, 3])
  let first
  effect(() => (first = arr[0]))
  arr.length = 0
  assert.equal(first, undefined)
})

test('array: assigning the same length does not re-run effects', () => {
  const arr = reactive([1, 2])
  let runs = 0
  effect(() => {
    runs++
    arr.length
  })
  arr.length = 2
  assert.equal(runs, 1)
})

// ---- M-2: iteration / has / delete tracking -----------------------------------

test('Object.keys re-runs when a key is added', () => {
  const state = reactive({ a: 1 })
  let keys
  effect(() => (keys = Object.keys(state)))
  state.b = 2
  assert.deepEqual(keys, ['a', 'b'])
})

test('for...in re-runs when a key is deleted', () => {
  const state = reactive({ a: 1, b: 2 })
  let count
  effect(() => {
    count = 0
    for (const k in state) count++ // eslint-disable-line no-unused-vars
  })
  delete state.b
  assert.equal(count, 1)
})

test('the in operator is tracked', () => {
  const state = reactive({ a: 1 })
  let hasB
  effect(() => (hasB = 'b' in state))
  assert.equal(hasB, false)
  state.b = 2
  assert.equal(hasB, true)
})

// ---- M-3: computed runs before plain effects (no glitch) -----------------------

test('effect reading a value and its computed sees a consistent pair', () => {
  const count = ref(1)
  const plusOne = computed(() => count.value + 1)
  const log = []
  effect(() => log.push(`${count.value}+${plusOne.value}`))
  count.value = 2
  assert.deepEqual(log, ['1+2', '2+3'], 'one re-run, with the fresh computed')
})

// ---- M-4: watch fires only on real change; array of sources --------------------

test('watch(getter) does not fire when the computed value is unchanged', async () => {
  const state = reactive({ n: 1 })
  let calls = 0
  watch(
    () => state.n > 0,
    () => calls++,
  )
  state.n = 2 // true -> true: no change
  await tick()
  assert.equal(calls, 0)
})

test('watch supports an array of sources', async () => {
  const a = ref(1)
  const b = ref(2)
  const calls = []
  watch([a, b], (nv, ov) => calls.push([nv, ov]))
  a.value = 10
  await tick()
  assert.deepEqual(calls, [
    [
      [10, 2],
      [1, 2],
    ],
  ])
})

// ---- M-5: batched flush; self-mutating watcher converges ------------------------

test('watch batches synchronous mutations into one callback', async () => {
  const count = ref(0)
  const calls = []
  watch(count, (n, o) => calls.push([n, o]))
  count.value = 1
  count.value = 2
  await tick()
  assert.deepEqual(calls, [[2, 0]])
})

test('a watcher mutating its own source converges instead of overflowing', async () => {
  const n = ref(0)
  watch(n, () => {
    if (n.value < 5) n.value++
  })
  n.value = 1 // used to throw RangeError (sync recursion)
  await tick()
  assert.equal(n.value, 5)
})

test("watch flush: 'sync' fires on every mutation", () => {
  const count = ref(0)
  const calls = []
  watch(count, (n) => calls.push(n), { flush: 'sync' })
  count.value = 1
  count.value = 2
  assert.deepEqual(calls, [1, 2])
})

// ---- M-6: identity methods against raw elements ---------------------------------

test('includes/indexOf find a raw object inside a reactive array', () => {
  const obj = { id: 1 }
  const arr = reactive([obj])
  assert.equal(arr.includes(obj), true)
  assert.equal(arr.indexOf(obj), 0)
  assert.equal(arr.includes(arr[0]), true, 'the wrapped element is found too')
})

// ---- m-1: readonly caching and stable identity ----------------------------------

test('readonly: nested reads return the same proxy every time', () => {
  const ro = readonly({ nested: { x: 1 } })
  assert.equal(ro.nested, ro.nested)
  const raw = { a: 1 }
  assert.equal(readonly(raw), readonly(raw), 'readonly(x) twice = same proxy')
})

// ---- m-2: prototype-chain shadowing ----------------------------------------------

test('setting a shadowed key on a child does not trigger parent effects', () => {
  const parent = reactive({ a: 1 })
  const child = reactive(Object.create(parent))
  let runs = 0
  effect(() => {
    runs++
    parent.a
  })
  child.a = 2 // shadows on the child; the parent is untouched
  assert.equal(runs, 1)
  assert.equal(parent.a, 1)
  assert.equal(child.a, 2)
})

// ---- m-3: shallowReactive parity ---------------------------------------------------

test('shallowReactive: cached, delete tracked, refs not unwrapped', () => {
  const raw = { a: 1 }
  assert.equal(shallowReactive(raw), shallowReactive(raw), 'same proxy per target')

  const s = shallowReactive({ a: 1, r: ref(5) })
  assert.equal(s.r.value, 5, 'shallow does not unwrap refs')

  let seen
  effect(() => (seen = s.a))
  delete s.a
  assert.equal(seen, undefined, 'deleteProperty triggers')
})

// ---- m-4: writable computed ----------------------------------------------------------

test('computed({ get, set }) forwards writes to the setter', () => {
  const n = ref(1)
  const twice = computed({
    get: () => n.value * 2,
    set: (v) => (n.value = v / 2),
  })
  assert.equal(twice.value, 2)
  twice.value = 10
  assert.equal(n.value, 5)
  assert.equal(twice.value, 10)
})

// ---- m-5: no duplicate dep records ------------------------------------------------

test('reading the same source twice records its dep once', () => {
  const count = ref(0)
  const runner = effect(() => {
    count.value
    count.value // second read of the same dep
  })
  assert.equal(runner.effect.deps.length, 1)
})

// ---- m-6: well-known symbols are not tracked ----------------------------------------

test('well-known symbol reads do not subscribe effects', () => {
  const arr = reactive([1, 2])
  let runs = 0
  effect(() => {
    runs++
    arr[Symbol.iterator] // engine plumbing, not data
  })
  assert.equal(runs, 1)
  arr[Symbol.iterator] = Array.prototype[Symbol.iterator]
  assert.equal(runs, 1, 'no re-run: the symbol read was never tracked')
})

// ---- m-7: onCleanup, deep and once options -------------------------------------------

test('watch: onCleanup runs before the next callback and on stop', async () => {
  const count = ref(0)
  const log = []
  const stop = watch(count, (n, o, onCleanup) => {
    onCleanup(() => log.push(`cleanup before ${n + 1}`))
    log.push(`cb ${n}`)
  })
  count.value = 1
  await tick()
  count.value = 2
  await tick()
  stop()
  assert.deepEqual(log, ['cb 1', 'cleanup before 2', 'cb 2', 'cleanup before 3'])
})

test('watchEffect: receives onCleanup', async () => {
  const count = ref(0)
  const log = []
  watchEffect((onCleanup) => {
    const n = count.value
    onCleanup(() => log.push(`cleanup ${n}`))
    log.push(`run ${n}`)
  })
  count.value = 1
  await tick()
  assert.deepEqual(log, ['run 0', 'cleanup 0', 'run 1'])
})

test('watch: deep option watches a plain getter deeply', async () => {
  const state = reactive({ nested: { x: 1 } })
  let calls = 0
  watch(
    () => state.nested,
    () => calls++,
    { deep: true },
  )
  state.nested.x = 2 // same object, inner change — deep sees it
  await tick()
  assert.equal(calls, 1)
})

test('watch: once stops after the first call', async () => {
  const count = ref(0)
  let calls = 0
  watch(count, () => calls++, { once: true })
  count.value = 1
  await tick()
  count.value = 2
  await tick()
  assert.equal(calls, 1)
})

// ---- m-8: traverse reaches refs and collections ---------------------------------------

test('deep watch of a reactive object sees changes inside a nested Map', async () => {
  const state = reactive({ m: new Map([['a', 1]]) })
  let calls = 0
  watch(state, () => calls++)
  state.m.set('a', 2)
  await tick()
  assert.equal(calls, 1)
})

test('deep watch of a reactive object sees changes behind a nested ref', async () => {
  const inner = ref({ x: 1 })
  const state = reactive({ box: inner })
  let calls = 0
  watch(state, () => calls++)
  inner.value.x = 2 // reached through ref unwrapping in traverse
  await tick()
  assert.equal(calls, 1)
})

// ---- misc: toRaw peels nested wrappers ---------------------------------------------

test('toRaw unwraps readonly-over-reactive down to the raw object', () => {
  const raw = { a: 1 }
  const ro = readonly(reactive(raw))
  assert.equal(toRaw(ro), raw)
})
