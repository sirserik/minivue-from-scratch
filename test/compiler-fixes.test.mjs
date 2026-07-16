// Regression tests for a batch of template-compiler bug fixes. Each block
// names the finding it guards (C = critical, H = high, M = medium, L = low),
// so a future refactor that reintroduces a bug fails with a readable pointer.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parse, NodeTypes } from '../packages/compiler/parse.js'
import { compile, compileToString } from '../packages/compiler/compile.js'
// Importing the compiler index registers compile() in the runtime — now
// components can have a template property.
import '../packages/compiler/index.js'

import { createRenderer } from '../packages/runtime-core/renderer.js'
import { createComponentSystem } from '../packages/runtime-core/component.js'
import { createVNode, Fragment } from '../packages/runtime-core/vnode.js'
import { patchProp as domPatchProp } from '../packages/runtime-dom/patchProp.js'
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

// --- C1: parser must not hang on '<' that is not a tag ----------------------
test('C1: HTML comments are parsed and skipped', () => {
  const ast = parse('<div><!-- note --></div>')
  assert.equal(ast[0].children.length, 0)
  // A top-level comment before content works too.
  const ast2 = parse('<!-- hi --><div>x</div>')
  assert.equal(ast2.length, 1)
  assert.equal(ast2[0].tag, 'div')
})

test('C1: a stray "<" is plain text, not an infinite loop', () => {
  assert.deepEqual(parse('<div>5 < 10</div>')[0].children, [
    { type: NodeTypes.TEXT, content: '5 < 10' },
  ])
  assert.deepEqual(parse('<p>i <3 vue</p>')[0].children, [
    { type: NodeTypes.TEXT, content: 'i <3 vue' },
  ])
})

test('C1: unterminated comment is a compile error, not a hang', () => {
  assert.throws(() => parse('<div><!-- oops</div>'), /closing "-->"/)
})

// --- C2: v-if on a single root node ------------------------------------------
test('C2: root v-if compiles the condition', () => {
  const code = compileToString('<div v-if="show">hi</div>')
  assert.ok(code.includes('(show) ?'), code)
  const r = compile('<div v-if="show">hi</div>')
  assert.equal(r({ show: false }), null)
  assert.equal(r({ show: true }).type, 'div')
})

test('C2: root v-if=false renders nothing when mounted', () => {
  const C = { template: '<div v-if="show">secret</div>', setup: () => ({ show: false }) }
  assert.equal(mount(C).html(), '')
})

// --- C3: v-for + v-if on the same node ---------------------------------------
test('C3: v-if wraps v-for; the list is not nested as a raw array', () => {
  const tpl = '<ul><li v-for="i in items" v-if="ok">{{ i }}</li></ul>'
  const on = { template: tpl, setup: () => ({ items: [1, 2, 3], ok: true }) }
  const off = { template: tpl, setup: () => ({ items: [1, 2, 3], ok: false }) }
  assert.equal(mount(on).html(), '<ul><li>1</li><li>2</li><li>3</li></ul>')
  assert.equal(mount(off).html(), '<ul></ul>')
})

// --- C4: v-for as the single root --------------------------------------------
test('C4: root v-for is wrapped in a Fragment vnode', () => {
  const r = compile('<li v-for="i in items">{{ i }}</li>')
  const vnode = r({ items: [1, 2] })
  assert.equal(vnode.type, Fragment)
  const C = { template: '<li v-for="i in items">{{ i }}</li>', setup: () => ({ items: [1, 2] }) }
  assert.equal(mount(C).html(), '<li>1</li><li>2</li>')
})

// --- H1: object forms v-bind="obj" / v-on="handlers" -------------------------
test('H1: v-bind="obj" merges the object into props at render time', () => {
  const C = {
    template: '<div id="static" v-bind="extra">x</div>',
    setup: () => ({ extra: { title: 'hey', 'data-x': '1' } }),
  }
  assert.equal(mount(C).html(), '<div data-x="1" id="static" title="hey">x</div>')
})

test('H1: v-bind="obj" combines class from both sources', () => {
  const C = {
    template: '<div class="a" v-bind="extra">x</div>',
    setup: () => ({ extra: { class: 'b' } }),
  }
  assert.equal(mount(C).html(), '<div class="a b">x</div>')
})

