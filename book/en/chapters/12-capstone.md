# Store Deep-Dive and the Capstone App

The last layer rounds out the store's conveniences and brings everything we've built
together into one living app. There's almost no new deep machinery here — this is where
the picture gets completed.

Chapter code: additions in `packages/store/index.js`, the final app in
`playground/12-capstone.html`.

## $patch, $subscribe, $reset

Three utility methods on the store that you reach for constantly in real work.

**`$patch`** changes several fields at once — with an object or a function. An object is
handy for straight replacements, a function for computing from the current state:

```js
store.$patch({ count: 5, name: 'y' })      // merge an object
store.$patch((s) => { s.count++; s.done = true }) // mutate with a function
```

The implementation picks the target of the change: for an options store it's the
reactive state `pinia.state[id]`, for a setup store it's the store itself (a write
through `proxyRefs` lands in the `.value` of the right ref). One change, one path.

**`$subscribe`** runs a callback on any state change. It's a `watch` on top of our
reactivity:

```js
store.$subscribe(() => console.log('store changed'))
```

A subtlety a test exposed: for a setup store you can't watch both the state and the
getters at once. Otherwise a single change to `items` would fire twice — once from the
ref itself and once from the `computed` that depends on it. So we filter out the
computeds (they carry a `.effect`) and watch only the state fields. A small detail, but
it shows how the layers connect: the store subscription leans on how `computed` from
layer 1 is built.

**`$reset`** returns the state to its initial values. It works for options stores, where
the `state()` function that produces fresh values is known. A setup store has no initial
snapshot, so `$reset` honestly warns that it's unavailable.

## The final app

`playground/12-capstone.html` is a "Notes" app where everything runs at once:

- **Router** — three routes: the list `/`, editing `/note/:id` with a param, and an
  "About" page. Navigation through `RouterLink`, rendering through `RouterView`.
- **Store** — `useNotes` in setup style holds the notes; `storeToRefs` hands reactive
  refs to the component; `$subscribe` logs changes to the console.
- **Forms** — adding and editing through `v-model`, submitting on `@keyup.enter`.
- **Teleport** — the delete confirmation is moved into a modal above the page.
- **Components** — the list and the detail talk only through the store and the router,
  with no props passed between them.

Not a single third-party line: reactivity, rendering, template compilation, the router,
and the store — all ours, assembled over twelve layers. If this app works, the whole
framework works.

## Two more apps — and a bug the shop caught

The `examples/` folder holds two larger apps built entirely on this framework:

- **MiniTrello** (`examples/kanban/`) — a Kanban board: router, a persisted store,
  `v-model` forms, a Teleport modal, KeepAlive tabs, an async panel and custom
  directives. Running it end-to-end in a real browser is what first caught several
  renderer bugs.
- **MiniShop** (`examples/shop/`) — a storefront fed by a fake REST API: async loading
  with error states, a `/product/:id` page that refetches through `watchEffect`, a
  persisted cart in a Teleport drawer, plus live search, category filtering and sorting.

MiniShop earned its keep immediately. Its product grid is a **keyed list of components**
(`<ProductCard :key="id">`), and sorting it re-orders those components. That reordering
threw `insertBefore ... is not of type Node` — the exact gotcha from chapter 3. A
component's re-render is queued, so `updateComponent` has to carry its DOM node over
synchronously (`n2.el = n1.el`) for the keyed diff to move it. Our earlier apps only
re-ordered keyed *elements*, whose `el` is assigned during `patch`, so the bug stayed
hidden until a real product grid needed sorting. One more reminder that the surest way to
find the gaps in a framework is to build something real on it.

## What we covered

Twelve layers, each built on the ones before it:

1. **Reactivity** — `track`/`trigger`, `ref`, `reactive`, `computed`, `watch`.
2. **Virtual DOM** — `h`, the renderer, keyed diff via the longest increasing
   subsequence.
3. **Components** — `setup`, the reactive render effect, the scheduler, props/emit,
   slots, provide/inject, the lifecycle, `createApp`.
4. **Compiler** — from a template to a render function through `with(ctx)`.
5. **Router** — reactive route, history, params, guards.
6. **Store** — `defineStore`, getters on `computed`, actions, plugins.
7. **SSR** — `renderToString` and hydration by adopting the DOM.
8. **Forms** — `v-model`, class/style binding, event modifiers.
9. **Reactivity extensions** — `watchEffect`, `readonly`, `shallow*`, `markRaw`.
10. **Directives and dynamics** — custom directives, `<component :is>`, `v-model` on
    components.
11. **Built-in components** — `Teleport`, `KeepAlive`, async components.
12. **Store extensions** — `$patch`, `$subscribe`, `$reset` — and this app.

All of them grew from the single idea of chapter one: "the data changed, so whatever
depends on it updated itself." Reactivity turned out to be not one feature among many but
the foundation everything else stands on — rendering, components, the router, the store,
even SSR. That's the book's main takeaway: big systems rarely rest on many complex
mechanisms. More often it's one right idea, carried carefully into every corner.

## What's next

Real Vue differs from ours not in ideas but in finish: patch flags to speed up the diff,
static hoisting in the compiler, `Suspense` and streaming SSR, devtools, strict typing,
thousands of tested edge cases. All of it is engineering polish over exactly the
mechanisms you've now written yourself. Open Vue's source: you'll find familiar `track`,
`trigger`, `patchKeyedChildren`, `setupComponent` — just larger and more careful. You'll
read them now not as magic but as an extended version of your own code.

Thanks for going the whole way. You didn't learn Vue — you wrote it.

## Check yourself

```bash
npm test        # all 105 tests across twelve layers
npm run serve   # http://localhost:5173/playground/12-capstone.html
```

The "Notes" app is the final check: add a note, open it, edit it, delete it through the
modal, click through the routes. It all runs on a framework that twelve chapters ago was
an empty folder.
