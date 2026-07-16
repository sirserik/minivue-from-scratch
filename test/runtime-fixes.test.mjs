// Regression tests for the runtime-core bug-fix pass: scheduler correctness,
// recursive unmount, fragment anchors, Teleport target changes, KeepAlive
// activation/teardown, fall-through attrs, emit casing, error handling, prop
// options, async component races and hydration of browser-merged text nodes.
// Each test names the bug it pins down — remove one of the fixes and the
// matching test here goes red.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compile } from '../packages/compiler/index.js'
import { createRenderer } from '../packages/runtime-core/renderer.js'
import {
  createComponentSystem,
  registerRuntimeCompiler,
  getCurrentInstance,
  defineComponent,
} from '../packages/runtime-core/component.js'
import { createAppAPI } from '../packages/runtime-core/apiCreateApp.js'
import { h, createVNode, Fragment, normalizeVNode } from '../packages/runtime-core/vnode.js'
import { Teleport, KeepAlive, defineAsyncComponent } from '../packages/runtime-core/builtins.js'
import {
  onMounted,
  onUpdated,
  onBeforeUnmount,
  onUnmounted,
  onActivated,
  onDeactivated,
  onErrorCaptured,
} from '../packages/runtime-core/apiLifecycle.js'
import { queueJob, nextTick } from '../packages/runtime-core/scheduler.js'
import { ref } from '../packages/reactivity/index.js'
import { testOptions, createRoot, serialize } from './helpers/testHost.mjs'
import * as shim from './helpers/domShim.mjs'

const renderer = createRenderer(testOptions)
renderer.__installComponents((internals) => createComponentSystem(internals))
const { render } = renderer
const createApp = createAppAPI(renderer.render)

const flush = () => new Promise((r) => setTimeout(r, 0))

// Capture console output for warning/error assertions without polluting the runner.
function captureConsole(method, fn) {
  const messages = []
  const original = console[method]
  console[method] = (...args) => messages.push(args.map(String).join(' '))
  try {
    fn()
  } finally {
    console[method] = original
  }
  return messages
}
async function captureConsoleAsync(method, fn) {
  const messages = []
  const original = console[method]
  console[method] = (...args) => messages.push(args.map(String).join(' '))
  try {
    await fn()
  } finally {
    console[method] = original
  }
  return messages
}

// --- C1: unmounted component must never render again -------------------------
test('C1: a queued update of an already-unmounted child does not run', async () => {
  const show = ref(true)
  const n = ref(0)
  const Child = {
    setup() {
      // The root type flips with n, so a zombie update would re-MOUNT fresh DOM.
      return () => (n.value % 2 ? h('span', 'child ' + n.value) : h('div', 'child ' + n.value))
    },
  }
  const Parent = {
    setup() {
      return () => h('div', { id: 'p' }, show.value ? [h(Child)] : [])
    },
  }
  const root = createRoot()
  render(createVNode(Parent), root)
  // Same tick: the child's dep changes AND the parent removes the child.
  n.value = 1
  show.value = false
  await nextTick()
  assert.equal(serialize(root), '<div id="p"></div>')
})

test('C1: full unmount stops the render effect (no zombie re-render)', async () => {
  const count = ref(100)
  let renders = 0
  const Comp = {
    render() {
      renders++
      return h('div', 'c' + count.value)
    },
  }
  const root = createRoot()
  render(createVNode(Comp), root)
  render(null, root)
  count.value++
  await nextTick()
  assert.equal(renders, 1)
  assert.equal(serialize(root), '')
})

test('C1/m6: async component resolving after unmount does not mount; loader is shared', async () => {
  let loads = 0
  let resolveLoader
  const Async = defineAsyncComponent(() => {
    loads++
    return new Promise((r) => (resolveLoader = r))
  })

  // Two instances → one loader call (m6).
  const root = createRoot()
  render(h('div', [h(Async), h(Async)]), root)
  assert.equal(loads, 1)

  // Unmount before the "chunk" arrives → the late resolve must not mount (C1).
  render(null, root)
  resolveLoader({ render: () => h('div', 'LATE CHUNK') })
  await flush()
  await nextTick()
  assert.equal(serialize(root), '')
})

