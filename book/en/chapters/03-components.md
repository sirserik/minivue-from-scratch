# Components

By now we have reactivity (layer 1) and the renderer (layer 2). In the layer 2 demo
we wired them together by hand with a single `effect`: it built an `h(...)` tree from
state and called `render`. That worked, but the block couldn't be reused — state,
markup, and the effect were floating free. A component packages exactly this bundle
into a self-contained, reusable unit.

Chapter code: `packages/runtime-core/component.js`, `scheduler.js`, `apiLifecycle.js`,
`apiInject.js`, `apiCreateApp.js`, `errorHandling.js`. Tests — `test/component.test.mjs`,
demo — `playground/03-components.html`.

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
last rendered tree (`subTree`), the `isMounted`/`isUnmounted` flags, the effect scope
(`scope`) that collects everything reactive the component creates, the `update`
function, and a reference to the parent.

## setup and the public context

`setupComponent` prepares the instance in three steps: it parses `props`, lays out
`slots`, and runs `setup`.

```js
let setupResult
try {
  setupResult = instance.scope.run(() => setup(instance.props, setupContext))
} catch (err) {
  handleError(err, instance, 'setup function') // user code may throw
} finally {
  setCurrentInstance(null) // always clear the current instance, even on a throw
}

if (typeof setupResult === 'function') {
  instance.render = setupResult          // setup returned the render function itself
} else if (setupResult && typeof setupResult === 'object') {
  instance.setupState = proxyRefs(setupResult) // the state object
}
```

