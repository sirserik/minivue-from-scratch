// Тесты слоя реактивности. Запуск: node --test (встроенный тест-раннер Node,
// никаких зависимостей). Проверяем поведение, а не реализацию.
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

test('ref: чтение и запись через .value', () => {
  const count = ref(0)
  assert.equal(count.value, 0)
  count.value = 5
  assert.equal(count.value, 5)
  assert.ok(isRef(count))
})

test('effect: перезапускается при изменении ref', () => {
  const count = ref(1)
  let doubled = 0
  effect(() => {
    doubled = count.value * 2
  })
  assert.equal(doubled, 2) // эффект выполнился сразу
  count.value = 10
  assert.equal(doubled, 20) // и перезапустился на изменение
})

test('reactive: перехват вложенных объектов', () => {
  const state = reactive({ user: { name: 'Аня' }, tags: ['a'] })
  assert.ok(isReactive(state))
  let seen = ''
  effect(() => {
    seen = state.user.name
  })
  assert.equal(seen, 'Аня')
  state.user.name = 'Борис'
  assert.equal(seen, 'Борис') // глубокая реактивность работает
})

test('reactive: массивы (push меняет length и элементы)', () => {
  const list = reactive([1, 2])
  let sum = 0
  effect(() => {
    sum = list.reduce((a, b) => a + b, 0)
  })
  assert.equal(sum, 3)
  list.push(3)
  assert.equal(sum, 6)
})

test('effect: не срабатывает, если значение не изменилось', () => {
  const count = ref(1)
  let runs = 0
  effect(() => {
    count.value
    runs++
  })
  assert.equal(runs, 1)
  count.value = 1 // то же самое значение
  assert.equal(runs, 1) // перезапуска не было
})

test('effect: ветвление — отписка от неиспользуемой зависимости (cleanup)', () => {
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

  // Переключаемся на ветку b — теперь a больше не читается.
  show.value = false
  assert.equal(out, 'B')
  assert.equal(runs, 2)

  // Меняем a: эффект НЕ должен перезапуститься, т.к. он отписался от a.
  a.value = 'A2'
  assert.equal(runs, 2)

  // Меняем b: эффект перезапускается.
  b.value = 'B2'
  assert.equal(out, 'B2')
  assert.equal(runs, 3)
})

test('computed: лениво считается и кэшируется', () => {
  const n = ref(2)
  let calls = 0
  const squared = computed(() => {
    calls++
    return n.value * n.value
  })
  // Пока не прочитали — формула не выполнялась.
  assert.equal(calls, 0)
  assert.equal(squared.value, 4)
  assert.equal(calls, 1)
  // Повторное чтение без изменений — из кэша.
  assert.equal(squared.value, 4)
  assert.equal(calls, 1)
  // Изменили зависимость — следующий доступ пересчитает.
  n.value = 3
  assert.equal(squared.value, 9)
  assert.equal(calls, 2)
})

test('computed: реактивен внутри эффекта', () => {
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

test('watch: получает новое и старое значение', () => {
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

test('watch: геттер и immediate', () => {
  const state = reactive({ a: 1, b: 2 })
  const calls = []
  watch(
    () => state.a + state.b,
    (n) => calls.push(n),
    { immediate: true },
  )
  assert.deepEqual(calls, [3]) // сразу
  state.a = 10
  assert.deepEqual(calls, [3, 12])
})

test('watch: глубокое наблюдение за reactive-объектом', () => {
  const state = reactive({ nested: { value: 1 } })
  let fired = 0
  watch(state, () => fired++)
  state.nested.value = 2
  assert.equal(fired, 1)
})

test('proxyRefs: автоматическая распаковка .value', () => {
  const wrapped = proxyRefs({ count: ref(10), name: 'x' })
  assert.equal(wrapped.count, 10) // без .value
  wrapped.count = 20 // запись пишет в ref.value
  assert.equal(wrapped.count, 20)
})

test('toRefs: сохраняет реактивную связь при деструктуризации', () => {
  const state = reactive({ count: 1 })
  const { count } = toRefs(state)
  let seen = 0
  effect(() => {
    seen = count.value
  })
  state.count = 42 // меняем исходный объект
  assert.equal(seen, 42) // ref, полученный из toRefs, увидел изменение
})
