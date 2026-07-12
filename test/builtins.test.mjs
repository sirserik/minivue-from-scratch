// Layer 11 tests: Teleport, KeepAlive, defineAsyncComponent.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import '../packages/compiler/index.js'
import { createRenderer } from '../packages/runtime-core/renderer.js'
import { createComponentSystem } from '../packages/runtime-core/component.js'
import { createVNode, h } from '../packages/runtime-core/vnode.js'
// KeepAlive is used in the test through a template (<KeepAlive>), not directly.
import { Teleport, defineAsyncComponent } from '../packages/runtime-core/builtins.js'
import { ref, shallowRef } from '../packages/reactivity/index.js'
import { nextTick } from '../packages/runtime-core/scheduler.js'
import { testOptions, createRoot, serialize } from './helpers/testHost.mjs'

const renderer = createRenderer(testOptions)
renderer.__installComponents((internals) => createComponentSystem(internals))
const { render } = renderer

const flush = () => new Promise((r) => setTimeout(r, 0))
function findTag(node, tag) {
  if (node.type === 'element' && node.tag === tag) return node
  for (const c of node.children || []) {
    const f = findTag(c, tag)
    if (f) return f
  }
  return null
}

// --- Teleport ---------------------------------------------------------------
test('Teleport: children render in the target container, not in place', () => {
  const root = createRoot()
  const target = createRoot()
  render(h(Teleport, { to: target }, [h('div', 'modal')]), root)
  assert.equal(serialize(target), '<div>modal</div>') // went to target
  assert.equal(serialize(root), '') // only an empty anchor stays in place
})

test('Teleport: updating children goes to the target container', () => {
  const root = createRoot()
  const target = createRoot()
  render(h(Teleport, { to: target }, [h('div', 'one')]), root)
  render(h(Teleport, { to: target }, [h('div', 'two')]), root)
  assert.equal(serialize(target), '<div>two</div>')
})

// --- KeepAlive --------------------------------------------------------------
test('KeepAlive: state is preserved when switching', async () => {
  let aState
  const A = {
    setup() {
      const n = ref(0)
      aState = n
      return { n, inc: () => n.value++ }
    },
    template: '<button @click="inc">A{{ n }}</button>',
  }
  const B = { template: '<span>B</span>' }

  let cur
  const App = {
    setup() {
      const c = shallowRef(A)
      cur = c
      return { c }
    },
    template: '<KeepAlive><component :is="c" /></KeepAlive>',
  }

  const root = createRoot()
  render(createVNode(App), root)
  assert.equal(serialize(root), '<button>A0</button>')

  // Change A's state.
  findTag(root, 'button').events.click()
  await nextTick()
  assert.equal(serialize(root), '<button>A1</button>')

  // Switch to B.
  cur.value = B
  await nextTick()
  assert.equal(serialize(root), '<span>B</span>')

  // Switch back to A — its state (A1) must be preserved, not reset to A0.
  cur.value = A
  await nextTick()
  assert.equal(serialize(root), '<button>A1</button>')
  assert.equal(aState.value, 1)
})

// --- defineAsyncComponent ---------------------------------------------------
test('defineAsyncComponent: loading first, then the component', async () => {
  const Real = { render: () => h('b', 'done') }
  const Async = defineAsyncComponent(() => Promise.resolve(Real))

  const root = createRoot()
  render(createVNode(Async), root)
  assert.equal(serialize(root), '<span>Loading…</span>') // while loading

  await flush()
  await nextTick()
  assert.equal(serialize(root), '<b>done</b>') // loaded
})

test('defineAsyncComponent: load failure', async () => {
  const Async = defineAsyncComponent({
    loader: () => Promise.reject(new Error('no network')),
    errorComponent: { render: () => h('em', 'failed') },
  })
  const root = createRoot()
  render(createVNode(Async), root)
  await flush()
  await nextTick()
  assert.equal(serialize(root), '<em>failed</em>')
})
