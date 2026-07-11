// Интеграционные тесты приложения MiniTrello: монтируем ВСЁ приложение на
// фейковом хосте (роутер+стор+компилятор+компоненты+Teleport+KeepAlive+async+
// директивы) и проигрываем реальные пользовательские сценарии. Это сквозная
// проверка всего фреймворка на настоящем приложении.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import '../packages/compiler/index.js'
import { createRenderer } from '../packages/runtime-core/renderer.js'
import { createComponentSystem, createAppContext } from '../packages/runtime-core/component.js'
import { createVNode } from '../packages/runtime-core/vnode.js'
import { nextTick } from '../packages/runtime-core/scheduler.js'
import { createPinia } from '../packages/store/index.js'
import { createRouter, createMemoryHistory } from '../packages/router/index.js'
import { createSSRApp } from '../packages/server-renderer/index.js'
import { testOptions, createRoot, serialize } from './helpers/testHost.mjs'

import { App } from '../examples/kanban/components.js'
import { routes } from '../examples/kanban/routes.js'
import { useBoard } from '../examples/kanban/store.js'
import { focus, clickOutside } from '../examples/kanban/directives.js'
// Предзагружаем async-модуль, чтобы import() в defineAsyncComponent резолвился
// из кэша быстро (иначе первая загрузка модуля растягивается на несколько тиков).
import '../examples/kanban/StatsPanel.js'

const flush = () => new Promise((r) => setTimeout(r, 0))
// Подождать выполнения условия (для асинхронных компонентов).
async function waitFor(cond, tries = 20) {
  for (let i = 0; i < tries; i++) {
    if (cond()) return true
    await flush()
    await nextTick()
  }
  return cond()
}

// --- обход фейкового DOM ----------------------------------------------------
function walk(node, fn) {
  fn(node)
  for (const c of node.children || []) walk(c, fn)
}
function text(node) {
  let s = ''
  walk(node, (n) => {
    if (n.type === 'text') s += n.text
  })
  return s
}
function findEls(root, pred) {
  const acc = []
  walk(root, (n) => {
    if (n.type === 'element' && pred(n)) acc.push(n)
  })
  return acc
}
const findEl = (root, pred) => findEls(root, pred)[0]
const byPlaceholder = (root, ph) =>
  findEl(root, (n) => n.props.placeholder && n.props.placeholder.includes(ph))
const cardEl = (root, title) =>
  findEls(root, (n) => n.tag === 'div' && n.events.click && text(n).includes(title))[0]
const button = (root, label) =>
  findEls(root, (n) => n.tag === 'button' && text(n).trim() === label)[0]

// --- монтирование всего приложения на тестовом хосте ------------------------
async function mountApp(start = '/') {
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory(start), routes })
  const context = createAppContext()
  const modalsRoot = createRoot()

  // Мини-app, чтобы плагины (стор, роутер) и директивы установились в контекст.
  const appStub = {
    provide: (k, v) => (context.provides[k] = v),
    component: (n, c) => (context.components[n] = c),
    directive: (n, d) => (context.directives[n] = d),
    config: context.config,
  }
  pinia.install(appStub)
  router.install(appStub)
  appStub.directive('focus', focus)
  appStub.directive('click-outside', clickOutside)

  // Рендерер с querySelector, чтобы Teleport to="#modals" нашёл цель.
  const renderer = createRenderer({
    ...testOptions,
    querySelector: (s) => (s === '#modals' ? modalsRoot : null),
  })
  renderer.__installComponents((i) => createComponentSystem(i))

  const root = createRoot()
  const vnode = createVNode(App)
  vnode.appContext = context
  renderer.render(vnode, root)
  await nextTick()

  return { root, modalsRoot, router, board: useBoard() }
}

// ===========================================================================
test('приложение: стартовый рендер доски', async () => {
  const { root } = await mountApp()
  const html = serialize(root)
  assert.ok(html.includes('MiniTrello'))
  assert.ok(html.includes('Надо') && html.includes('В работе') && html.includes('Готово'))
  assert.ok(html.includes('Сверстать шапку')) // сид-карточка
  assert.ok(html.includes('Активных: 4')) // 4 карточки, ни одной в архиве
})