test('H1: v-on="handlers" attaches every handler with the on-prefix', () => {
  let clicks = 0
  const C = {
    template: '<button v-on="handlers">x</button>',
    setup: () => ({ handlers: { click: () => clicks++ } }),
  }
  const { root } = mount(C)
  root.children[0].events.click()
  assert.equal(clicks, 1)
})

// --- H2: v-model on radio inputs ----------------------------------------------
test('H2: radio v-model → checked comparison + @change, value kept', () => {
  const code = compileToString('<input type="radio" v-model="picked" value="a">')
  assert.ok(code.includes('"value": "a"'), code)
  assert.ok(code.includes('"checked": (picked === "a")'), code)
  assert.ok(code.includes('"onChange": $event => (picked = "a")'), code)
})

test('H2: radio group checks only the matching input', () => {
  const C = {
    template:
      '<form><input type="radio" value="a" v-model="p"><input type="radio" value="b" v-model="p"></form>',
    setup: () => ({ p: 'b' }),
  }
  const { root } = mount(C)
  const [ra, rb] = root.children[0].children
  assert.equal(ra.props.checked, undefined) // false → attribute removed
  assert.equal(rb.props.checked, true)
})

// --- H3: orphan v-else / v-else-if --------------------------------------------
test('H3: v-else without an adjacent v-if is a compile error', () => {
  assert.throws(
    () => compileToString('<div><p v-if="a">A</p><hr><p v-else>B</p></div>'),
    /v-else.*no adjacent v-if/,
  )
  assert.throws(() => compileToString('<div><p v-else-if="b">B</p></div>'), /no adjacent v-if/)
})

test('H3: whitespace between branches does not break the chain', () => {
  const tpl = '<div><p v-if="a">A</p> <p v-else>B</p></div>'
  const C = { template: tpl, setup: () => ({ a: false }) }
  assert.equal(mount(C).html(), '<div><p>B</p></div>')
})

// --- H4: whitespace condensing -------------------------------------------------
test('H4: a space between inline elements survives as one space', () => {
  const C = { template: '<div><b>a</b> <b>b</b></div>', setup: () => ({}) }
  assert.equal(mount(C).html(), '<div><b>a</b> <b>b</b></div>')
})

test('H4: indentation whitespace (with newlines) is still dropped', () => {
  const C = { template: '<div>\n  <b>a</b>\n  <b>b</b>\n</div>', setup: () => ({}) }
  assert.equal(mount(C).html(), '<div><b>a</b><b>b</b></div>')
})

// --- H5: dynamic argument :[key] -----------------------------------------------
test('H5: :[key]="val" computes the prop name at render time', () => {
  const vnode = compile('<div :[key]="val">x</div>')({ key: 'id', val: 'seven' })
  assert.equal(vnode.props.id, 'seven')
  assert.ok(!('[key]' in vnode.props))
})

// --- M1: HTML entities -----------------------------------------------------------
test('M1: named and numeric entities decode in text', () => {
  const [div] = parse('<div>Tom &amp; Jerry &lt;3 &#65;&#x42;&nbsp;&quot;&#39;</div>')
  assert.equal(div.children[0].content, 'Tom & Jerry <3 AB "\'')
})

test('M1: entities decode in attribute values; unknown ones stay put', () => {
  const [div] = parse('<div title="a &amp; b">x</div>')
  assert.equal(div.props[0].value, 'a & b')
  const [p] = parse('<p>&unknown; stays</p>')
  assert.equal(p.children[0].content, '&unknown; stays')
})

// --- M2: mismatched / unclosed tags ---------------------------------------------
test('M2: mismatched closing tag is a compile error naming both tags', () => {
  assert.throws(() => parse('<div><b>bold</i> tail</div>'), /<\/i>.*<b>/)
})

test('M2: unclosed tag at EOF is a compile error', () => {
  assert.throws(() => parse('<div><span>a'), /missing its closing tag/)
})

test('M2: stray closing tag at top level is a compile error', () => {
  assert.throws(() => parse('</div>'), /no matching open tag/)
})

// --- M3: v-for aliases -------------------------------------------------------------
test('M3: v-for supports three aliases over an object', () => {
  const C = {
    template: '<ul><li v-for="(v, k, i) in obj">{{ i }}:{{ k }}={{ v }}</li></ul>',
    setup: () => ({ obj: { a: 1, b: 2 } }),
  }
  assert.equal(mount(C).html(), '<ul><li>0:a=1</li><li>1:b=2</li></ul>')
})