// --- C2: unmount recurses into element children ------------------------------
test('C2: components nested under plain elements fire unmount hooks', () => {
  const called = []
  const Inner = {
    setup() {
      onBeforeUnmount(() => called.push('bum'))
      onUnmounted(() => called.push('um'))
      return () => h('p', 'inner')
    },
  }
  const root = createRoot()
  render(createVNode({ render: () => h('div', [h('section', [h(Inner)])]) }), root)
  render(null, root)
  assert.deepEqual(called, ['bum', 'um'])
})

test('C2: a Teleport nested under elements cleans its target on ancestor unmount', () => {
  const root = createRoot()
  const target = createRoot()
  render(h('div', [h('section', [h(Teleport, { to: target }, [h('p', 'modal')])])]), root)
  assert.equal(serialize(target), '<p>modal</p>')
  render(null, root)
  assert.equal(serialize(root), '')
  assert.equal(serialize(target), '')
})

// --- C3 + m3: scheduler re-queue and mid-flush ordering -----------------------
test('C3: a job that re-queues itself while running runs again in the same tick', async () => {
  let runs = 0
  const job = () => {
    runs++
    if (runs === 1) queueJob(job)
  }
  job.id = 1
  queueJob(job)
  await nextTick()
  assert.equal(runs, 2)
})

test('C3: state corrected inside onUpdated reaches the DOM', async () => {
  const count = ref(0)
  const Comp = {
    setup() {
      onUpdated(() => {
        if (count.value === 1) count.value = 2 // one-shot correction
      })
      return () => h('div', 'count: ' + count.value)
    },
  }
  const root = createRoot()
  render(createVNode(Comp), root)
  count.value = 1
  await nextTick()
  await nextTick()
  assert.equal(serialize(root), '<div>count: 2</div>')
  assert.equal(count.value, 2)
})

test('m3: a job queued mid-flush is inserted by id, keeping parent-before-child order', async () => {
  const order = []
  const a = () => {
    order.push('a')
    queueJob(b) // b (id 2) arrives while a (id 1) runs; c (id 3) is already queued
  }
  a.id = 1
  const b = () => order.push('b')
  b.id = 2
  const c = () => order.push('c')
  c.id = 3
  queueJob(a)
  queueJob(c)
  await nextTick()
  assert.deepEqual(order, ['a', 'b', 'c'])
})

// --- M7 + A1: errors don't kill the flush and route to handlers --------------
test('M7: a throwing job does not cancel other pending jobs, nextTick resolves', async () => {
  let goodRan = 0
  const bad = () => {
    throw new Error('boom')
  }
  bad.id = 1
  const good = () => goodRan++
  good.id = 2
  const errors = await captureConsoleAsync('error', async () => {
    queueJob(bad)
    queueJob(good)
    await nextTick() // must NOT reject
  })
  assert.equal(goodRan, 1)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /boom/)
})

test('A1: app.config.errorHandler receives errors thrown in render', async () => {
  const bomb = ref(false)
  const seen = []
  const Bomb = {
    render() {
      if (bomb.value) throw new Error('render boom')
      return h('span', 'ok')
    },
  }
  const root = createRoot()
  const app = createApp({ render: () => h('div', [h(Bomb)]) })
  app.config.errorHandler = (err, instance, info) => seen.push(`${info}: ${err.message}`)
  app.mount(root)

  const errors = await captureConsoleAsync('error', async () => {
    bomb.value = true
    await nextTick()
  })
  assert.deepEqual(seen, ['render function: render boom'])
  assert.equal(errors.length, 0) // claimed by the handler → no console.error

  // The app recovers: the next update renders normally.
  bomb.value = false
  await nextTick()
  assert.equal(serialize(root), '<div><span>ok</span></div>')
})

test('A1: onErrorCaptured sees a descendant error; returning false stops propagation', async () => {
  const captured = []
  const appErrors = []
  const Bomb = {
    setup() {
      throw new Error('setup boom')
    },
    render: () => null,
  }
  const Boundary = {
    setup(props, { slots }) {
      onErrorCaptured((err, instance, info) => {
        captured.push(`${info}: ${err.message}`)
        return false // handled — must not reach the app handler
      })
      return () => h('div', slots.default ? slots.default() : [])
    },
  }
  const root = createRoot()
  const app = createApp({ render: () => h(Boundary, null, { default: () => [h(Bomb)] }) })
  app.config.errorHandler = (err) => appErrors.push(err.message)
  captureConsole('warn', () => app.mount(root)) // Bomb warns about missing render state
  assert.deepEqual(captured, ['setup function: setup boom'])
  assert.deepEqual(appErrors, [])
})

