// Component system tests. Component updates are asynchronous (queued via a
// promise microtask), so after changing state we wait for nextTick().
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

// Renderer over the fake host + wired-up components.
const renderer = createRenderer(testOptions)
renderer.__installComponents((internals) => createComponentSystem(internals))
const { render } = renderer

test('component: setup + render', () => {
  const Hello = {
    setup() {
      return { name: 'world' }
    },
    render(ctx) {
      return h('h1', 'Hello, ' + ctx.name)
    },
  }
  const root = createRoot()
  render(createVNode(Hello), root)
  assert.equal(serialize(root), '<h1>Hello, world</h1>')
})

test('component: setup may return a render function', () => {
  const C = {
    setup() {
      const msg = ref('ok')
      return () => h('p', msg.value)
    },
  }
  const root = createRoot()
  render(createVNode(C), root)
  assert.equal(serialize(root), '<p>ok</p>')
})

test('component: reactive update after nextTick', async () => {
  let counter
  const Counter = {
    setup() {
      const count = ref(0)
      counter = count // expose it so we can poke it in the test
      return { count }
    },
    render(ctx) {
      return h('span', 'Count: ' + ctx.count)
    },
  }
  const root = createRoot()
  render(createVNode(Counter), root)
  assert.equal(serialize(root), '<span>Count: 0</span>')

  counter.value = 5
  await nextTick() // wait for the update to apply
  assert.equal(serialize(root), '<span>Count: 5</span>')
})

test('component: several consecutive changes = one re-render', async () => {
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
  assert.equal(renders, 2, 'three changes — only one extra re-render')
})

test('props: parent passes, child displays and updates', async () => {
  let parentState
  const Child = {
    props: ['label'],
    render(ctx) {
      return h('b', ctx.label)
    },
  }
  const Parent = {
    setup() {
      const text = ref('one')
      parentState = text
      return { text }
    },
    render(ctx) {
      return h(Child, { label: ctx.text })
    },
  }
  const root = createRoot()
  render(createVNode(Parent), root)
  assert.equal(serialize(root), '<b>one</b>')

  parentState.value = 'two'
  await nextTick()
  assert.equal(serialize(root), '<b>two</b>')
})

test('emit: child notifies parent of an event', async () => {
  const received = []
  const Child = {
    setup(props, { emit }) {
      // Expose emit outward by returning a method.
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
  // Find the button and "click" it.
  findButton(root).events.click()
  assert.deepEqual(received, [42])
  assert.ok(parentInstance)
})

test('slots: component renders content from the parent', () => {
  const Card = {
    render(ctx) {
      // The default slot is a function returning the passed children.
      return h('div', { class: 'card' }, ctx.$slots.default())
    },
  }
  const Parent = {
    render() {
      return h(Card, [h('span', 'inside the card')])
    },
  }
  const root = createRoot()
  render(createVNode(Parent), root)
  assert.equal(serialize(root), '<div class="card"><span>inside the card</span></div>')
})

test('provide/inject: value reaches the grandchild', () => {
  const GrandChild = {
    setup() {
      const theme = inject('theme', 'light')
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
      provide('theme', 'dark')
    },
    render() {
      return h(Child)
    },
  }
  const root = createRoot()
  render(createVNode(Root), root)
  assert.equal(serialize(root), '<em>dark</em>')
})

test('lifecycle: onMounted and onUnmounted are called', async () => {
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
  render(null, root) // unmount
  assert.deepEqual(log, ['mounted', 'unmounted'])
})

// Regression: a keyed list of COMPONENTS (not plain elements) must reorder
// without crashing. Moving a keyed component needs its vnode.el synchronously,
// which updateComponent now carries over from the previous vnode. Before that
// fix a reorder threw "insertBefore ... is not of type Node".
test('component: keyed list of components reorders and moves without crashing', async () => {
  const Item = {
    props: ['label'],
    render(ctx) {
      return h('li', { id: ctx.label }, ctx.label)
    },
  }
  const keys = ref(['a', 'b', 'c'])
  const App = {
    setup() {
      return () => h('ul', keys.value.map((k) => h(Item, { key: k, label: k })))
    },
  }
  const root = createRoot()
  render(createVNode(App), root)
  assert.equal(serialize(root), '<ul><li id="a">a</li><li id="b">b</li><li id="c">c</li></ul>')

  keys.value = ['c', 'b', 'a'] // full reverse — every component must move
  await nextTick()
  assert.equal(serialize(root), '<ul><li id="c">c</li><li id="b">b</li><li id="a">a</li></ul>')

  keys.value = ['c', 'x', 'b', 'a'] // insert a new component in the middle
  await nextTick()
  assert.equal(serialize(root), '<ul><li id="c">c</li><li id="x">x</li><li id="b">b</li><li id="a">a</li></ul>')

  keys.value = ['x'] // collapse to one survivor
  await nextTick()
  assert.equal(serialize(root), '<ul><li id="x">x</li></ul>')
})

// --- small helpers ----------------------------------------------------------
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
