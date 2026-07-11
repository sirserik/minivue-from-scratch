// Тесты слоя 11: Teleport, KeepAlive, defineAsyncComponent.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import '../packages/compiler/index.js'
import { createRenderer } from '../packages/runtime-core/renderer.js'
import { createComponentSystem } from '../packages/runtime-core/component.js'
import { createVNode, h } from '../packages/runtime-core/vnode.js'
// KeepAlive используется в тесте через шаблон (<KeepAlive>), а не напрямую.
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
test('Teleport: дети рендерятся в целевом контейнере, а не на месте', () => {
  const root = createRoot()
  const target = createRoot()
  render(h(Teleport, { to: target }, [h('div', 'модалка')]), root)
  assert.equal(serialize(target), '<div>модалка</div>') // ушли в target
  assert.equal(serialize(root), '') // на месте только пустой якорь
})

test('Teleport: обновление детей идёт в целевой контейнер', () => {
  const root = createRoot()
  const target = createRoot()
  render(h(Teleport, { to: target }, [h('div', 'раз')]), root)
  render(h(Teleport, { to: target }, [h('div', 'два')]), root)
  assert.equal(serialize(target), '<div>два</div>')
})

// --- KeepAlive --------------------------------------------------------------
test('KeepAlive: состояние сохраняется при переключении', async () => {
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

  // Меняем состояние A.
  findTag(root, 'button').events.click()
  await nextTick()
  assert.equal(serialize(root), '<button>A1</button>')

  // Переключаемся на B.
  cur.value = B
  await nextTick()
  assert.equal(serialize(root), '<span>B</span>')

  // Возвращаемся к A — состояние (A1) должно сохраниться, а не сброситься в A0.
  cur.value = A
  await nextTick()
  assert.equal(serialize(root), '<button>A1</button>')
  assert.equal(aState.value, 1)
})

// --- defineAsyncComponent ---------------------------------------------------
test('defineAsyncComponent: сначала загрузка, потом компонент', async () => {
  const Real = { render: () => h('b', 'готово') }
  const Async = defineAsyncComponent(() => Promise.resolve(Real))

  const root = createRoot()
  render(createVNode(Async), root)
  assert.equal(serialize(root), '<span>Загрузка…</span>') // пока грузится

  await flush()
  await nextTick()
  assert.equal(serialize(root), '<b>готово</b>') // загрузилось
})

test('defineAsyncComponent: ошибка загрузки', async () => {
  const Async = defineAsyncComponent({
    loader: () => Promise.reject(new Error('нет сети')),
    errorComponent: { render: () => h('em', 'сбой') },
  })
  const root = createRoot()
  render(createVNode(Async), root)
  await flush()
  await nextTick()
  assert.equal(serialize(root), '<em>сбой</em>')
})
