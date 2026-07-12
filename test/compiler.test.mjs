// Template compiler tests. We check both the generated code and the full
// "template → render → DOM" cycle via the fake host.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compileToString } from '../packages/compiler/compile.js'
// Importing the compiler index registers compile() in the runtime — now
// components can have a template property.
import '../packages/compiler/index.js'

import { createRenderer } from '../packages/runtime-core/renderer.js'
import { createComponentSystem } from '../packages/runtime-core/component.js'
import { createVNode } from '../packages/runtime-core/vnode.js'
import { ref } from '../packages/reactivity/index.js'
import { nextTick } from '../packages/runtime-core/scheduler.js'
import { testOptions, createRoot, serialize } from './helpers/testHost.mjs'

const renderer = createRenderer(testOptions)
renderer.__installComponents((internals) => createComponentSystem(internals))
const { render } = renderer

// Mount a component with a template and return the serialized result.
function mount(component, props) {
  const root = createRoot()
  render(createVNode(component, props), root)
  return { root, html: () => serialize(root) }
}

// --- code generation --------------------------------------------------------
test('codegen: element with text', () => {
  assert.equal(compileToString('<div>hello</div>'), 'h("div", null, ["hello"])')
})

test('codegen: interpolation', () => {
  assert.equal(compileToString('<p>{{ msg }}</p>'), 'h("p", null, [_s(msg)])')
})

test('codegen: static attribute, :bind and @on', () => {
  const code = compileToString('<button class="btn" :id="bid" @click="inc">click</button>')
  assert.ok(code.includes('"class": "btn"'))
  assert.ok(code.includes('"id": (bid)'))
  assert.ok(code.includes('"onClick": (inc)'))
})

test('codegen: inline handler is wrapped in $event', () => {
  const code = compileToString('<button @click="count++">+</button>')
  assert.ok(code.includes('"onClick": $event => (count++)'))
})

// --- full cycle: template → DOM --------------------------------------------
test('template: state interpolation', () => {
  const C = { template: '<h1>Hello, {{ name }}!</h1>', setup: () => ({ name: 'world' }) }
  assert.equal(mount(C).html(), '<h1>Hello, world!</h1>')
})

test('template: reactive update', async () => {
  let state
  const C = {
    template: '<span>Count: {{ count }}</span>',
    setup() {
      const count = ref(0)
      state = count
      return { count }
    },
  }
  const { html } = mount(C)
  assert.equal(html(), '<span>Count: 0</span>')
  state.value = 7
  await nextTick()
  assert.equal(html(), '<span>Count: 7</span>')
})

test('template: @click changes state', async () => {
  const C = {
    template: '<button @click="inc">{{ count }}</button>',
    setup() {
      const count = ref(0)
      return { count, inc: () => count.value++ }
    },
  }
  const { root, html } = mount(C)
  assert.equal(html(), '<button>0</button>')
  // Find the button and "click" it.
  root.children[0].events.click()
  await nextTick()
  assert.equal(html(), '<button>1</button>')
})

test('template: v-if / v-else', () => {
  const tpl = '<div><span v-if="ok">yes</span><span v-else>no</span></div>'
  const yes = { template: tpl, setup: () => ({ ok: true }) }
  const no = { template: tpl, setup: () => ({ ok: false }) }
  assert.equal(mount(yes).html(), '<div><span>yes</span></div>')
  assert.equal(mount(no).html(), '<div><span>no</span></div>')
})

test('template: v-for over an array', () => {
  const C = {
    template: '<ul><li v-for="(item, i) in items" :key="i">{{ item }}</li></ul>',
    setup: () => ({ items: ['a', 'b', 'c'] }),
  }
  // key is a special attribute; it isn't written to the DOM (see mountElement).
  assert.equal(mount(C).html(), '<ul><li>a</li><li>b</li><li>c</li></ul>')
})

test('template: multiple root nodes are wrapped in a Fragment', () => {
  const C = { template: '<i>1</i><i>2</i>', setup: () => ({}) }
  assert.equal(mount(C).html(), '<i>1</i><i>2</i>')
})
