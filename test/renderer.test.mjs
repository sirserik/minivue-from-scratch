// Тесты рендерера и diff-алгоритма. Запуск: node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createRenderer } from '../packages/runtime-core/renderer.js'
import { h, Fragment } from '../packages/runtime-core/vnode.js'
import { testOptions, createRoot, serialize, findById } from './helpers/testHost.mjs'

// Один рендерер поверх фейкового хоста на все тесты.
const { render } = createRenderer(testOptions)

// Удобный помощник: список <li> с ключами и текстом, id = ключу.
const li = (k) => h('li', { key: k, id: k }, k)
const list = (keys) => h('ul', keys.map(li))

test('монтирование: элемент с props и текстом', () => {
  const root = createRoot()
  render(h('div', { id: 'app', class: 'box' }, 'привет'), root)
  assert.equal(serialize(root), '<div class="box" id="app">привет</div>')
})

test('обновление текста без пересоздания узла', () => {
  const root = createRoot()
  render(h('p', 'раз'), root)
  const before = root.children[0]
  render(h('p', 'два'), root)
  const after = root.children[0]
  assert.equal(serialize(root), '<p>два</p>')
  assert.ok(Object.is(before, after), 'элемент переиспользован, а не создан заново')
})

test('патч props: добавление, изменение, удаление', () => {
  const root = createRoot()
  render(h('div', { id: 'a', class: 'x' }), root)
  render(h('div', { id: 'b', 'data-n': '1' }), root)
  // class исчез, id изменился, data-n добавился.
  assert.equal(serialize(root), '<div data-n="1" id="b"></div>')
})

test('дети: текст → массив → текст', () => {
  const root = createRoot()
  render(h('div', 'текст'), root)
  render(h('div', [h('span', 'a'), h('span', 'b')]), root)
  assert.equal(serialize(root), '<div><span>a</span><span>b</span></div>')
  render(h('div', 'снова текст'), root)
  assert.equal(serialize(root), '<div>снова текст</div>')
})

test('несовместимые типы заменяются целиком', () => {
  const root = createRoot()
  render(h('div', 'x'), root)
  render(h('span', 'y'), root)
  assert.equal(serialize(root), '<span>y</span>')
})

test('Fragment: группа узлов без обёртки', () => {
  const root = createRoot()
  render(h(Fragment, [h('i', '1'), h('i', '2')]), root)
  assert.equal(serialize(root), '<i>1</i><i>2</i>')
})

test('события: обработчик навешивается и вызывается', () => {
  const root = createRoot()
  let clicks = 0
  render(h('button', { onClick: () => clicks++ }, 'жми'), root)
  root.children[0].events.click() // имитируем клик
  assert.equal(clicks, 1)
})

test('keyed diff: вставка в середину', () => {
  const root = createRoot()
  render(list(['a', 'b', 'c']), root)
  render(list(['a', 'x', 'b', 'c']), root)
  assert.equal(
    serialize(root),
    '<ul><li id="a">a</li><li id="x">x</li><li id="b">b</li><li id="c">c</li></ul>',
  )
})

test('keyed diff: удаление из середины', () => {
  const root = createRoot()
  render(list(['a', 'b', 'c', 'd']), root)
  render(list(['a', 'c', 'd']), root)
  assert.equal(serialize(root), '<ul><li id="a">a</li><li id="c">c</li><li id="d">d</li></ul>')
})

test('keyed diff: переворот списка сохраняет узлы (идентичность)', () => {
  const root = createRoot()
  render(list(['a', 'b', 'c']), root)
  // Запоминаем реальные узлы до перестановки.
  const nodeA = findById(root, 'a')
  const nodeB = findById(root, 'b')
  const nodeC = findById(root, 'c')

  render(list(['c', 'b', 'a']), root)
  assert.equal(serialize(root), '<ul><li id="c">c</li><li id="b">b</li><li id="a">a</li></ul>')

  // Те же самые объекты-узлы, просто переставленные, а не созданные заново.
  assert.ok(Object.is(nodeA, findById(root, 'a')))
  assert.ok(Object.is(nodeB, findById(root, 'b')))
  assert.ok(Object.is(nodeC, findById(root, 'c')))
})

test('keyed diff: сложная перестановка с добавлением и удалением', () => {
  const root = createRoot()
  render(list(['a', 'b', 'c', 'd', 'e']), root)
  const nodeC = findById(root, 'c')
  // b и d удалены, добавлены x и y, порядок перемешан.
  render(list(['e', 'c', 'x', 'a', 'y']), root)
  assert.equal(
    serialize(root),
    '<ul><li id="e">e</li><li id="c">c</li><li id="x">x</li><li id="a">a</li><li id="y">y</li></ul>',
  )
  assert.ok(Object.is(nodeC, findById(root, 'c')), 'уцелевший узел переиспользован')
})

test('render(null) очищает контейнер', () => {
  const root = createRoot()
  render(h('div', 'x'), root)
  render(null, root)
  assert.equal(serialize(root), '')
})
