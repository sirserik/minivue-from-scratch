// SSR tests: renderToString (server) and hydrate (the client "brings the server DOM to life").
import { test } from 'node:test'
import assert from 'node:assert/strict'

import '../packages/compiler/index.js' // for components with a template
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
test('renderToString: element with attributes and text', () => {
  const html = renderToString(h('div', { id: 'app', class: 'box' }, 'hello'))
  assert.equal(html, '<div id="app" class="box">hello</div>')
})

test('renderToString: events do not end up in the HTML', () => {
  const html = renderToString(h('button', { onClick: () => {}, type: 'button' }, 'click'))
  assert.equal(html, '<button type="button">click</button>')
})

test('renderToString: escaping against XSS', () => {
  const html = renderToString(h('p', '<script>alert(1)</script>'))
  assert.equal(html, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
})

test('renderToString: nested components', () => {
  const Child = { props: ['name'], template: '<span>Hello, {{ name }}</span>' }
  const App = {
    components: {},
    render() {
      return h('div', [h(Child, { name: 'world' })])
    },
  }
  assert.equal(renderToString(createVNode(App)), '<div><span>Hello, world</span></div>')
})

test('renderToString: void tags without a closing tag', () => {
  assert.equal(renderToString(h('input', { type: 'text', value: 'x' })), '<input type="text" value="x">')
})

test('createSSRApp: render an app to a string', () => {
  const App = { template: '<h1>Title</h1>' }
  const app = createSSRApp(App)
  assert.equal(app.renderToString(), '<h1>Title</h1>')
})

// --- hydration --------------------------------------------------------------
test('hydrate: adopts the DOM, attaches events, and updates', async () => {
  const App = {
    setup() {
      const count = ref(0)
      return { count, inc: () => count.value++ }
    },
    render(ctx) {
      return h('button', { onClick: ctx.inc, id: 'btn' }, 'Clicks: ' + ctx.count)
    },
  }

  // 1) Server: get the subtree and build a DOM from it WITHOUT handlers.
  const { subTree } = createSSRComponent(createVNode(App), null)
  const container = createRoot()
  buildServerDom(container, subTree, normalizeVNode)
  const serverButton = findByTag(container, 'button')
  assert.equal(serialize(container), '<button id="btn">Clicks: 0</button>')
  assert.equal(Object.keys(serverButton.events).length, 0, 'no events on the server')

  // 2) Client: hydrate a fresh app instance over this DOM.
  const renderer = createRenderer(shimOptions)
  renderer.__installComponents((internals) => createComponentSystem(internals))
  renderer.hydrate(createVNode(App), container)

  // The button is the same one (adopted, not recreated), but now has a handler.
  const clientButton = findByTag(container, 'button')
  assert.ok(Object.is(serverButton, clientButton), 'node adopted, not recreated')
  assert.ok(clientButton.events.click, 'handler attached during hydration')

  // 3) Click — client state changes, the DOM is patched in place.
  clientButton.events.click()
  await nextTick()
  assert.equal(serialize(container), '<button id="btn">Clicks: 1</button>')
})