test('приложение: добавление карточки через v-model + Enter', async () => {
  const { root, board } = await mountApp()
  const input = byPlaceholder(root, 'Новая карточка')
  input.events.input({ target: { value: 'Задеплоить прод' } }) // v-model → draft
  input.events.keyup({ key: 'Enter' }) // @keyup.enter → add
  await nextTick()
  assert.ok(serialize(root).includes('Задеплоить прод'))
  assert.equal(board.count, 5)
})

test('приложение: поиск фильтрует карточки (computed)', async () => {
  const { root } = await mountApp()
  const search = byPlaceholder(root, 'Поиск')
  search.events.input({ target: { value: 'ревью' } })
  await nextTick()
  const html = serialize(root)
  assert.ok(html.includes('Ревью PR'))
  assert.ok(!html.includes('Сверстать шапку')) // отфильтровано
})

test('приложение: правка карточки в модалке (Teleport + v-model)', async () => {
  const { root, modalsRoot, board } = await mountApp()

  cardEl(root, 'Сверстать шапку').events.click() // открыть модалку
  await nextTick()
  assert.ok(serialize(modalsRoot).includes('Карточка')) // модалка в #modals

  const titleInput = findEl(modalsRoot, (n) => n.tag === 'input' && n.props.value === 'Сверстать шапку')
  assert.ok(titleInput, 'поле заголовка предзаполнено значением карточки')
  titleInput.events.input({ target: { value: 'Шапка готова' } }) // v-model → черновик
  await nextTick()

  button(modalsRoot, 'Сохранить').events.click() // коммит в стор
  await nextTick()
  assert.ok(serialize(root).includes('Шапка готова')) // доска обновилась
  assert.equal(serialize(modalsRoot), '') // модалка закрылась
  assert.ok(board.byId(1).title === 'Шапка готова')
})

test('приложение: чекбокс v-model отмечает выполнение', async () => {
  const { root, modalsRoot, board } = await mountApp()
  cardEl(root, 'Ревью PR').events.click()
  await nextTick()
  const checkbox = findEl(modalsRoot, (n) => n.tag === 'input' && n.props.type === 'checkbox')
  checkbox.events.change({ target: { checked: true } }) // v-model на чекбоксе
  await nextTick()
  button(modalsRoot, 'Сохранить').events.click()
  await nextTick()
  assert.equal(board.byId(3).done, true)
})

test('приложение: архив и восстановление + навигация роутера', async () => {
  const { root, modalsRoot, board, router } = await mountApp()

  cardEl(root, 'Написать тесты').events.click()
  await nextTick()
  button(modalsRoot, 'В архив').events.click()
  await nextTick()
  assert.equal(board.count, 3) // активных стало меньше

  router.push('/archive') // переход на страницу архива
  await nextTick()
  const archiveHtml = serialize(root)
  assert.ok(archiveHtml.includes('Архив'))
  assert.ok(archiveHtml.includes('Написать тесты'))

  button(root, 'Восстановить').events.click()
  await nextTick()
  assert.equal(board.count, 4) // вернулась в активные
})

test('приложение: KeepAlive-вкладки + асинхронная StatsPanel', async () => {
  const { root } = await mountApp()

  // Задаём поиск на доске.
  byPlaceholder(root, 'Поиск').events.input({ target: { value: 'ревью' } })
  await nextTick()

  // Переключаемся на вкладку «Статистика» (асинхронный компонент).
  button(root, 'Статистика').events.click()
  // Ждём, пока асинхронная StatsPanel загрузится и отрисуется.
  const loaded = await waitFor(() => serialize(root).includes('Готово:'))
  assert.ok(loaded, 'StatsPanel загрузилась')
  assert.ok(serialize(root).includes('Готово:')) // содержимое StatsPanel

  // Возвращаемся на «Доску» — состояние поиска должно сохраниться (KeepAlive).
  button(root, 'Доска').events.click()
  await nextTick()
  const search = byPlaceholder(root, 'Поиск')
  assert.equal(search.props.value, 'ревью', 'KeepAlive сохранил введённый поиск')
})

test('приложение: серверный рендер (SSR) всей страницы', () => {
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  const app = createSSRApp(App)
  app.use(pinia)
  app.use(router)
  app.directive('focus', focus)
  app.directive('click-outside', clickOutside)

  const html = app.renderToString()
  assert.ok(html.includes('MiniTrello'))
  assert.ok(html.includes('Сверстать шапку'))
  assert.ok(html.includes('Надо'))
  assert.ok(!html.includes('onClick')) // обработчики в SSR не сериализуются
})
