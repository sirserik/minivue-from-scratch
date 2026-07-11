// Тесты системы компонентов. Обновления компонентов асинхронные (очередь через
// микрозадачу промиса), поэтому после изменения состояния ждём nextTick().
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createRenderer } from '../packages/runtime-core/renderer.js'
import { createComponentSystem } from '../packages/runtime-core/component.js'
import { h, createVNode } from '../packages/runtime-core/vnode.js'
import { ref } from '../packages/reactivity/index.js'
import { nextTick } from '../packages/runtime-core/scheduler.js'
import { onMounted, onUnmounted } from '../packages/runtime-core/apiLifecycle.js'
import { provide, inject } from '../packages/runtime-core/apiInject.js'
import { testOptions, createRoot, serialize } from './helpers/testHost.mjs'

// Рендерер поверх фейкового хоста + подключённые компоненты.
const renderer = createRenderer(testOptions)
renderer.__installComponents((internals) => createComponentSystem(internals))
const { render } = renderer

test('компонент: setup + render', () => {
  const Hello = {
    setup() {
      return { name: 'мир' }
    },
    render(ctx) {
      return h('h1', 'Привет, ' + ctx.name)
    },
  }
  const root = createRoot()
  render(createVNode(Hello), root)
  assert.equal(serialize(root), '<h1>Привет, мир</h1>')
})

test('компонент: setup может вернуть render-функцию', () => {
  const C = {
    setup() {
      const msg = ref('ок')
      return () => h('p', msg.value)
    },
  }
  const root = createRoot()
  render(createVNode(C), root)
  assert.equal(serialize(root), '<p>ок</p>')
})

test('компонент: реактивное обновление после nextTick', async () => {
  let counter
  const Counter = {
    setup() {
      const count = ref(0)
      counter = count // вынесем наружу, чтобы подёргать в тесте
      return { count }
    },
    render(ctx) {
      return h('span', 'Счёт: ' + ctx.count)
    },
  }
  const root = createRoot()
  render(createVNode(Counter), root)
  assert.equal(serialize(root), '<span>Счёт: 0</span>')

  counter.value = 5
  await nextTick() // дожидаемся применения обновления
  assert.equal(serialize(root), '<span>Счёт: 5</span>')
})

test('компонент: несколько изменений подряд = одна перерисовка', async () => {
  let state
  let renders = 0
  const C = {
    setup() {
      const n = ref(0)
      state = n
      return { n }
    },
    render(ctx) {
      renders++
      return h('i', String(ctx.n))
    },
  }
  const root = createRoot()
  render(createVNode(C), root)
  assert.equal(renders, 1)

  state.value++
  state.value++
  state.value++
  await nextTick()
  assert.equal(serialize(root), '<i>3</i>')
  assert.equal(renders, 2, 'три изменения — только одна дополнительная перерисовка')
})

test('props: родитель передаёт, ребёнок отображает и обновляет', async () => {
  let parentState
  const Child = {
    props: ['label'],
    render(ctx) {
      return h('b', ctx.label)
    },
  }
  const Parent = {
    setup() {
      const text = ref('раз')
      parentState = text
      return { text }
    },
    render(ctx) {
      return h(Child, { label: ctx.text })
    },
  }
  const root = createRoot()
  render(createVNode(Parent), root)
  assert.equal(serialize(root), '<b>раз</b>')

  parentState.value = 'два'
  await nextTick()
  assert.equal(serialize(root), '<b>два</b>')
})

test('emit: ребёнок сообщает родителю о событии', async () => {
  const received = []
  const Child = {
    setup(props, { emit }) {
      // Сохраняем emit наружу через возврат метода.
      return { fire: () => emit('ping', 42) }
    },
    render(ctx) {
      return h('button', { onClick: ctx.fire }, 'go')
    },
  }
  const Parent = {
    render() {
      return h(Child, { onPing: (n) => received.push(n) })
    },
  }
  const root = createRoot()
  const parentInstance = renderComp(Parent, root)
  // Находим кнопку и «кликаем».
  findButton(root).events.click()
  assert.deepEqual(received, [42])
  assert.ok(parentInstance)
})

test('slots: компонент выводит содержимое из родителя', () => {
  const Card = {
    render(ctx) {
      // Слот по умолчанию — функция, возвращающая переданных детей.
      return h('div', { class: 'card' }, ctx.$slots.default())
    },
  }
  const Parent = {
    render() {
      return h(Card, [h('span', 'внутри карточки')])
    },
  }
  const root = createRoot()
  render(createVNode(Parent), root)
  assert.equal(serialize(root), '<div class="card"><span>внутри карточки</span></div>')
})

test('provide/inject: значение доходит до внука', () => {
  const GrandChild = {
    setup() {
      const theme = inject('theme', 'светлая')
      return { theme }
    },
    render(ctx) {
      return h('em', ctx.theme)
    },
  }
  const Child = {
    render() {
      return h(GrandChild)
    },
  }
  const Root = {
    setup() {
      provide('theme', 'тёмная')
    },
    render() {
      return h(Child)
    },
  }
  const root = createRoot()
  render(createVNode(Root), root)
  assert.equal(serialize(root), '<em>тёмная</em>')
})

test('жизненный цикл: onMounted и onUnmounted вызываются', async () => {
  const log = []
  const C = {
    setup() {
      onMounted(() => log.push('mounted'))
      onUnmounted(() => log.push('unmounted'))
      return {}
    },
    render() {
      return h('div', 'x')
    },
  }
  const root = createRoot()
  render(createVNode(C), root)
  assert.deepEqual(log, ['mounted'])
  render(null, root) // размонтируем
  assert.deepEqual(log, ['mounted', 'unmounted'])
})

// --- маленькие помощники ----------------------------------------------------
function renderComp(comp, root) {
  const vnode = createVNode(comp)
  render(vnode, root)
  return vnode.component
}
function findButton(node) {
  if (node.type === 'element' && node.tag === 'button') return node
  for (const c of node.children || []) {
    const f = findButton(c)
    if (f) return f
  }
  return null
}