// --- A2: setup() throw must not leak currentInstance --------------------------
test('A2: currentInstance is cleared even when setup throws', () => {
  const root = createRoot()
  captureConsole('error', () =>
    captureConsole('warn', () =>
      render(createVNode({ setup() { throw new Error('boom') } }), root),
    ),
  )
  assert.equal(getCurrentInstance(), null)
})

// --- M1: fragment anchors ------------------------------------------------------
test('M1: inserting a keyed sibling BEFORE a fragment lands before it', () => {
  const root = createRoot()
  const frag = () => h(Fragment, { key: 'f' }, [h('span', 'a'), h('span', 'b')])
  render(h('div', [frag()]), root)
  render(h('div', [h('i', { key: 'x' }, 'new'), frag()]), root)
  assert.equal(serialize(root), '<div><i>new</i><span>a</span><span>b</span></div>')
})

test('M1: moving a keyed fragment moves its whole node range', () => {
  const root = createRoot()
  const frag = () => h(Fragment, { key: 'f' }, [h('span', 'a'), h('span', 'b')])
  const d = () => h('p', { key: 'd' }, 'd')
  render(h('div', [frag(), d()]), root)
  render(h('div', [d(), frag()]), root)
  assert.equal(serialize(root), '<div><p>d</p><span>a</span><span>b</span></div>')
})

test('M1: a component with a fragment root moves correctly in a keyed list', async () => {
  const FragComp = { render: () => h(Fragment, null, [h('span', 'x'), h('span', 'y')]) }
  const order = ref(['c', 'd'])
  const App = {
    setup() {
      return () =>
        h(
          'div',
          order.value.map((k) => (k === 'c' ? h(FragComp, { key: 'c' }) : h('p', { key: 'd' }, 'd'))),
        )
    },
  }
  const root = createRoot()
  render(createVNode(App), root)
  assert.equal(serialize(root), '<div><span>x</span><span>y</span><p>d</p></div>')
  order.value = ['d', 'c']
  await nextTick()
  assert.equal(serialize(root), '<div><p>d</p><span>x</span><span>y</span></div>')
})

// --- m1: render returning an array -------------------------------------------
test('m1: a render function returning an array renders as a fragment', () => {
  const Multi = { render: () => [h('div', 'one'), h('div', 'two')] }
  const root = createRoot()
  render(createVNode(Multi), root)
  assert.equal(serialize(root), '<div>one</div><div>two</div>')
})

// --- M2: Teleport `to` changes -------------------------------------------------
test('M2: changing Teleport `to` moves the children to the new target', () => {
  const root = createRoot()
  const target1 = createRoot()
  const target2 = createRoot()
  render(h('div', [h(Teleport, { to: target1 }, [h('p', 'modal')])]), root)
  assert.equal(serialize(target1), '<p>modal</p>')
  render(h('div', [h(Teleport, { to: target2 }, [h('p', 'modal')])]), root)
  assert.equal(serialize(target1), '')
  assert.equal(serialize(target2), '<p>modal</p>')
})

test('M2/C2: a Teleport with an unresolvable target unmounts cleanly', () => {
  const root = createRoot()
  // testOptions has no querySelector → the string target resolves to null.
  render(h('div', [h(Teleport, { to: '#nope' }, [h('p', 'x')])]), root)
  render(null, root) // must not throw
  assert.equal(serialize(root), '')
})

// --- M3/M4: KeepAlive ----------------------------------------------------------
test('M3: reactivation patches the kept-alive component with its new props', async () => {
  const CompA = { props: ['msg'], render(ctx) { return h('div', 'A:' + ctx.msg) } }
  const CompB = { render: () => h('div', 'B') }
  const tab = ref('a')
  const msg = ref('one')
  const App = {
    setup() {
      return () =>
        h(KeepAlive, null, {
          default: () => [
            tab.value === 'a' ? h(CompA, { key: 'a', msg: msg.value }) : h(CompB, { key: 'b' }),
          ],
        })
    },
  }
  const root = createRoot()
  render(createVNode(App), root)
  assert.equal(serialize(root), '<div>A:one</div>')
  tab.value = 'b'
  await nextTick()
  msg.value = 'two' // prop changes while A sleeps
  tab.value = 'a'
  await nextTick()
  await nextTick()
  assert.equal(serialize(root), '<div>A:two</div>')
})