test('M3: v-for supports destructuring the item', () => {
  const C = {
    template: '<ul><li v-for="{ id } in items">{{ id }}</li></ul>',
    setup: () => ({ items: [{ id: 1 }, { id: 2 }] }),
  }
  assert.equal(mount(C).html(), '<ul><li>1</li><li>2</li></ul>')
})

test('M3/M6: malformed v-for is a clear compile error', () => {
  assert.throws(() => compileToString('<li v-for="items">x</li>'), /Invalid v-for expression/)
})

// --- M4: unknown identifiers and globals in templates -----------------------------
test('M4: unknown identifier renders as undefined and warns once', () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (msg) => warnings.push(msg)
  try {
    const C = { template: '<div>{{ m4missing }}</div>', setup: () => ({}) }
    assert.equal(mount(C).html(), '<div></div>') // no ReferenceError
  } finally {
    console.warn = origWarn
  }
  assert.equal(warnings.filter((w) => w.includes('m4missing')).length, 1)
})

test('M4: whitelisted globals like Math still work; window does not leak', () => {
  const origWarn = console.warn
  console.warn = () => {}
  try {
    const ok = { template: '<div>{{ Math.max(1, 2) }}</div>', setup: () => ({}) }
    assert.equal(mount(ok).html(), '<div>2</div>')
    const blocked = { template: '<div>{{ typeof window }}</div>', setup: () => ({}) }
    assert.equal(mount(blocked).html(), '<div>undefined</div>')
  } finally {
    console.warn = origWarn
  }
})

// --- M6: unterminated interpolation --------------------------------------------
test('M6: unterminated {{ is a compile error quoting the template', () => {
  assert.throws(() => parse('<div>hi {{ oops</div>'), /missing its closing "}}"/)
})

// --- L1: .once/.capture/.passive event modifiers --------------------------------
test('L1: option modifiers are encoded as prop-name suffixes', () => {
  const code = compileToString('<button @click.capture.once="fn">x</button>')
  assert.ok(code.includes('"onClickCaptureOnce"'), code)
})

test('L1: runtime-dom patchProp decodes the suffixes into listener options', () => {
  const calls = []
  const el = {
    addEventListener: (name, fn, options) => calls.push(['add', name, options]),
    removeEventListener: (name, fn, options) => calls.push(['remove', name, options]),
  }
  const fn = () => {}
  domPatchProp(el, 'onClickCaptureOnce', null, fn)
  domPatchProp(el, 'onClickCaptureOnce', fn, null)
  assert.deepEqual(calls, [
    ['add', 'click', { once: true, capture: true }],
    ['remove', 'click', { once: true, capture: true }],
  ])
})

test('L1: .passive is passed through as an option', () => {
  const calls = []
  const el = { addEventListener: (name, fn, options) => calls.push([name, options]) }
  domPatchProp(el, 'onScrollPassive', null, () => {})
  assert.deepEqual(calls, [['scroll', { passive: true }]])
})

// --- L2: v-model.lazy and dynamic :type -----------------------------------------
test('L2: v-model.lazy listens to change instead of input', () => {
  const code = compileToString('<input v-model.lazy="x">')
  assert.ok(code.includes('"onChange"'), code)
  assert.ok(!code.includes('"onInput"'), code)
})

test('L2: dynamic :type falls back to text codegen without clobbering', () => {
  const code = compileToString('<input :type="t" v-model="x">')
  assert.ok(code.includes('"type": (t)'), code) // the dynamic type is kept
  assert.ok(code.includes('"onInput"'), code) // safe text fallback
})

// --- L3: :key must not remain among DOM props ------------------------------------
test('L3: key is extracted onto the vnode and stripped from props', () => {
  const vnode = compile('<li :key="id">x</li>')({ id: 7 })
  assert.equal(vnode.key, 7)
  assert.ok(!('key' in vnode.props))
})

// --- L4: v-model.number.trim together ---------------------------------------------
test('L4: .trim and .number both apply (trim first, then Number)', () => {
  const code = compileToString('<input v-model.number.trim="n">')
  assert.ok(code.includes('Number($event.target.value.trim())'), code)
})
