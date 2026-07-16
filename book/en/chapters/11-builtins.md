# Built-in Components

Vue ships a few "system" components that don't behave like ordinary ones:
`Teleport` renders its children somewhere else on the page, `KeepAlive` keeps
inactive components alive, and `defineAsyncComponent` loads code on demand. They're
special — the renderer and the component system recognize them by markers and handle
them differently.

Chapter code: `packages/runtime-core/builtins.js` plus changes in `renderer.js` and
`component.js`. Tests — `test/builtins.test.mjs`, demo — `playground/11-builtins.html`.

## Teleport: render somewhere else

A modal logically belongs to the component that opened it, but physically it should
live at the end of `<body>` — otherwise a parent's `overflow: hidden` clips it or
someone else's `z-index` buries it. `Teleport` breaks that tie: in the markup the
children sit inside the component, but in the DOM they land in the target container.

```html
<Teleport to="#modals">
  <div class="modal">...</div>
</Teleport>
```

The component itself is just a marker — `{ __isTeleport: true }`. All the work happens
in the renderer, which, on seeing this marker, sends the children to the target
container instead of the current one:

```js
function processTeleport(n1, n2, container, anchor) {
  if (n1 == null) {
    n2.el = hostCreateText('')           // empty anchor at the original spot
    hostInsert(n2.el, container, anchor)
    const target = (n2.target = resolveTeleportTarget(n2.props))
    if (target && Array.isArray(n2.children)) mountChildren(n2.children, target, null)
  } else {
    n2.el = n1.el
    const prevTarget = n1.target
    const nextTarget = resolveTeleportTarget(n2.props)
    if (prevTarget) {
      n2.target = prevTarget
      patchChildren(n1, n2, prevTarget, null) // diff in the OLD target first
      if (nextTarget && nextTarget !== prevTarget) {
        n2.target = nextTarget
        for (const child of n2.children) move(child, nextTarget, null) // `to` changed
      }
    }
    // … target appeared only now → mount the children fresh
  }
}
```

An empty text anchor stays at the original spot so sibling nodes don't get thrown off,
while the content lives in the target container. The "children render in the target
container" test checks exactly this: the original spot is empty, all the content is in
the target. On update the children are diffed in the *old* target (its anchors are
stable), and only then, if `to` changed, carried over into the new container —
ignoring the freshly resolved target here was a real bug: the computed value used to
be thrown away and the children stayed put forever.

## KeepAlive: hide, don't destroy

Normally, switching a dynamic component destroys the old one along with all its state:
type text into a form, move to another tab, come back — the field is empty. `KeepAlive`
fixes that: an inactive component isn't destroyed, it's hidden, keeping its instance
and state.

```html
<KeepAlive><component :is="currentTab" /></KeepAlive>
```

The implementation is a combination of "markers on the vnode + special handling in the
component system." `KeepAlive` itself keeps a cache of "key → vnode with a live
instance" and sets the markers:

```js
if (cache.has(key)) {
  vnode.component = cache.get(key).component // reuse the live instance
  vnode.__keptAlive = true // the component system "reactivates" instead of remounting
}
cache.set(key, vnode) // always store the FRESH vnode — it carries the latest props
vnode.__shouldKeepAlive = true  // on leave — stash, don't destroy
vnode.__keepAliveOwner = instance
```

The component system (`component.js`) reacts to the markers in two places. On unmount,
instead of destroying the component, `unmountComponent` moves its DOM into off-screen
storage without touching the instance — and fires `onDeactivated`:

```js
if (vnode.__shouldKeepAlive && owner && !owner.__keepAliveTearingDown) {
  move(instance.subTree, keepAliveStorage(), null) // stashed away
  instance.isDeactivated = true
  invokeHooks(instance.da, instance, 'deactivated hook') // onDeactivated
  return
}
```

And when "mounting" a cached component, `activateComponent` doesn't create it anew —
it brings the stashed DOM back, then runs a normal update against the new vnode (its
props and slots may have changed while the component slept) and fires `onActivated`:

