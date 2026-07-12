// Layer 10 tests: custom directives, dynamic components, v-model on components.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import '../packages/compiler/index.js'
import { createRenderer } from '../packages/runtime-core/renderer.js'
import { createComponentSystem } from '../packages/runtime-core/component.js'
import { createVNode } from '../packages/runtime-core/vnode.js'
import { ref, shallowRef } from '../packages/reactivity/index.js'
import { nextTick } from '../packages/runtime-core/scheduler.js'
import { testOptions, createRoot, serialize } from './helpers/testHost.mjs'

const renderer = createRenderer(testOptions)
renderer.__installComponents((internals) => createComponentSystem(internals))
const { render } = renderer

function findTag(node, tag) {
  if (node.type === 'element' && node.tag === tag) return node
  for (const c of node.children || []) {
    const f = findTag(c, tag)
    if (f) return f
  }
  return null
}

// --- custom directives ------------------------------------------------------
test('directive: mounted/updated/unmounted and binding', async () => {
  const log = []
  let msg
  const C = {
    directives: {
      demo: {
        mounted(el, b) {
          log.push(['mounted', b.value, b.arg, b.modifiers.loud || false])
        },
        updated(el, b) {
          log.push(['updated', b.value, b.oldValue])
        },
        unmounted() {
          log.push(['unmounted'])
        },
      },
    },
    setup() {
      const text = ref('a')
      msg = text
      return { text }
    },
    template: '<div v-demo:hi.loud="text">x</div>',
  }
  const root = createRoot()
  render(createVNode(C), root)
  assert.deepEqual(log, [['mounted', 'a', 'hi', true]])

  msg.value = 'b'
  await nextTick()
  assert.deepEqual(log[1], ['updated', 'b', 'a'])

  render(null, root)
  assert.deepEqual(log[2], ['unmounted'])
})

test('directive: el and a real action on the node', () => {
  const C = {
    directives: {
      tag: {
        mounted(el, b) {
          el.props['data-dir'] = b.value // the directive mutates the node itself
        },
      },
    },
    setup: () => ({ v: 'ok' }),
    template: '<span v-tag="v">y</span>',
  }
  const root = createRoot()
  render(createVNode(C), root)
  assert.equal(findTag(root, 'span').props['data-dir'], 'ok')
})

// --- dynamic components -----------------------------------------------------
test('<component :is>: switching the component', async () => {
  const One = { template: '<span>one</span>' }
  const Two = { template: '<span>two</span>' }
  let current
  const C = {
    setup() {
      const cur = shallowRef(One) // shallowRef so we don't wrap the component
      current = cur
      return { cur }
    },
    template: '<component :is="cur" />',
  }
  const root = createRoot()
  render(createVNode(C), root)
  assert.equal(serialize(root), '<span>one</span>')

  current.value = Two
  await nextTick()
  assert.equal(serialize(root), '<span>two</span>')
})

test('<component :is> by name (string) via local components', () => {
  const Hello = { template: '<b>hello</b>' }
  const C = {
    components: { Hello },
    setup: () => ({ name: 'Hello' }),
    template: '<component :is="name" />',
  }
  const root = createRoot()
  render(createVNode(C), root)
  assert.equal(serialize(root), '<b>hello</b>')
})

// --- v-model on a component -------------------------------------------------
test('v-model on a component: modelValue + update:modelValue', async () => {
  const MyInput = {
    props: ['modelValue'],
    setup(props, { emit }) {
      return { onIn: (e) => emit('update:modelValue', e.target.value) }
    },
    template: '<input :value="modelValue" @input="onIn" />',
  }
  let parentText
  const Parent = {
    components: { MyInput },
    setup() {
      const text = ref('start')
      parentText = text
      return { text }
    },
    template: '<MyInput v-model="text" />',
  }
  const root = createRoot()
  render(createVNode(Parent), root)
  assert.equal(findTag(root, 'input').props.value, 'start')

  // Typing into the child input → emit upward → parent state updates.
  findTag(root, 'input').events.input({ target: { value: 'changed' } })
  assert.equal(parentText.value, 'changed')
  await nextTick()
  assert.equal(findTag(root, 'input').props.value, 'changed')
})
