// Тесты компилятора шаблонов. Проверяем и генерируемый код, и полный цикл
// «шаблон → render → DOM» через фейковый хост.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compileToString } from '../packages/compiler/compile.js'
// Импорт индекса компилятора регистрирует compile() в рантайме — теперь
// компоненты могут иметь свойство template.
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

// Смонтировать компонент с шаблоном и вернуть сериализованный результат.
function mount(component, props) {
  const root = createRoot()
  render(createVNode(component, props), root)
  return { root, html: () => serialize(root) }
}

// --- генерация кода ---------------------------------------------------------
test('codegen: элемент с текстом', () => {
  assert.equal(compileToString('<div>привет</div>'), 'h("div", null, ["привет"])')
})

test('codegen: интерполяция', () => {
  assert.equal(compileToString('<p>{{ msg }}</p>'), 'h("p", null, [_s(msg)])')
})

test('codegen: статический атрибут, :bind и @on', () => {
  const code = compileToString('<button class="btn" :id="bid" @click="inc">жми</button>')
  assert.ok(code.includes('"class": "btn"'))
  assert.ok(code.includes('"id": (bid)'))
  assert.ok(code.includes('"onClick": (inc)'))
})

test('codegen: инлайн-обработчик оборачивается в $event', () => {
  const code = compileToString('<button @click="count++">+</button>')
  assert.ok(code.includes('"onClick": $event => (count++)'))
})

// --- полный цикл: шаблон → DOM ---------------------------------------------
test('шаблон: интерполяция состояния', () => {
  const C = { template: '<h1>Привет, {{ name }}!</h1>', setup: () => ({ name: 'мир' }) }
  assert.equal(mount(C).html(), '<h1>Привет, мир!</h1>')
})

test('шаблон: реактивное обновление', async () => {
  let state
  const C = {
    template: '<span>Счёт: {{ count }}</span>',
    setup() {
      const count = ref(0)
      state = count
      return { count }
    },
  }
  const { html } = mount(C)
  assert.equal(html(), '<span>Счёт: 0</span>')
  state.value = 7
  await nextTick()
  assert.equal(html(), '<span>Счёт: 7</span>')
})

test('шаблон: @click меняет состояние', async () => {
  const C = {
    template: '<button @click="inc">{{ count }}</button>',
    setup() {
      const count = ref(0)
      return { count, inc: () => count.value++ }
    },
  }
  const { root, html } = mount(C)
  assert.equal(html(), '<button>0</button>')
  // Находим кнопку и «кликаем».
  root.children[0].events.click()
  await nextTick()
  assert.equal(html(), '<button>1</button>')
})

test('шаблон: v-if / v-else', () => {
  const tpl = '<div><span v-if="ok">да</span><span v-else>нет</span></div>'
  const yes = { template: tpl, setup: () => ({ ok: true }) }
  const no = { template: tpl, setup: () => ({ ok: false }) }
  assert.equal(mount(yes).html(), '<div><span>да</span></div>')
  assert.equal(mount(no).html(), '<div><span>нет</span></div>')
})

test('шаблон: v-for по массиву', () => {
  const C = {
    template: '<ul><li v-for="(item, i) in items" :key="i">{{ item }}</li></ul>',
    setup: () => ({ items: ['a', 'b', 'c'] }),
  }
  // key — служебный атрибут, в DOM он не пишется (см. mountElement).
  assert.equal(mount(C).html(), '<ul><li>a</li><li>b</li><li>c</li></ul>')
})

test('шаблон: несколько корневых узлов оборачиваются во Fragment', () => {
  const C = { template: '<i>1</i><i>2</i>', setup: () => ({}) }
  assert.equal(mount(C).html(), '<i>1</i><i>2</i>')
})
