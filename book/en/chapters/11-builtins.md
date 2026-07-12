# Built-in Components

Vue ships a few "system" components that don't behave like ordinary ones:
`Teleport` renders its children somewhere else on the page, `KeepAlive` keeps
inactive components alive, and `defineAsyncComponent` loads code on demand. They're
special — the renderer recognizes them by markers and handles them differently.

Chapter code: `packages/runtime-core/builtins.js` plus changes in `renderer.js`. Tests
— `test/builtins.test.mjs`, demo — `playground/11-builtins.html`.

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
  const target = resolveTeleportTarget(n2.props) // element or querySelector(to)
  if (n1 == null) {
    n2.el = hostCreateText('')          // empty anchor at the original spot
    hostInsert(n2.el, container, anchor)
    mountChildren(n2.children, target, null) // children go to target
  } else {
    patchChildren(n1, n2, n1.target, null)   // updates go to target too
  }
}
```

An empty text anchor stays at the original spot so sibling nodes don't get thrown off,
while the content lives in the target container. The "children render in the target
container" test checks exactly this: the original spot is empty, all the content is in
the target.

## KeepAlive: hide, don't destroy

Normally, switching a dynamic component destroys the old one along with all its state:
type text into a form, move to another tab, come back — the field is empty. `KeepAlive`
fixes that: an inactive component isn't destroyed, it's hidden, keeping its instance
and state.

```html
<KeepAlive><component :is="currentTab" /></KeepAlive>
```

The implementation is a combination of "markers on the vnode + special handling in the
renderer." `KeepAlive` itself keeps a cache of "key → vnode with a live instance" and
sets two markers:

```js
if (cache.has(key)) {
  vnode.component = cache.get(key).component // reuse the live instance
  vnode.__keptAlive = true                    // renderer will "revive", not mount
} else {
  cache.set(key, vnode)
}
vnode.__shouldKeepAlive = true                // on leave — hide, don't destroy
```

The renderer reacts to the markers in two places. On unmount, instead of removing the
component, it hides its DOM in off-DOM storage without touching the instance:

```js
if (vnode.__shouldKeepAlive) {
  hostInsert(vnode.component.subTree.el, keepAliveStorage()) // hidden away
  return
}
```

And when "mounting" a cached component, it doesn't create it anew — it brings the
hidden DOM back:

```js
if (n1 == null && n2.__keptAlive) {
  hostInsert(n2.component.subTree.el, container, anchor) // pulled from storage
  n2.el = n2.component.subTree.el
}
```

The instance stays alive the whole time, its reactive effect is never stopped — which
is why the state is right where you left it. The "state is preserved across switching"
test proves it: a counter incremented on tab A stays put after moving to B and back,
instead of resetting.

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
loader and holds a state `ref`; when the promise resolves, the `ref` flips — and the
wrapper re-renders with the real component:

```js
setup() {
  const loaded = ref(false)
  options.loader().then((mod) => {
    resolvedComponent = mod.default || mod
    loaded.value = true // flipping the ref → re-render the wrapper
  })
  return () =>
    loaded.value && resolvedComponent
      ? h(resolvedComponent)
      : h('span', 'Loading…')
}
```

No special machinery — reactivity switches the view on its own. The tests cover both
outcomes: a successful load and an error (in which case `errorComponent` is shown).

## What we simplified

We left out `Suspense` — the coordinator for several async dependencies with a shared
fallback and async `setup`. It hooks into deeper promise handling inside the render and
would deserve a whole chapter of its own; for teaching purposes `defineAsyncComponent`
is enough to show the essence of "loading → ready." Also, in real Vue `KeepAlive`
supports `include`/`exclude`, a cache limit (`max`), and the `activated`/`deactivated`
hooks, while `Teleport` has `disabled`. We took the core of each.

## Check yourself

```bash
npm test        # among others — 5 tests for the built-in components
npm run serve   # http://localhost:5173/playground/11-builtins.html
```

In the demo: a modal moves into `#modals` via `Teleport`, tabs under `KeepAlive`
retain the text you typed, and the async block appears after a delay. One last layer
remains — store extensions and the big final app, where everything comes together.
