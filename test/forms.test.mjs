// Тесты слоя 8: class/style-биндинг, v-model, модификаторы событий.
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

// --- нормализация class/style (shared) -------------------------------------
test('normalizeClass: строка, массив, объект', () => {
  assert.equal(normalizeClass('a b'), 'a b')
  assert.equal(normalizeClass(['a', false, 'b', null]), 'a b')
  assert.equal(normalizeClass({ active: true, off: false, on: 1 }), 'active on')
})

test('normalizeStyle / styleToString: объект и camelCase', () => {
  assert.deepEqual(normalizeStyle('color: red; font-size: 14px'), {
    color: 'red',
    'font-size': '14px',
  })
  assert.equal(styleToString({ color: 'red', fontSize: '14px' }), 'color:red;font-size:14px')
})

// --- class/style в SSR ------------------------------------------------------
test('SSR: class-объект и class-массив приводятся к строке', () => {
  assert.equal(renderToString(h('div', { class: { active: true, off: false } })), '<div class="active"></div>')
  assert.equal(renderToString(h('div', { class: ['a', false, 'b'] })), '<div class="a b"></div>')
})

test('SSR: style-объект сериализуется в строку', () => {
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

test('codegen v-model на чекбоксе: :checked + @change', () => {
  const code = compileToString('<input type="checkbox" v-model="agree" />')
  assert.ok(code.includes('"checked": (agree)'), code)
  assert.ok(code.includes('"onChange": $event => (agree = $event.target.checked)'), code)
})

test('v-model: ввод обновляет состояние (двусторонняя связь)', async () => {
  let state
  const C = {
    template: '<input v-model="text" />',
    setup() {
      const text = ref('старт')
      state = text
      return { text }
    },
  }
  const root = createRoot()
  render(createVNode(C), root)
  const input = findTag(root, 'input')
  assert.equal(input.props.value, 'старт') // модель → поле

  // Имитируем ввод: поле → модель.
  input.events.input({ target: { value: 'новое' } })
  assert.equal(state.value, 'новое')
  await nextTick()
  assert.equal(findTag(root, 'input').props.value, 'новое')
})

// --- модификаторы событий ---------------------------------------------------
test('codegen модификаторов: .stop.prevent оборачивает и добавляет guard', () => {
  const code = compileToString('<a @click.stop.prevent="go">x</a>')
  assert.ok(code.includes('$event.stopPropagation()'), code)
  assert.ok(code.includes('$event.preventDefault()'), code)
  assert.ok(code.includes('go($event)'), code)
})

test('codegen клавиш: @keyup.enter вставляет проверку _key', () => {
  const code = compileToString('<input @keyup.enter="submit" />')
  assert.ok(code.includes('_key($event,["enter"])'), code)
})

test('@click.prevent вызывает preventDefault и обработчик', () => {
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

test('@keyup.enter срабатывает только на Enter', () => {
  let fired = 0
  const C = {
    template: '<input @keyup.enter="submit" />',
    setup: () => ({ submit: () => fired++ }),
  }
  const root = createRoot()
  render(createVNode(C), root)
  const input = findTag(root, 'input')
  input.events.keyup({ key: 'a' }) // не Enter — игнор
  assert.equal(fired, 0)
  input.events.keyup({ key: 'Enter' })
  assert.equal(fired, 1)
})
