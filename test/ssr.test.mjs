// Тесты SSR: renderToString (сервер) и hydrate (клиент «оживляет» серверный DOM).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import '../packages/compiler/index.js' // для компонентов с template
import { renderToString, createSSRApp } from '../packages/server-renderer/index.js'
import { createRenderer } from '../packages/runtime-core/renderer.js'
import {
  createComponentSystem,
  createSSRComponent,
} from '../packages/runtime-core/component.js'
import { h, createVNode, normalizeVNode } from '../packages/runtime-core/vnode.js'
import { ref } from '../packages/reactivity/index.js'
import { nextTick } from '../packages/runtime-core/scheduler.js'
import {
  shimOptions,
  createRoot,
  buildServerDom,
  serialize,
  findByTag,
} from './helpers/domShim.mjs'

// --- renderToString ---------------------------------------------------------
test('renderToString: элемент с атрибутами и текстом', () => {
  const html = renderToString(h('div', { id: 'app', class: 'box' }, 'привет'))
  assert.equal(html, '<div id="app" class="box">привет</div>')
})

test('renderToString: события не попадают в HTML', () => {
  const html = renderToString(h('button', { onClick: () => {}, type: 'button' }, 'жми'))
  assert.equal(html, '<button type="button">жми</button>')
})

test('renderToString: экранирование против XSS', () => {
  const html = renderToString(h('p', '<script>alert(1)</script>'))
  assert.equal(html, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
})

test('renderToString: вложенные компоненты', () => {
  const Child = { props: ['name'], template: '<span>Привет, {{ name }}</span>' }
  const App = {
    components: {},
    render() {
      return h('div', [h(Child, { name: 'мир' })])
    },
  }
  assert.equal(renderToString(createVNode(App)), '<div><span>Привет, мир</span></div>')
})

test('renderToString: void-теги без закрытия', () => {
  assert.equal(renderToString(h('input', { type: 'text', value: 'x' })), '<input type="text" value="x">')
})

test('createSSRApp: рендер приложения в строку', () => {
  const App = { template: '<h1>Заголовок</h1>' }
  const app = createSSRApp(App)
  assert.equal(app.renderToString(), '<h1>Заголовок</h1>')
})

// --- гидратация -------------------------------------------------------------
test('hydrate: усыновляет DOM, навешивает события и обновляет', async () => {
  const App = {
    setup() {
      const count = ref(0)
      return { count, inc: () => count.value++ }
    },
    render(ctx) {
      return h('button', { onClick: ctx.inc, id: 'btn' }, 'Кликов: ' + ctx.count)
    },
  }

  // 1) Сервер: получаем поддерево и строим из него DOM БЕЗ обработчиков.
  const { subTree } = createSSRComponent(createVNode(App), null)
  const container = createRoot()
  buildServerDom(container, subTree, normalizeVNode)
  const serverButton = findByTag(container, 'button')
  assert.equal(serialize(container), '<button id="btn">Кликов: 0</button>')
  assert.equal(Object.keys(serverButton.events).length, 0, 'на сервере событий нет')

  // 2) Клиент: гидрируем свежий экземпляр приложения поверх этого DOM.
  const renderer = createRenderer(shimOptions)
  renderer.__installComponents((internals) => createComponentSystem(internals))
  renderer.hydrate(createVNode(App), container)

  // Кнопка та же самая (усыновлена, не пересоздана), но теперь с обработчиком.
  const clientButton = findByTag(container, 'button')
  assert.ok(Object.is(serverButton, clientButton), 'узел усыновлён, а не создан заново')
  assert.ok(clientButton.events.click, 'обработчик навешен при гидратации')

  // 3) Кликаем — состояние клиента меняется, DOM патчится на месте.
  clientButton.events.click()
  await nextTick()
  assert.equal(serialize(container), '<button id="btn">Кликов: 1</button>')
})
