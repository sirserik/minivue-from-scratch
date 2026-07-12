# Components

By now we have reactivity (layer 1) and the renderer (layer 2). In the layer 2 demo
we wired them together by hand with a single `effect`: it built an `h(...)` tree from
state and called `render`. That worked, but the block couldn't be reused — state,
markup, and the effect were floating free. A component packages exactly this bundle
into a self-contained, reusable unit.

Chapter code: `packages/runtime-core/component.js`, `scheduler.js`, `apiLifecycle.js`,
`apiInject.js`, `apiCreateApp.js`. Tests — `test/component.test.mjs`, demo —
`playground/03-components.html`.

## What a component is

A component is a plain object with a description: where state comes from (`setup`) and
how markup is produced from it (`render`).

```js
const Counter = {
  props: ['start'],
  setup(props) {
    const count = ref(props.start)
    return { count, inc: () => count.value++ }
  },
  render(ctx) {
    return h('button', { onClick: ctx.inc }, 'Clicks: ' + ctx.count)
  },
}
```

`setup` runs once when the component is created and returns whatever the markup will
use. `render` is called every time the component needs to be drawn, and returns a
VNode tree. Between them sits `ctx`, through which the markup reaches state. Here's how
all of this comes alive.

## The instance: a component's private record

The same `Counter` can be placed on a page ten times, and each one has its own counter.
So every occurrence needs its own state. That state lives in an **instance** — an
object created for each appearance of the component (`createComponentInstance`). It
holds everything: parsed `props`, `slots`, the result of `setup` (`setupState`), the
last rendered tree (`subTree`), the `isMounted` flag, the `update` function, and a
reference to the parent.

## setup and the public context

`setupComponent` prepares the instance in three steps: it parses `props`, lays out
`slots`, and runs `setup`.

```js
const setupResult = setup(instance.props, setupContext)
if (typeof setupResult === 'function') {
  instance.render = setupResult          // setup returned the render function itself
} else if (setupResult && typeof setupResult === 'object') {
  instance.setupState = proxyRefs(setupResult) // the state object
}
```

Note `proxyRefs` from layer 1. It wraps the returned object so that `.value` on refs is
unwrapped automatically. That's why in `render` you write `ctx.count`, not
`ctx.count.value` — `proxyRefs` handles that.

What is `ctx`? It's `instance.ctx` — a Proxy over the instance with access rules
(`PublicInstanceHandlers`). When `render` reads `ctx.count`, the proxy looks for `count`
first in `setupState`, then in `props`, then among the internal `$`-properties
(`$emit`, `$slots`, `$attrs`). A single `ctx` is one access point to everything the
markup can see.

One more subtlety: while `setup` runs, we mark the instance as "current"
(`setCurrentInstance`). This lets `onMounted`, `provide`, and `inject` called inside
`setup` know which component they belong to — without passing the instance as an
argument.

## Tying into reactivity: render as an effect

Here's the heart of the chapter. How do you make a component re-render itself when
state changes? Wrap its rendering in a reactive effect from layer 1.

```js
const componentUpdateFn = () => {
  if (!instance.isMounted) {
    const subTree = (instance.subTree = renderComponentRoot(instance))
    patch(null, subTree, container, anchor) // first time — mount
    instance.isMounted = true
  } else {
    const nextTree = renderComponentRoot(instance)
    const prevTree = instance.subTree
    instance.subTree = nextTree
    patch(prevTree, nextTree, container, anchor) // after that — diff against the old tree
  }
}
const effect = new ReactiveEffect(componentUpdateFn, () => queueJob(instance.update))
instance.update = effect.run.bind(effect)
instance.update() // running it = mounting
```

When `componentUpdateFn` runs `render` for the first time, `render` reads reactive
state — and the effect subscribes to it (exactly as in layer 1). State changes — the
effect must re-run. But not immediately: its scheduler puts the component into a queue
via `queueJob`. Why a queue — that's the next section.

On the first run we mount the subtree (`patch(null, subTree, ...)`); on later runs we
compare the new tree against the old one (`patch(prevTree, nextTree, ...)`), and the
diff from layer 2 makes the minimal change. So reactivity answers "when to re-render,"
and the renderer answers "how to re-render cheaply."

## The scheduler: three changes — one re-render

If a handler changes three reactive values in a row, a naive effect would re-render the
component three times, even though the user only cares about the final result. That's
why component updates go through a queue (`scheduler.js`).