Two details here. `setup` runs inside the instance's *effect scope*: every watcher
and computed created in it lands in `instance.scope`, and unmount will stop them
all with one call. And since `setup` is user code, a throw doesn't take the mount
down — `handleError` routes it up the `onErrorCaptured` chain to
`app.config.errorHandler` (see `errorHandling.js` and the lifecycle section below).

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
  if (instance.isUnmounted) return // a stale queued job must not touch a dead component
  // …
  if (!instance.isMounted) {
    const subTree = (instance.subTree = renderComponentRoot(instance))
    patch(null, subTree, container, anchor) // first time — mount
    instance.vnode.el = subTree.el
    instance.isMounted = true
    pendingPostHooks = instance.m // onMounted — fires later, see below
  } else {
    // …
    const nextTree = renderComponentRoot(instance)
    const prevTree = instance.subTree
    instance.subTree = nextTree
    patch(prevTree, nextTree, container, anchor) // after that — diff against the old tree
    instance.vnode.el = nextTree.el
    pendingPostHooks = instance.u // onUpdated
  }
}
const effect = instance.scope.run(
  () => new ReactiveEffect(componentUpdateFn, () => queueJob(instance.update)),
)
const update = (instance.update = () => {
  effect.run()
  // … the pending onMounted/onUpdated hooks fire here, outside the effect
})
update.id = instance.uid
update.i = instance
update() // first run = mount
```

When `componentUpdateFn` runs `render` for the first time, `render` reads reactive
state — and the effect subscribes to it (exactly as in layer 1). State changes — the
effect must re-run. But not immediately: its scheduler puts the component into a queue
via `queueJob`. Why a queue — that's the next section.

On the first run we mount the subtree (`patch(null, subTree, ...)`); on later runs we
compare the new tree against the old one (`patch(prevTree, nextTree, ...)`), and the
diff from layer 2 makes the minimal change. So reactivity answers "when to re-render,"
and the renderer answers "how to re-render cheaply."

Three details are worth pausing on. The `isUnmounted` guard is the last line of
defense: an update queued in the same tick the parent removed the component must not
touch the DOM. The effect is created inside `instance.scope`, so unmounting stops it
together with every watcher from `setup` in one call. And `onMounted`/`onUpdated`
fire *after* `effect.run()` returns — inside the effect, reactivity's self-trigger
guard would silently swallow any state change a hook makes, and a hook that mutates
state could never schedule its follow-up render. The `id` on the job lets the
scheduler keep parent-before-child order; `.i` tells it whose job this is, for error
routing.

## The scheduler: three changes — one re-render

If a handler changes three reactive values in a row, a naive effect would re-render the
component three times, even though the user only cares about the final result. That's
why component updates go through a queue (`scheduler.js`).

```js
export function queueJob(job) {
  // dedupe — but only against the part of the queue that hasn't run yet
  if (!queue.includes(job, isFlushing ? flushIndex + 1 : 0)) {
    if (!isFlushing) {
      queue.push(job)
    } else {
      // … a job arriving mid-flush is inserted by id right after the running one
    }
    queueFlush()
  }
}
function queueFlush() {
  if (!isFlushPending && !isFlushing) {
    isFlushPending = true
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}
```

`resolvedPromise.then(...)` defers processing the queue to a microtask — it runs as
soon as the current synchronous code finishes. By that point all changes have already
happened, and the component is in the queue once — so, one re-render. That's "batching."
The test "several changes in a row = one re-render" confirms it. `flushJobs` sorts the
queue by ascending job id (a parent has a smaller id than its child, so it updates
first and may remove the child before the child's turn) and runs each job in its own
try/catch: one component throwing in render doesn't cancel every other update in the
tick — the error goes to the `onErrorCaptured` chain from `errorHandling.js`.

`nextTick` comes from the same place. Since the DOM update is deferred, sometimes you
need to wait for it — for example, to measure the already-updated element. `await
nextTick()` returns control after the queue has been processed and the DOM is current.

### A gotcha: a job that re-queues itself

The first version deduplicated with a plain `queue.includes(job)`. Fair enough — until
a job re-queues *itself* mid-flush: `onUpdated` changes state, the effect triggers,
`queueJob` finds the currently running job still sitting in the array and silently
drops the follow-up update forever. That's why the dedupe now searches only the part
of the queue that hasn't run yet — `includes(job, flushIndex + 1)`: the running job
may re-enter, and a job arriving mid-flush is inserted in id order so parents still
update before children.

## props: data flowing top-down

The parent passes data to a component through its VNode's attributes: `h(Child, { label:
'hello' })`. The component declares which of those are its `props` — either with a list,
`props: ['label']`, or with an object of per-prop options: `props: { step: { type:
Number, default: 1, required: false } }` (a bare constructor, `step: Number`, is
shorthand for `{ type }`). Everything declared lands in `instance.props`; everything
else (for example, a `class` attached from outside) goes into `attrs`.

```js
for (const key in raw) {
  if (key === 'key') continue
  if (options.has(key)) props[key] = raw[key]  // a declared prop
  else attrs[key] = raw[key]                    // a "fallthrough" attribute
}
// Object-syntax extras: defaults for absent props, required/type warnings.
for (const [key, opt] of options) {
  if (key in props) {
    validatePropType(key, props[key], opt)
  } else {
    if (opt.required) console.warn(`[minivue] Missing required prop: "${key}"`)
    if ('default' in opt) props[key] = resolvePropDefault(opt)
  }
}
instance.props = reactive(props) // make props reactive
```

The object syntax is checked in dev style: a wrong type or a missing `required` prop
produces a `console.warn`, never a throw. An object or array `default` must be a
factory function (`resolvePropDefault` calls it) — otherwise every instance would
share one mutable object.

`props` are reactive, and that matters. When the parent re-renders and passes a new
value, `updateComponent` calls `updateProps`, which writes the new value into the
reactive `props`, and anyone who read that prop in `render`, computed, or watch reacts.
That's exactly what happens in the test "parent passes, child updates."

`attrs` don't just sit in the instance either. After every render,
`renderComponentRoot` merges them onto the component's single element root — `class`
and `style` combine, event handlers both fire, for the rest the outer value wins.
That's what makes `h(Button, { class: 'primary' })` work without `Button` declaring
`class`; a component opts out with `inheritAttrs: false`, and a fragment root gets
nothing (there's nowhere to put them).

## emit: events flowing bottom-up

The reverse direction. A component doesn't change someone else's data directly — it
"shouts up" about an event, and the parent decides what to do. The component calls
`emit('increment')`, and the parent listens for it as `onIncrement`.

```js
function emit(instance, event, ...args) {
  const props = instance.vnode.props || {}
  // exact name first, then the camelized form ('value-change' → onValueChange)
  const handler = props[toHandlerKey(event)] || props[toHandlerKey(camelize(event))]
  if (handler) callWithErrorHandling(handler, instance, `"${event}" event handler`, args)
}
```

`emit('ping', 42)` looks in the component's props for a function `onPing` and calls it
with `42`. So the child reports and the parent reacts — data flows down, events bubble
up. This is the basic contract for component communication. Two touches match real
Vue: a kebab-case event (`emit('value-change')`, the template style) is camelized so
it still finds `onValueChange`, and the handler runs through `callWithErrorHandling` —
a throw in the parent's handler is routed to the error chain instead of unwinding
through the child's render that called `emit`.

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

Beyond those, `onActivated`/`onDeactivated` fire when `KeepAlive` (layer 11) hides a
component instead of destroying it, and `onErrorCaptured` turns a component into an
error boundary: an error thrown in a descendant's `setup`, `render`, hooks, or event
handlers walks up the chain of `onErrorCaptured` hooks (returning `false` stops it),
then goes to `app.config.errorHandler`, then to `console.error` — the whole route
lives in `errorHandling.js`. Hooks are user code too, so `invokeHooks` wraps each in
`callWithErrorHandling`: one throwing `onMounted` won't abort the mount or the
sibling hooks after it.

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

## A gotcha: moving a keyed component needs its `el`

When a keyed list re-orders, the diff moves nodes by inserting `vnode.el` before an
anchor. A component's re-render is *queued*, so `updateComponent` must copy the DOM
node over synchronously — `n2.el = n1.el` — the moment it receives the new vnode.
Skip that one line and a reordered list of components (say, sorting a product grid)
throws `insertBefore ... is not of type Node`, because the moved vnode has no `el`
yet. Plain elements never hit this — their `el` is assigned during patch — which is
why the bug only surfaces once you build a keyed list of *components*.

## Check yourself

```bash
npm test        # among others — 10 component tests
npm run serve   # http://localhost:5173/playground/03-components.html
```

The demo is a todo list: the parent holds the state, the child `TodoItem` receives a
task through props and sends `toggle`/`remove` via emit, and the list of components uses
the keyed diff from layer 2. All of it without a single template — pure `render` and
`h`. Templates (`<div>{{ x }}</div>`) are the topic of the next layer: we'll write a
compiler that turns familiar markup into exactly these `h` calls.
