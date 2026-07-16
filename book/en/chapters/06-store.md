# The Store

A component's state lives inside it, and that's correct: a button's counter
shouldn't leak outside. But part of the state is shared across the whole
application — the cart, the current user, the color theme. Threading it through
props and events across the entire component tree is tedious and fragile. The
store is a separate reactive storage that any component talks to directly. Our
store is a scaled-down copy of Pinia.

Chapter code: `packages/store/`. Tests — `test/store.test.mjs`, demo —
`playground/06-store.html`.

## The store is reactivity again

The core idea: the store has no new mechanism. Its state is `reactive`/`ref`
from layer 1, its computed fields are `computed`, its actions are plain
functions that mutate state. A component that reads the store in `render`
subscribes to it exactly as it does to its own `ref`. When the store changes,
every component that read it re-renders, wherever in the tree it sits. The store
just gives this shared reactive state a name and convenient access.

## createPinia: the store container

`createPinia()` creates a container that plugs into the application as a plugin
(`app.use(createPinia())`). Inside it holds a map of ready stores, shared
reactive state, and a list of plugins:

```js
export function createPinia() {
  const pinia = {
    _stores: new Map(), // id → ready store (created once, lazily)
    _plugins: [], // extensions (see use below)
    state: reactive({}), // shared state: state[id] = state of store id

    use(plugin) {
      pinia._plugins.push(plugin)
      return pinia
    },

    install(app) {
      setActivePinia(pinia)
      app.provide(PINIA_KEY, pinia)
      app.config.globalProperties.$pinia = pinia
    },
  }
  return pinia
}
```

`install` records the container as the "active" one and hands it out through
`provide` — so any component can reach it.

## defineStore: two styles

`defineStore(id, ...)` declares a store. As in Vue, two styles are supported —
Options and Setup — and both collapse to the same thing inside.

**Options** — familiar and declarative:

```js
const useCounter = defineStore('counter', {
  state: () => ({ count: 0 }),
  getters: { double: (s) => s.count * 2 },
  actions: { inc() { this.count++ } },
})
```

**Setup** — flexible, built on the Composition API:

```js
const useCart = defineStore('cart', () => {
  const items = ref([])
  const total = computed(() => items.value.reduce((s, p) => s + p.price, 0))
  const add = (p) => (items.value = [...items.value, p])
  return { items, total, add }
})
```

`defineStore` returns not the store itself but a `useStore()` function. On the
first call it creates the store; on later calls it hands back the same instance.
The store is a singleton per application:

```js
function useStore() {
  const pinia = getActivePinia()
  // …
  if (!pinia._stores.has(id)) {
    createStore(id, setupOrOptions, pinia)
  }
  return pinia._stores.get(id)
}
```

The "store is a singleton" test checks this: two calls to `useCounter()` return
the same object, and a change through one is visible in the other.

## One creation path

To avoid writing the logic twice, we turn an options store into a setup function
(`optionsToSetup`) — and from there both styles follow the same road:

```js
function setup() {
  const state = reactive(options.state ? options.state() : {})
  pinia.state[id] = state
  const parts = {}
  for (const key in state) parts[key] = toRef(state, key)          // state → refs
  for (const name in options.getters) parts[name] = computed(...)  // getters → computed
  for (const name in options.actions) parts[name] = (...a) => ...  // actions → functions
  return parts
}
```

The result is a `parts` object of refs, computeds, and functions. All that's
left is to make it ergonomic.

## proxyRefs: why store.count, not store.count.value

`parts` holds refs, which means from the outside you'd have to write
`store.count.value`. Ugly. `proxyRefs` from layer 1 saves us — it wraps the
object so that on read a ref unwraps automatically, and on write the value goes
into `.value`:

```js
store = proxyRefs(parts)
```

Now `store.count` returns a number, `store.count = 5` writes to state, and
`store.inc()` calls the function. `proxyRefs` leaves functions alone — they pass
through as is. One line turns a bag of refs into an ergonomic store.

Inside options actions `this` points at the store, so `this.count++` reads and
writes state through the same `proxyRefs`, staying reactive. The "effect catches
changes" test confirms it: a subscription to `store.count` fires on every
`inc()`.

## storeToRefs: destructuring without losing reactivity

It's tempting to write `const { count, double } = store`, but that loses
reactivity — `count` becomes a plain number at the moment of destructuring. For
state and getters there's `storeToRefs`: it hands them back as refs that keep
their link to the store. Actions you take straight from the store (they're safe
to destructure — they're functions):

```js
const { count, double } = storeToRefs(store) // reactive refs
const { inc } = store                         // actions — as is
```

This works through `toRef(store, key)` from layer 1: the resulting ref reads and
writes `store[key]`, which means it stays part of the reactive system.

## Plugins

`pinia.use(plugin)` adds an extension that runs when each store is created and
receives `{ store, pinia, id }`. Whatever the plugin returns is mixed into the
store. That's how cross-cutting features are built: persisting a store to
`localStorage`, logging actions, adding shared fields. For us it's a few lines in
`createStore`.

## What we simplified

Real Pinia does more: `$onAction` to intercept actions, hot module replacement
during development, devtools integration, and type safety through TypeScript.
The service methods, though, are all here: `$patch` applies a batched change (an
object or a function), `$subscribe` fires one batched callback per change with
mutation info (`{ type, storeId }`), `$state` of an options store can be read
and even assigned — the assignment patches into the existing reactive object
instead of replacing it, and `$reset` restores an options store to its initial
state (a setup store throws, exactly like Pinia). We took the essence — reactive singleton state,
getters on `computed`, actions, both declaration styles, `storeToRefs`, and
plugins. That's enough to grasp the idea and share state between any components.

## Check yourself

```bash
npm test        # among others — 7 store tests
npm run serve   # http://localhost:5173/playground/06-store.html
```

The tests cover both styles, reactivity of state and getters, singleton
behavior, `storeToRefs`, and the store working inside a component. The demo is a
mini-shop: the "header" and the "catalog" are two independent components, but
they share the cart through the store, without a single prop between them. One
last layer remains — SSR: we'll learn to render the application to HTML on the
server and "hydrate" it in the browser.