test('M4: onActivated/onDeactivated fire on stash/restore', async () => {
  const log = []
  const Inner = {
    setup() {
      onActivated(() => log.push('activated'))
      onDeactivated(() => log.push('deactivated'))
      return () => h('div', 'inner')
    },
  }
  const Other = { render: () => h('div', 'other') }
  const tab = ref('inner')
  const App = {
    setup() {
      return () =>
        h(KeepAlive, null, {
          default: () => [
            tab.value === 'inner' ? h(Inner, { key: 'i' }) : h(Other, { key: 'o' }),
          ],
        })
    },
  }
  const root = createRoot()
  render(createVNode(App), root)
  tab.value = 'other'
  await nextTick()
  assert.deepEqual(log, ['deactivated'])
  tab.value = 'inner'
  await nextTick()
  assert.deepEqual(log, ['deactivated', 'activated'])
})

test('M4: unmounting a tree with KeepAlive truly destroys the cached instances', async () => {
  const dep = ref(0)
  let unmounted = false
  let renders = 0
  const Inner = {
    setup() {
      onUnmounted(() => (unmounted = true))
      return () => {
        renders++
        return h('div', 'n=' + dep.value)
      }
    },
  }
  const App = { render: () => h(KeepAlive, null, { default: () => [h(Inner, { key: 'i' })] }) }
  const root = createRoot()
  render(createVNode(App), root)
  render(null, root)
  assert.equal(unmounted, true)
  dep.value++ // a leaked instance would re-render into the hidden storage
  await nextTick()
  assert.equal(renders, 1)
})

// --- M5: fall-through attrs ------------------------------------------------------
test('M5: class/id/onClick on a component land on its single element root', () => {
  const Button = { render: () => h('button', { class: 'btn' }, 'hi') }
  const root = createRoot()
  let clicked = 0
  render(
    createVNode({
      render: () => h(Button, { class: 'primary', id: 'b1', onClick: () => clicked++ }),
    }),
    root,
  )
  assert.equal(serialize(root), '<button class="btn primary" id="b1">hi</button>')
  // The stored handler must be the merged one.
  root.children[0].events.click()
  assert.equal(clicked, 1)
})

test('M5: inheritAttrs: false opts out of the fall-through', () => {
  const Plain = { inheritAttrs: false, render: () => h('button', 'hi') }
  const root = createRoot()
  render(createVNode({ render: () => h(Plain, { id: 'nope' }) }), root)
  assert.equal(serialize(root), '<button>hi</button>')
})

test('M5: a fall-through attr the parent stops passing is removed on update', async () => {
  const fancy = ref(true)
  const Button = { render: () => h('button', 'hi') }
  const App = {
    setup() {
      return () => h(Button, fancy.value ? { id: 'b1', class: 'primary' } : {})
    },
  }
  const root = createRoot()
  render(createVNode(App), root)
  assert.equal(serialize(root), '<button class="primary" id="b1">hi</button>')
  fancy.value = false
  await nextTick()
  assert.equal(serialize(root), '<button>hi</button>')
})

// --- M6: emit casing -------------------------------------------------------------
test('M6: emit("value-change") reaches an onValueChange listener', () => {
  let received = null
  const Child = {
    setup(props, { emit }) {
      return () => {
        emit('value-change', 42)
        return h('div')
      }
    },
  }
  const root = createRoot()
  render(
    createVNode({ render: () => h(Child, { onValueChange: (v) => (received = v) }) }),
    root,
  )
  assert.equal(received, 42)
})

// --- m4: silent ctx writes now warn ----------------------------------------------
test('m4: writing to a prop or an unknown key through ctx warns', () => {
  const Comp = {
    props: ['fixed'],
    render(ctx) {
      ctx.fixed = 'nope' // prop
      ctx.ghost = 1 // unknown
      return h('div')
    },
  }
  const warnings = captureConsole('warn', () => {
    render(createVNode(Comp, { fixed: 'yes' }), createRoot())
  })
  assert.ok(warnings.some((w) => w.includes('mutate prop "fixed"')))
  assert.ok(warnings.some((w) => w.includes('unknown property "ghost"')))
})

// --- A3: object props syntax -------------------------------------------------------
test('A3: default values apply (including factory defaults) when a prop is absent', () => {
  const Typed = {
    props: {
      count: { type: Number, default: 42 },
      list: { type: Array, default: () => ['a'] },
    },
    render(ctx) {
      return h('b', `count=${ctx.count};list=${ctx.list.join()}`)
    },
  }
  const root = createRoot()
  render(createVNode(Typed), root)
  assert.equal(serialize(root), '<b>count=42;list=a</b>')
})

