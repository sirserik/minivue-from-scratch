// Reactivity extensions tests (layer 9).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  reactive,
  effect,
  watchEffect,
  readonly,
  isReadonly,
  shallowRef,
  triggerRef,
  shallowReactive,
  markRaw,
} from '../packages/reactivity/index.js'

test('watchEffect: runs immediately and re-runs', () => {
  const state = reactive({ n: 1 })
  const seen = []
  const stop = watchEffect(() => seen.push(state.n))
  assert.deepEqual(seen, [1]) // ran right away
  state.n = 2
  assert.deepEqual(seen, [1, 2])
  stop()
  state.n = 3
  assert.deepEqual(seen, [1, 2], 'no reaction after stop')
})

test('readonly: reads allowed, writes warn and do not change', () => {
  const original = reactive({ count: 1 })
  const ro = readonly(original)
  assert.ok(isReadonly(ro))
  assert.equal(ro.count, 1)

  const warns = []
  const origWarn = console.warn
  console.warn = (m) => warns.push(m)
  ro.count = 99
  console.warn = origWarn

  assert.equal(ro.count, 1, 'value did not change')
  assert.equal(warns.length, 1, 'a warning was emitted')
})

test('readonly: nested is readonly too', () => {
  const ro = readonly({ nested: { x: 1 } })
  assert.ok(isReadonly(ro.nested))
})

test('shallowRef: reacts to replacing .value, but not to mutating a field', () => {
  const s = shallowRef({ count: 0 })
  const seen = []
  effect(() => seen.push(s.value.count))
  assert.deepEqual(seen, [0])

  // Mutating a field inside — the effect does NOT fire (shallow reactivity).
  s.value.count = 5
  assert.deepEqual(seen, [0])

  // Replacing the whole value — it fires.
  s.value = { count: 10 }
  assert.deepEqual(seen, [0, 10])

  // triggerRef — notify manually.
  s.value.count = 20
  triggerRef(s)
  assert.deepEqual(seen, [0, 10, 20])
})

test('shallowReactive: only the top level is reactive', () => {
  const state = shallowReactive({ count: 0, nested: { x: 1 } })
  const topSeen = []
  const nestedSeen = []
  effect(() => topSeen.push(state.count))
  effect(() => nestedSeen.push(state.nested.x))

  state.count = 1 // top level — reacts
  assert.deepEqual(topSeen, [0, 1])

  state.nested.x = 2 // nested — does NOT react
  assert.deepEqual(nestedSeen, [1])
})

test('markRaw: a marked object does not become reactive', () => {
  const raw = markRaw({ heavy: true })
  const state = reactive({ raw })
  // state.raw stays a plain object, not a Proxy.
  assert.equal(state.raw, raw)
})
