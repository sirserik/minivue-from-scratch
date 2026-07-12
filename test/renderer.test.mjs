// Renderer and diff algorithm tests. Run: node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createRenderer } from '../packages/runtime-core/renderer.js'
import { h, Fragment } from '../packages/runtime-core/vnode.js'
import { testOptions, createRoot, serialize, findById } from './helpers/testHost.mjs'

// One renderer over the fake host for all tests.
const { render } = createRenderer(testOptions)

// Handy helper: a list of <li> with keys and text, id = key.
const li = (k) => h('li', { key: k, id: k }, k)
const list = (keys) => h('ul', keys.map(li))

test('mount: element with props and text', () => {
  const root = createRoot()
  render(h('div', { id: 'app', class: 'box' }, 'hello'), root)
  assert.equal(serialize(root), '<div class="box" id="app">hello</div>')
})

test('update text without recreating the node', () => {
  const root = createRoot()
  render(h('p', 'one'), root)
  const before = root.children[0]
  render(h('p', 'two'), root)
  const after = root.children[0]
  assert.equal(serialize(root), '<p>two</p>')
  assert.ok(Object.is(before, after), 'element reused, not recreated')
})

test('patch props: add, change, remove', () => {
  const root = createRoot()
  render(h('div', { id: 'a', class: 'x' }), root)
  render(h('div', { id: 'b', 'data-n': '1' }), root)
  // class removed, id changed, data-n added.
  assert.equal(serialize(root), '<div data-n="1" id="b"></div>')
})

test('children: text → array → text', () => {
  const root = createRoot()
  render(h('div', 'text'), root)
  render(h('div', [h('span', 'a'), h('span', 'b')]), root)
  assert.equal(serialize(root), '<div><span>a</span><span>b</span></div>')
  render(h('div', 'text again'), root)
  assert.equal(serialize(root), '<div>text again</div>')
})

test('incompatible types are replaced entirely', () => {
  const root = createRoot()
  render(h('div', 'x'), root)
  render(h('span', 'y'), root)
  assert.equal(serialize(root), '<span>y</span>')
})

test('Fragment: a group of nodes without a wrapper', () => {
  const root = createRoot()
  render(h(Fragment, [h('i', '1'), h('i', '2')]), root)
  assert.equal(serialize(root), '<i>1</i><i>2</i>')
})

test('events: handler is attached and invoked', () => {
  const root = createRoot()
  let clicks = 0
  render(h('button', { onClick: () => clicks++ }, 'click'), root)
  root.children[0].events.click() // simulate a click
  assert.equal(clicks, 1)
})

test('keyed diff: insert in the middle', () => {
  const root = createRoot()
  render(list(['a', 'b', 'c']), root)
  render(list(['a', 'x', 'b', 'c']), root)
  assert.equal(
    serialize(root),
    '<ul><li id="a">a</li><li id="x">x</li><li id="b">b</li><li id="c">c</li></ul>',
  )
})

test('keyed diff: remove from the middle', () => {
  const root = createRoot()
  render(list(['a', 'b', 'c', 'd']), root)
  render(list(['a', 'c', 'd']), root)
  assert.equal(serialize(root), '<ul><li id="a">a</li><li id="c">c</li><li id="d">d</li></ul>')
})

test('keyed diff: reversing the list preserves nodes (identity)', () => {
  const root = createRoot()
  render(list(['a', 'b', 'c']), root)
  // Remember the real nodes before reordering.
  const nodeA = findById(root, 'a')
  const nodeB = findById(root, 'b')
  const nodeC = findById(root, 'c')

  render(list(['c', 'b', 'a']), root)
  assert.equal(serialize(root), '<ul><li id="c">c</li><li id="b">b</li><li id="a">a</li></ul>')

  // The same node objects, just reordered, not recreated.
  assert.ok(Object.is(nodeA, findById(root, 'a')))
  assert.ok(Object.is(nodeB, findById(root, 'b')))
  assert.ok(Object.is(nodeC, findById(root, 'c')))
})

test('keyed diff: complex reordering with additions and removals', () => {
  const root = createRoot()
  render(list(['a', 'b', 'c', 'd', 'e']), root)
  const nodeC = findById(root, 'c')
  // b and d removed, x and y added, order shuffled.
  render(list(['e', 'c', 'x', 'a', 'y']), root)
  assert.equal(
    serialize(root),
    '<ul><li id="e">e</li><li id="c">c</li><li id="x">x</li><li id="a">a</li><li id="y">y</li></ul>',
  )
  assert.ok(Object.is(nodeC, findById(root, 'c')), 'surviving node reused')
})

test('render(null) clears the container', () => {
  const root = createRoot()
  render(h('div', 'x'), root)
  render(null, root)
  assert.equal(serialize(root), '')
})