test('A3: required and type violations warn (but never throw)', () => {
  const Typed = {
    props: { count: { type: Number, required: true } },
    render(ctx) {
      return h('b', 'count=' + ctx.count)
    },
  }
  const missing = captureConsole('warn', () => render(createVNode(Typed), createRoot()))
  assert.ok(missing.some((w) => w.includes('Missing required prop: "count"')))
  const mismatch = captureConsole('warn', () =>
    render(createVNode(Typed, { count: 'oops' }), createRoot()),
  )
  assert.ok(mismatch.some((w) => w.includes('type check failed for prop "count"')))
})

test('A3: array props syntax keeps working', () => {
  const Comp = { props: ['msg'], render(ctx) { return h('i', ctx.msg) } }
  const root = createRoot()
  render(createVNode(Comp, { msg: 'hello' }), root)
  assert.equal(serialize(root), '<i>hello</i>')
})

// --- A4: public API surface -------------------------------------------------------
test('A4: new exports are reachable from the full build (minivue.js)', async () => {
  const mv = await import('../packages/minivue.js')
  for (const name of [
    'defineComponent',
    'getCurrentInstance',
    'onErrorCaptured',
    'onActivated',
    'onDeactivated',
    'toRaw',
    'isReactive',
    'isProxy',
    'createRenderer',
  ]) {
    assert.equal(typeof mv[name], 'function', `${name} should be exported`)
  }
  // defineComponent is an identity function.
  const def = { render: () => null }
  assert.equal(defineComponent(def), def)
})

// --- A5: template compile cache ----------------------------------------------------
test('A5: a template compiles once per component definition, not per instance', () => {
  let compiles = 0
  registerRuntimeCompiler((template) => {
    compiles++
    return compile(template)
  })
  try {
    const Item = { template: '<li>item</li>' }
    const root = createRoot()
    render(h('ul', [h(Item), h(Item), h(Item)]), root)
    assert.equal(serialize(root), '<ul><li>item</li><li>item</li><li>item</li></ul>')
    assert.equal(compiles, 1)
  } finally {
    registerRuntimeCompiler(compile) // restore the real compiler
  }
})

// --- A6: hydration -----------------------------------------------------------------
const shimRenderer = createRenderer(shim.shimOptions)
shimRenderer.__installComponents((internals) => createComponentSystem(internals))

test('SSR1: hydrating a browser-merged text node splits it between text vnodes', async () => {
  // <button>Clicks: {{ count }}</button> — the server emits ONE text node.
  const App = {
    setup() {
      const count = ref(0)
      return { count, inc: () => count.value++ }
    },
    render(ctx) {
      return h('button', { onClick: ctx.inc }, ['Clicks: ', ctx.count])
    },
  }
  const container = shim.createRoot()
  // buildServerDom now merges adjacent text like a real HTML parser.
  shim.buildServerDom(container, h('button', null, ['Clicks: ', '0']), normalizeVNode)
  assert.equal(container.firstChild.childNodes.length, 1) // honest server DOM

  shimRenderer.hydrate(createVNode(App), container)
  assert.equal(shim.serialize(container), '<button>Clicks: 0</button>')

  shim.findByTag(container, 'button').events.click()
  await nextTick()
  assert.equal(shim.serialize(container), '<button>Clicks: 1</button>')
})

test('SSR2: a tag mismatch warns and falls back to client-side rendering', () => {
  const container = shim.createRoot()
  shim.buildServerDom(container, h('div', 'server'), normalizeVNode)
  const warnings = captureConsole('warn', () => {
    shimRenderer.hydrate(h('span', 'client'), container)
  })
  assert.ok(warnings.some((w) => w.includes('Hydration mismatch')))
  assert.equal(shim.serialize(container), '<span>client</span>')
})

test('SSR2: a text mismatch warns and keeps the client value', () => {
  const container = shim.createRoot()
  shim.buildServerDom(container, h('div', 'old text'), normalizeVNode)
  const warnings = captureConsole('warn', () => {
    shimRenderer.hydrate(h('div', ['new text']), container)
  })
  assert.ok(warnings.some((w) => w.includes('Hydration text mismatch')))
  assert.equal(shim.serialize(container), '<div>new text</div>')
})
