// Тесты слоя 10: кастомные директивы, динамические компоненты, v-model на компонентах.
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

// --- кастомные директивы ----------------------------------------------------
test('директива: mounted/updated/unmounted и binding', async () => {
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

test('директива: el и реальное действие над узлом', () => {
  const C = {
    directives: {
      tag: {
        mounted(el, b) {
          el.props['data-dir'] = b.value // директива меняет сам узел
        },
      },
    },
    setup: () => ({ v: 'ок' }),
    template: '<span v-tag="v">y</span>',
  }
  const root = createRoot()
  render(createVNode(C), root)
  assert.equal(findTag(root, 'span').props['data-dir'], 'ок')
})

// --- динамические компоненты ------------------------------------------------
test('<component :is>: переключение компонента', async () => {
  const One = { template: '<span>один</span>' }
  const Two = { template: '<span>два</span>' }
  let current
  const C = {
    setup() {
      const cur = shallowRef(One) // shallowRef, чтобы не оборачивать компонент
      current = cur
      return { cur }
    },
    template: '<component :is="cur" />',
  }
  const root = createRoot()
  render(createVNode(C), root)
  assert.equal(serialize(root), '<span>один</span>')

  current.value = Two
  await nextTick()
  assert.equal(serialize(root), '<span>два</span>')
})

test('<component :is> по имени (строка) через local components', () => {
  const Hello = { template: '<b>привет</b>' }
  const C = {
    components: { Hello },
    setup: () => ({ name: 'Hello' }),
    template: '<component :is="name" />',
  }
  const root = createRoot()
  render(createVNode(C), root)
  assert.equal(serialize(root), '<b>привет</b>')
})

// --- v-model на компоненте --------------------------------------------------
test('v-model на компоненте: modelValue + update:modelValue', async () => {
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
      const text = ref('старт')
      parentText = text
      return { text }
    },
    template: '<MyInput v-model="text" />',
  }
  const root = createRoot()
  render(createVNode(Parent), root)
  assert.equal(findTag(root, 'input').props.value, 'старт')

  // Ввод в дочернем поле → emit наверх → обновляется родительское состояние.
  findTag(root, 'input').events.input({ target: { value: 'изменено' } })
  assert.equal(parentText.value, 'изменено')
  await nextTick()
  assert.equal(findTag(root, 'input').props.value, 'изменено')
})
