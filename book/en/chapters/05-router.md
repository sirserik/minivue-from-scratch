# The Router

A regular website asks the server for a fresh page on every navigation and
reloads it. A single-page application (SPA) doesn't work that way: it loads once,
then swaps its own content by looking at the URL in the browser's address bar.
The router handles that. Ours is a scaled-down copy of Vue Router, and it rests
entirely on the reactivity from layer 1.

Chapter code: `packages/router/`. Tests — `test/router.test.mjs`, demo —
`playground/05-router.html`.

## The idea: URL → component

The router solves one problem: pick which component to show based on the current
URL. `/` — the `Home` component, `/about` — `About`, `/user/42` — `User` with the
parameter `id = 42`. The chosen component is shown in a special place —
`<RouterView>`. `<RouterLink>` links change the URL without reloading the page.

The whole trick is that the "current route" is a reactive object. `<RouterView>`
reads it in its render function, so by the rules of layer 1 it subscribes to it.
The URL changes — the route changes — `<RouterView>` re-renders with the new
component. The router needs no special reactivity mechanism of its own; it reuses
ours.

## history: where the URL lives

The URL can be stored in different ways, depending on the environment. So the
mechanism is hidden behind a `history` object with a single interface: `location`
(the current path), `push` and `replace` (change it), `listen` (subscribe to
changes). There are three implementations:

- **`createWebHistory`** — normal URLs like `/about` via the History API
  (`pushState`). Clean, but the server must serve `index.html` for any path.
- **`createWebHashHistory`** — URLs with a hash, `/#/about`. The part after `#`
  never reaches the server, so it works on any static host with no configuration.
- **`createMemoryHistory`** — the URL lives in a plain variable, with no `window`.
  Needed for tests and for the server (layer 7), where there's no browser.

The router doesn't care which one is plugged in — it talks through the same
interface. Tests use `createMemoryHistory`, the demo uses `createWebHashHistory`.

## The matcher: parsing paths with parameters

The route `/user/:id` should match the URL `/user/42` and produce `id = 42`. To do
that, we turn the route's path into a regular expression, and the `:parameters`
into capture groups:

```js
function compileRoute(record) {
  const keys = []
  const pattern = record.path
    .replace(/\//g, '\\/')
    .replace(/:(\w+)/g, (_, name) => {
      keys.push(name)      // remember the parameter name
      return '([^/]+)'      // and replace :id with "any segment without a slash"
    })
  return { ...record, regex: new RegExp('^' + pattern + '$'), keys }
}
```

`resolve(path)` iterates over the routes, applies their regexes, and for the first
match collects `params` from the capture groups using the saved names. If nothing
matches, an empty route is returned, and `<RouterView>` shows nothing.

## The reactive current route

The heart of the router is the reactive object `currentRoute`:

```js
const currentRoute = reactive({ path: '/', params: {}, matched: [] })

function applyRoute(path) {
  const r = resolve(path)
  currentRoute.path = r.path
  currentRoute.params = r.params
  currentRoute.matched = r.matched  // the record(s) of the matching route
}
```

`applyRoute` writes the parse result into the reactive object — and that's the only
thing needed to update the UI. Everything that read `currentRoute` reacts. The
router subscribes to the history (`history.listen(applyRoute)`), so both our `push`
and the browser's back/forward buttons lead to the same thing — a re-render.

## Navigation and guards

`push` doesn't change the URL right away — first it runs the navigation hooks
(`beforeEach`). A hook receives where we're going and where we're coming from, and
it can allow the transition, cancel it (by returning `false`), or redirect (by
returning a different path):

```js
function navigate(to, replace) {
  const toRoute = resolve(typeof to === 'string' ? to : to.path)
  for (const guard of guards) {
    const result = guard(toRoute, currentRoute)
    if (result === false) return                    // cancel
    if (typeof result === 'string') return navigate(result, replace) // redirect
  }
  history[replace ? 'replace' : 'push'](toRoute.path) // and only now change the URL
}
```

This is how you protect pages: "don't let an unauthenticated user into `/admin`,
send them to `/login`". The tests cover both branches — cancellation and redirect.

## RouterView and RouterLink

`<RouterView>` is a component of a few lines. It injects the current route and in
render returns the component from `matched`:

```js
const RouterView = {
  setup() {
    const route = inject(ROUTE_KEY)
    return () => {
      const matched = route.matched[0]
      return matched ? h(matched.component) : null
    }
  },
}
```

The key point is `return () => ...`. We return a render function from `setup`, and
it reads `route.matched` on every call. So the component's effect is subscribed to
the route, and on navigation `<RouterView>` re-renders itself.

`<RouterLink>` renders an ordinary `<a>`, but it intercepts the click: it cancels
the browser's default navigation (`preventDefault`) and calls `router.push` — so
the URL changes without a reload.

## Wiring into the app

The router is a plugin. `app.use(router)` calls its `install`, where the router
hands itself and the route out through `provide`, registers `<RouterView>` /
`<RouterLink>` as global components, and puts `$router` / `$route` into the global
properties:

```js
install(app) {
  app.provide(ROUTER_KEY, router)
  app.provide(ROUTE_KEY, currentRoute)
  app.component('RouterView', RouterView)
  app.component('RouterLink', RouterLink)
  app.config.globalProperties.$router = router
  app.config.globalProperties.$route = currentRoute
}
```

For `<RouterView>` in a template to turn into a component rather than an unknown
HTML tag, the compiler (layer 4) got one extra ability: tags starting with an
uppercase letter or containing a hyphen are generated via `_c('RouterView')` —
resolving a component by name among the registered ones. Inside `setup`, the same
router and route are reached with the `useRouter()` and `useRoute()` hooks.

## What we simplified

The real Vue Router does far more: nested routes (several `<RouterView>` deep),
named routes and views, lazy-loaded components, async guards with `next()`, query
parameters and query-string parsing, scroll behavior, meta fields, and transition
animations. We took the skeleton — history, a matcher with parameters, a reactive
route, `RouterView`/`RouterLink`, `beforeEach` — which is enough to understand the
principle and build a working multi-page application.

## Check yourself

```bash
npm test        # among other things — 6 router tests
npm run serve   # http://localhost:5173/playground/05-router.html
```

The tests run navigation against the in-memory history: the starting route, `push`,
`:id` parameters, an empty route, and both kinds of guards. The demo is an app with
a menu of `RouterLink`s and a user page that reads `:id`. Next up — the store:
shared application state available to any component without passing it through
props.
