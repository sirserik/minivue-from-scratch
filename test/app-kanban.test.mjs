// Integration tests for the MiniTrello app: we mount the WHOLE app on a fake
// host (router+store+compiler+components+Teleport+KeepAlive+async+directives)
// and play out real user scenarios. This is an end-to-end check of the entire
// framework against a real application.
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
// Preload the async module so that import() in defineAsyncComponent resolves
// quickly from cache (otherwise the first module load spans several ticks).
import '../examples/kanban/StatsPanel.js'

const flush = () => new Promise((r) => setTimeout(r, 0))
// Wait for a condition to hold (for async components).
async function waitFor(cond, tries = 20) {
  for (let i = 0; i < tries; i++) {
    if (cond()) return true
    await flush()
    await nextTick()
  }
  return cond()
}

// --- fake DOM traversal -----------------------------------------------------
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

// --- mount the whole app on the test host -----------------------------------
async function mountApp(start = '/') {
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory(start), routes })
  const context = createAppContext()
  const modalsRoot = createRoot()

  // A mini app so plugins (store, router) and directives install into the context.
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

  // Renderer with querySelector so Teleport to="#modals" finds its target.
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
test('app: initial board render', async () => {
  const { root } = await mountApp()
  const html = serialize(root)
  assert.ok(html.includes('MiniTrello'))
  assert.ok(html.includes('To do') && html.includes('In progress') && html.includes('Done'))
  assert.ok(html.includes('Design the header')) // seed card
  assert.ok(html.includes('Active: 4')) // 4 cards, none archived
})

test('app: add a card via v-model + Enter', async () => {
  const { root, board } = await mountApp()
  const input = byPlaceholder(root, 'New card')
  input.events.input({ target: { value: 'Deploy to prod' } }) // v-model → draft
  input.events.keyup({ key: 'Enter' }) // @keyup.enter → add
  await nextTick()
  assert.ok(serialize(root).includes('Deploy to prod'))
  assert.equal(board.count, 5)
})

test('app: search filters the cards (computed)', async () => {
  const { root } = await mountApp()
  const search = byPlaceholder(root, 'Search')
  search.events.input({ target: { value: 'review' } })
  await nextTick()
  const html = serialize(root)
  assert.ok(html.includes('Review PR'))
  assert.ok(!html.includes('Design the header')) // filtered out
})

test('app: edit a card in a modal (Teleport + v-model)', async () => {
  const { root, modalsRoot, board } = await mountApp()

  cardEl(root, 'Design the header').events.click() // open the modal
  await nextTick()
  assert.ok(serialize(modalsRoot).includes('Card')) // modal in #modals

  const titleInput = findEl(modalsRoot, (n) => n.tag === 'input' && n.props.value === 'Design the header')
  assert.ok(titleInput, 'title field prefilled with the card value')
  titleInput.events.input({ target: { value: 'Header done' } }) // v-model → draft
  await nextTick()

  button(modalsRoot, 'Save').events.click() // commit to the store
  await nextTick()
  assert.ok(serialize(root).includes('Header done')) // board updated
  assert.equal(serialize(modalsRoot), '') // modal closed
  assert.ok(board.byId(1).title === 'Header done')
})

test('app: v-model checkbox marks completion', async () => {
  const { root, modalsRoot, board } = await mountApp()
  cardEl(root, 'Review PR').events.click()
  await nextTick()
  const checkbox = findEl(modalsRoot, (n) => n.tag === 'input' && n.props.type === 'checkbox')
  checkbox.events.change({ target: { checked: true } }) // v-model on the checkbox
  await nextTick()
  button(modalsRoot, 'Save').events.click()
  await nextTick()
  assert.equal(board.byId(3).done, true)
})

test('app: archive and restore + router navigation', async () => {
  const { root, modalsRoot, board, router } = await mountApp()

  cardEl(root, 'Write tests').events.click()
  await nextTick()
  button(modalsRoot, 'Archive').events.click()
  await nextTick()
  assert.equal(board.count, 3) // fewer active cards now

  router.push('/archive') // navigate to the archive page
  await nextTick()
  const archiveHtml = serialize(root)
  assert.ok(archiveHtml.includes('Archive'))
  assert.ok(archiveHtml.includes('Write tests'))

  button(root, 'Restore').events.click()
  await nextTick()
  assert.equal(board.count, 4) // back among the active ones
})

test('app: KeepAlive tabs + async StatsPanel', async () => {
  const { root } = await mountApp()

  // Set a search on the board.
  byPlaceholder(root, 'Search').events.input({ target: { value: 'review' } })
  await nextTick()

  // Switch to the "Stats" tab (an async component).
  button(root, 'Stats').events.click()
  // Wait for the async StatsPanel to load and render.
  const loaded = await waitFor(() => serialize(root).includes('Done:'))
  assert.ok(loaded, 'StatsPanel loaded')
  assert.ok(serialize(root).includes('Done:')) // StatsPanel content

  // Go back to "Board" — the search state must be preserved (KeepAlive).
  button(root, 'Board').events.click()
  await nextTick()
  const search = byPlaceholder(root, 'Search')
  assert.equal(search.props.value, 'review', 'KeepAlive preserved the entered search')
})

test('app: server-side render (SSR) of the whole page', () => {
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory('/'), routes })
  const app = createSSRApp(App)
  app.use(pinia)
  app.use(router)
  app.directive('focus', focus)
  app.directive('click-outside', clickOutside)

  const html = app.renderToString()
  assert.ok(html.includes('MiniTrello'))
  assert.ok(html.includes('Design the header'))
  assert.ok(html.includes('To do'))
  assert.ok(!html.includes('onClick')) // handlers aren't serialized in SSR
})
