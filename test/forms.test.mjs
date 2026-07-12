// Layer 8 tests: class/style binding, v-model, event modifiers.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import '../packages/compiler/index.js'
import { compileToString } from '../packages/compiler/compile.js'
import { normalizeClass, normalizeStyle, styleToString } from '../packages/shared.js'
import { renderToString } from '../packages/server-renderer/index.js'
import { createRenderer } from '../packages/runtime-core/renderer.js'
import { createComponentSystem } from '../packages/runtime-core/component.js'
import { createVNode, h } from '../packages/runtime-core/vnode.js'
import { ref } from '../packages/reactivity/index.js'
import { nextTick } from '../packages/runtime-core/scheduler.js'
import { testOptions, createRoot } from './helpers/testHost.mjs'

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

// --- class/style normalization (shared) -------------------------------------
test('normalizeClass: string, array, object', () => {
  assert.equal(normalizeClass('a b'), 'a b')
  assert.equal(normalizeClass(['a', false, 'b', null]), 'a b')
  assert.equal(normalizeClass({ active: true, off: false, on: 1 }), 'active on')
})

test('normalizeStyle / styleToString: object and camelCase', () => {
  assert.deepEqual(normalizeStyle('color: red; font-size: 14px'), {
    color: 'red',
    'font-size': '14px',
  })
  assert.equal(styleToString({ color: 'red', fontSize: '14px' }), 'color:red;font-size:14px')
})

// --- class/style in SSR -----------------------------------------------------
test('SSR: class object and class array are coerced to a string', () => {
  assert.equal(renderToString(h('div', { class: { active: true, off: false } })), '<div class="active"></div>')
  assert.equal(renderToString(h('div', { class: ['a', false, 'b'] })), '<div class="a b"></div>')
})

test('SSR: style object is serialized to a string', () => {
  assert.equal(
    renderToString(h('div', { style: { color: 'red', fontSize: '14px' } })),
    '<div style="color:red;font-size:14px"></div>',
  )
})

// --- v-model ----------------------------------------------------------------
test('codegen v-model: :value + @input', () => {
  const code = compileToString('<input v-model="name" />')
  assert.ok(code.includes('"value": (name)'), code)
  assert.ok(code.includes('"onInput": $event => (name = $event.target.value)'), code)
})

test('codegen v-model on a checkbox: :checked + @change', () => {
  const code = compileToString('<input type="checkbox" v-model="agree" />')
  assert.ok(code.includes('"checked": (agree)'), code)
  assert.ok(code.includes('"onChange": $event => (agree = $event.target.checked)'), code)
})

test('v-model: typing updates state (two-way binding)', async () => {
  let state
  const C = {
    template: '<input v-model="text" />',
    setup() {
      const text = ref('start')
      state = text
      return { text }
    },
  }
  const root = createRoot()
  render(createVNode(C), root)
  const input = findTag(root, 'input')
  assert.equal(input.props.value, 'start') // model → field

  // Simulate typing: field → model.
  input.events.input({ target: { value: 'new' } })
  assert.equal(state.value, 'new')
  await nextTick()
  assert.equal(findTag(root, 'input').props.value, 'new')
})

// --- event modifiers --------------------------------------------------------
test('codegen modifiers: .stop.prevent wraps and adds a guard', () => {
  const code = compileToString('<a @click.stop.prevent="go">x</a>')
  assert.ok(code.includes('$event.stopPropagation()'), code)
  assert.ok(code.includes('$event.preventDefault()'), code)
  assert.ok(code.includes('go($event)'), code)
})

test('codegen keys: @keyup.enter inserts a _key check', () => {
  const code = compileToString('<input @keyup.enter="submit" />')
  assert.ok(code.includes('_key($event,["enter"])'), code)
})

test('@click.prevent calls preventDefault and the handler', () => {
  let prevented = 0
  let called = 0
  const C = {
    template: '<a @click.prevent="go">x</a>',
    setup: () => ({ go: () => called++ }),
  }
  const root = createRoot()
  render(createVNode(C), root)
  findTag(root, 'a').events.click({ preventDefault: () => prevented++ })
  assert.equal(prevented, 1)
  assert.equal(called, 1)
})

test('@keyup.enter fires only on Enter', () => {
  let fired = 0
  const C = {
    template: '<input @keyup.enter="submit" />',
    setup: () => ({ submit: () => fired++ }),
  }
  const root = createRoot()
  render(createVNode(C), root)
  const input = findTag(root, 'input')
  input.events.keyup({ key: 'a' }) // not Enter — ignored
  assert.equal(fired, 0)
  input.events.keyup({ key: 'Enter' })
  assert.equal(fired, 1)
})