```js
function activateComponent(vnode, container, anchor) {
  const instance = vnode.component // set by KeepAlive's render from its cache
  move(instance.subTree, container, anchor)
  updateComponent(instance.vnode, vnode)
  vnode.el = instance.subTree.el
  instance.isDeactivated = false
  invokeHooks(instance.a, instance, 'activated hook') // onActivated
}
```

The instance stays alive the whole time, its reactive effect is never stopped — which
is why the state is right where you left it. The "state is preserved across switching"
test proves it: a counter incremented on tab A stays put after moving to B and back,
instead of resetting.

The `__keepAliveOwner` marker matters at the very end. When the `KeepAlive` itself is
unmounted for real, `unmountComponent` flags it as tearing down: its children are no
longer stashed, and everything still hiding in the cache gets a genuine unmount —
hooks fire, effects stop, the storage DOM is freed. Without an owner, "unmount" would
keep stashing forever and leak every cached component for the life of the page.

### A slots bug found along the way

`KeepAlive` exposed a subtle bug. Its `setup` returns `() => slots.default()`,
capturing `slots` in a closure. But our code, when updating a component, **reassigned**
`instance.slots` to a new object — and the closure kept seeing the old one. Because of
this, `KeepAlive` always showed the first tab. The fix: update the contents of the same
`slots` object instead of replacing the reference (`updateSlots` in `component.js`). A
good lesson: reference stability matters anywhere something gets captured in a closure.

## Async components

There's no reason to load a large app all at once — rarely used screens can be pulled
in later. `defineAsyncComponent` wraps a loader (usually a dynamic `import`) in a
component that shows "loading" while the code is on its way, then swaps in the real
component:

```js
const Chart = defineAsyncComponent(() => import('./Chart.js'))
```

The implementation is, again, just reactivity. The wrapper's `setup` kicks off the
loader and holds state `ref`s; when the promise resolves, a `ref` flips — and the
wrapper re-renders with the real component:

```js
setup() {
  const instance = getCurrentInstance()
  const loaded = ref(false)
  const error = ref(null)

  load() // one shared in-flight request for every instance of the wrapper
    .then(() => {
      if (!instance || !instance.isUnmounted) loaded.value = true
    })
    .catch((err) => {
      if (!instance || !instance.isUnmounted) error.value = err
    })

  return () => {
    if (loaded.value && resolvedComponent) return h(resolvedComponent)
    if (error.value) {
      return options.errorComponent ? h(options.errorComponent) : h('span', 'Loading failed')
    }
    return options.loadingComponent ? h(options.loadingComponent) : h('span', 'Loading…')
  }
}
```

No special machinery — reactivity switches the view on its own. Two guards are worth
noting: `load()` caches a single in-flight promise, so ten async components in a list
trigger one fetch, not ten (a failed load clears the slot to allow a retry); and the
`isUnmounted` checks keep a wrapper that was removed before the chunk arrived from
flipping state and mounting the late component into a container that's already gone.
The tests cover both outcomes: a successful load and an error (in which case
`errorComponent` is shown).

## What we simplified

We left out `Suspense` — the coordinator for several async dependencies with a shared
fallback and async `setup`. It hooks into deeper promise handling inside the render and
would deserve a whole chapter of its own; for teaching purposes `defineAsyncComponent`
is enough to show the essence of "loading → ready." Also, in real Vue `KeepAlive`
supports `include`/`exclude` and a cache limit (`max`), while `Teleport` has
`disabled`. We took the core of each — though the `activated`/`deactivated` hooks did
make it in: `onActivated`/`onDeactivated` fire exactly where the stash-and-restore
happens.

## Check yourself

```bash
npm test        # among others — 5 tests for the built-in components
npm run serve   # http://localhost:5173/playground/11-builtins.html
```

In the demo: a modal moves into `#modals` via `Teleport`, tabs under `KeepAlive`
retain the text you typed, and the async block appears after a delay. One last layer
remains — store extensions and the big final app, where everything comes together.
