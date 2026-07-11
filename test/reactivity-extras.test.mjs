// Тесты расширений реактивности (слой 9).
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

test('watchEffect: сразу выполняется и перезапускается', () => {
  const state = reactive({ n: 1 })
  const seen = []
  const stop = watchEffect(() => seen.push(state.n))
  assert.deepEqual(seen, [1]) // выполнился сразу
  state.n = 2
  assert.deepEqual(seen, [1, 2])
  stop()
  state.n = 3
  assert.deepEqual(seen, [1, 2], 'после stop не реагирует')
})

test('readonly: чтение можно, запись предупреждает и не меняет', () => {
  const original = reactive({ count: 1 })
  const ro = readonly(original)
  assert.ok(isReadonly(ro))
  assert.equal(ro.count, 1)

  const warns = []
  const origWarn = console.warn
  console.warn = (m) => warns.push(m)
  ro.count = 99
  console.warn = origWarn

  assert.equal(ro.count, 1, 'значение не изменилось')
  assert.equal(warns.length, 1, 'было предупреждение')
})

test('readonly: вложенное тоже readonly', () => {
  const ro = readonly({ nested: { x: 1 } })
  assert.ok(isReadonly(ro.nested))
})

test('shallowRef: реагирует на замену .value, но не на мутацию поля', () => {
  const s = shallowRef({ count: 0 })
  const seen = []
  effect(() => seen.push(s.value.count))
  assert.deepEqual(seen, [0])

  // Мутация поля внутри — эффект НЕ срабатывает (мелкая реактивность).
  s.value.count = 5
  assert.deepEqual(seen, [0])

  // Замена всего значения — срабатывает.
  s.value = { count: 10 }
  assert.deepEqual(seen, [0, 10])

  // triggerRef — оповестить вручную.
  s.value.count = 20
  triggerRef(s)
  assert.deepEqual(seen, [0, 10, 20])
})

test('shallowReactive: реактивен только верхний уровень', () => {
  const state = shallowReactive({ count: 0, nested: { x: 1 } })
  const topSeen = []
  const nestedSeen = []
  effect(() => topSeen.push(state.count))
  effect(() => nestedSeen.push(state.nested.x))

  state.count = 1 // верхний уровень — реагирует
  assert.deepEqual(topSeen, [0, 1])

  state.nested.x = 2 // вложенное — НЕ реагирует
  assert.deepEqual(nestedSeen, [1])
})

test('markRaw: помеченный объект не становится реактивным', () => {
  const raw = markRaw({ heavy: true })
  const state = reactive({ raw })
  // state.raw остаётся обычным объектом, не Proxy.
  assert.equal(state.raw, raw)
})