```js
export function queueJob(job) {
  if (!queue.includes(job)) {   // a component appears in the queue at most once
    queue.push(job)
    queueFlush()
  }
}
function queueFlush() {
  if (isFlushing) return
  isFlushing = true
  resolvedPromise.then(flushJobs) // process the queue at the end of the current tick
}
```

`resolvedPromise.then(...)` defers processing the queue to a microtask — it runs as
soon as the current synchronous code finishes. By that point all changes have already
happened, and the component is in the queue once — so, one re-render. That's "batching."
The test "several changes in a row = one re-render" confirms it.

`nextTick` comes from the same place. Since the DOM update is deferred, sometimes you
need to wait for it — for example, to measure the already-updated element. `await
nextTick()` returns control after the queue has been processed and the DOM is current.

## props: data flowing top-down

The parent passes data to a component through its VNode's attributes: `h(Child, { label:
'hello' })`. The component declares which of those are its `props` with a list, `props:
['label']`. Everything declared lands in `instance.props`; everything else (for example,
a `class` attached from outside) goes into `attrs`.

```js
for (const key in raw) {
  if (options.has(key)) props[key] = raw[key]  // a declared prop
  else attrs[key] = raw[key]                    // a "fallthrough" attribute
}
instance.props = reactive(props) // make props reactive
```

`props` are reactive, and that matters. When the parent re-renders and passes a new
value, `updateComponent` calls `updateProps`, which writes the new value into the
reactive `props`, and anyone who read that prop in `render`, computed, or watch reacts.
That's exactly what happens in the test "parent passes, child updates."

## emit: events flowing bottom-up

The reverse direction. A component doesn't change someone else's data directly — it
"shouts up" about an event, and the parent decides what to do. The component calls
`emit('increment')`, and the parent listens for it as `onIncrement`.

```js
function emit(instance, event, ...args) {
  const handlerName = 'on' + event[0].toUpperCase() + event.slice(1)
  const handler = instance.vnode.props[handlerName] // onIncrement
  if (handler) handler(...args)
}
```

`emit('ping', 42)` looks in the component's props for a function `onPing` and calls it
with `42`. So the child reports and the parent reacts — data flows down, events bubble
up. This is the basic contract for component communication.

## slots: markup from outside

Sometimes the parent wants to place its own markup inside a component — like content in
a card. These "holes" are called slots. A component's children are its slots:

```js
h(Card, [ h('span', 'inside the card') ]) // this is the default slot
```

`normalizeSlots` turns children into an object of functions: an array/string becomes the
`default` slot, an object `{ header, footer }` becomes named slots. The component renders
them via `ctx.$slots.default()`:

```js
const Card = {
  render(ctx) {
    return h('div', { class: 'card' }, ctx.$slots.default())
  },
}
```

A slot is a function (not a ready VNode) so that the content is computed at the right
moment of rendering, rather than once and for all.

## provide / inject: through the floors

Passing data through props is convenient between neighboring levels, but painful when
you need to thread it deep down through many intermediate components. `provide` and
`inject` bore a "tunnel": an ancestor puts down a value, and any descendant pulls it out
directly.

The trick is prototype-based inheritance. Each component's `provides` object inherits
the parent's `provides` (`Object.create`). So reading a key naturally walks up the chain
of ancestors until it finds a value. The test "provide/inject: the value reaches the
grandchild" checks this across two levels of nesting.

## Lifecycle

A component goes through stages: created → mounted → updating → unmounted. You can hang
your own code on each one with hooks `onMounted`, `onUpdated`, `onUnmounted`, and others.
A hook simply adds your function to a list on the current instance, and the renderer,
when it reaches the stage, calls the whole list. `onMounted` is handy for fetching data
from the server (the element is already on the page), `onUnmounted` — for cleanup (clear
a timer, unsubscribe).

## createApp: the entry point

All that's left is to assemble everything into an application.
`createApp(RootComponent).mount('#app')` wraps the root component in a VNode, attaches
the application context to it (for app-level `provide` and plugins), and calls `render`.
The `use` method registers plugins — this is exactly how the router and store will slot
in during later layers:

```js
createApp(App)
  .use(router)   // plugin: router.install(app)
  .use(pinia)
  .mount('#app')
```

## Check yourself

```bash
npm test        # among others — 9 component tests
npm run serve   # http://localhost:5173/playground/03-components.html
```

The demo is a todo list: the parent holds the state, the child `TodoItem` receives a
task through props and sends `toggle`/`remove` via emit, and the list of components uses
the keyed diff from layer 2. All of it without a single template — pure `render` and
`h`. Templates (`<div>{{ x }}</div>`) are the topic of the next layer: we'll write a
compiler that turns familiar markup into exactly these `h` calls.
