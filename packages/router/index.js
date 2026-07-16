// ============================================================================
//  router — a Vue Router analog
// ----------------------------------------------------------------------------
//  A single-page application (SPA) does not reload the page on navigation.
//  Instead the router looks at the URL, finds the matching component, and
//  renders it in a dedicated place — <RouterView>. The URL changes, the
//  component changes, and the page never flashes. It all rests on our own
//  reactivity: the current route is a reactive object, and <RouterView> simply
//  reads it during render.
// ============================================================================

import { reactive, inject, h } from '../runtime-core/index.js'

// A redirect chain longer than this means the guards redirect to each other
// forever (e.g. an "always go to /login" guard that also fires ON /login).
// vue-router uses the same limit.
const MAX_REDIRECTS = 10

// Regex metacharacters ('.', '(', '+', …) must be escaped in static path
// segments — otherwise '/file.txt' matches '/fileXtxt' and '/a(b' is an
// invalid regex that throws at createRouter time.
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
//  Matcher: turn a route path string into a test that also extracts params.
//  '/user/:id' → regex /^\/user\/([^/]+)\/?$/ and a list of param names ['id'].
// ---------------------------------------------------------------------------
function compileRoute(record) {
  const keys = []
  // Specificity score: each static segment adds a point. When several routes
  // match the same URL ('/user/new' vs '/user/:id'), the more static — more
  // specific — one must win, regardless of declaration order.
  let score = 0
  const segments = record.path.split('/').filter(Boolean)
  const pattern = segments
    .map((segment) => {
      if (segment[0] === ':') {
        keys.push(segment.slice(1))
        return '/([^/]+)' // dynamic segment — capture anything up to the next '/'
      }
      score++
      return '/' + escapeRegExp(segment)
    })
    .join('')
  // '/?$' tolerates a trailing slash: '/about/' matches '/about' (non-strict
  // mode, like vue-router's default). The root path compiles to '^//?$'.
  const regex = new RegExp('^' + (pattern || '/') + '/?$')
  return { ...record, regex, keys, score }
}

// decodeURIComponent throws a URIError on malformed input ('100%'). A bad URL
// typed by the user must not crash the whole app — fall back to the raw value.
function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    console.warn(`[minivue-router] failed to decode "${value}", using it as-is`)
    return value
  }
}

// '?a=1&b=2' (without the '?') → { a: '1', b: '2' }. Repeated keys are
// last-wins for simplicity (vue-router collects them into an array).
function parseQuery(search) {
  const query = {}
  for (const pair of search.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = safeDecode(eq > -1 ? pair.slice(0, eq) : pair)
    query[key] = eq > -1 ? safeDecode(pair.slice(eq + 1)) : ''
  }
  return query
}

// { a: '1' } → 'a=1', the inverse of parseQuery.
function stringifyQuery(query) {
  return Object.keys(query || {})
    .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(query[key]))
    .join('&')
}

// Navigation targets come in two shapes: a string ('/search?q=vue') or an
// object ({ path: '/search', query: { q: 'vue' }, hash: '#top' }). Normalize
// both to a full URL string — the single format history and matching use.
function locationToFullPath(to) {
  if (typeof to === 'string') return to
  const search = stringifyQuery(to.query)
  let hash = to.hash || ''
  if (hash && hash[0] !== '#') hash = '#' + hash
  return (to.path || '/') + (search ? '?' + search : '') + hash
}

/**
 * Create a router instance.
 * @param {{ history: object, routes: Array<{ path: string, component: object }> }} options
 *   `history` is a history implementation (see history.js); `routes` is the
 *   route table matched against the current URL.
 * @returns {object} the router (currentRoute, push, replace, beforeEach, resolve, install, destroy).
 */
// ---------------------------------------------------------------------------
//  createRouter({ history, routes }) — assemble the router.
// ---------------------------------------------------------------------------
export function createRouter(options) {
  const { history } = options
  const records = options.routes.map(compileRoute)
  const guards = [] // beforeEach hooks

  // The current route is a reactive object. Components that read its fields
  // during render (e.g. <RouterView> reads matched) automatically re-render on
  // navigation.
  const currentRoute = reactive({
    path: '/',
    fullPath: '/',
    query: {},
    hash: '',
    params: {},
    matched: [], // list of matching records (nested routes would yield >1)
  })

  // Find the route record for a location and pull out its params/query/hash.
  function resolve(to) {
    const fullPath = locationToFullPath(to)
    // Split off the hash first ('#' ends the matchable part), then the query.
    const hashIndex = fullPath.indexOf('#')
    const hash = hashIndex > -1 ? fullPath.slice(hashIndex) : ''
    const beforeHash = hashIndex > -1 ? fullPath.slice(0, hashIndex) : fullPath
    const queryIndex = beforeHash.indexOf('?')
    const query = queryIndex > -1 ? parseQuery(beforeHash.slice(queryIndex + 1)) : {}
    const path = (queryIndex > -1 ? beforeHash.slice(0, queryIndex) : beforeHash) || '/'

    // Check every record and keep the most specific match — declaration order
    // must not let '/user/:id' shadow '/user/new'.
    let best = null
    for (const record of records) {
      const match = record.regex.exec(path)
      if (match && (!best || record.score > best.record.score)) {
        best = { record, match }
      }
    }
    if (best) {
      const params = {}
      best.record.keys.forEach((key, i) => (params[key] = safeDecode(best.match[i + 1])))
      return { path, fullPath, query, hash, params, matched: [best.record] }
    }
    // Nothing matched — an empty route (RouterView renders nothing).
    return { path, fullPath, query, hash, params: {}, matched: [] }
  }

  // Write the resolved route into the reactive object — this is what triggers a re-render.
  function applyRoute(route) {
    currentRoute.path = route.path
    currentRoute.fullPath = route.fullPath
    currentRoute.query = route.query
    currentRoute.hash = route.hash
    currentRoute.params = route.params
    currentRoute.matched = route.matched
  }

  // Every navigation gets an id; when an async guard finally resolves, we can
  // tell whether a newer navigation has started in the meantime (it wins).
  let navigationId = 0

  // Main navigation: run the guards, then change the URL in history.
  //
  //   mode: 'push' | 'replace' — user-initiated, we write the URL on success;
  //         'pop'              — the URL already changed (browser Back/Forward),
  //                              we only validate it and roll back on cancel;
  //         'init'             — validate the initial URL when the app installs.
  //
  // The function is async so guards may return Promises, but sync guards are
  // NOT awaited — a guard-free push still applies the route synchronously
  // (important back-compat: callers may read currentRoute right after push).
  async function navigate(to, mode, redirectDepth = 0, id = ++navigationId) {
    const toRoute = resolve(to)

    // Navigating to where we already are would only add duplicate history
    // entries ('init' is exempt: it re-validates the already-applied URL).
    if (mode !== 'init' && toRoute.fullPath === currentRoute.fullPath) return true

    // Navigation guards: may cancel (false) or redirect (a string).
    for (const guard of guards) {
      let result = guard(toRoute, currentRoute)
      if (result && typeof result.then === 'function') {
        result = await result
        // While we waited, a newer navigation started — abandon this one.
        if (id !== navigationId) return false
      }
      if (result === false) {
        // Cancelled. On Back/Forward the browser has already moved the URL,
        // so restore it to the route the app is actually showing.
        if (mode === 'pop') history.replace(currentRoute.fullPath)
        // A rejected initial URL: clear the match so RouterView renders
        // nothing rather than the page a guard just forbade.
        if (mode === 'init') applyRoute({ ...toRoute, params: {}, matched: [] })
        return false
      }
      if (typeof result === 'string') {
        // Redirect. Cap the chain: a guard that redirects unconditionally
        // would otherwise recurse forever (stack overflow).
        if (redirectDepth >= MAX_REDIRECTS) {
          console.warn(
            `[minivue-router] navigation aborted: more than ${MAX_REDIRECTS} redirects ` +
              `while going to "${toRoute.fullPath}" — check your beforeEach guards for loops`,
          )
          return false
        }
        // Redirecting to where this navigation is already going = "allow".
        if (resolve(result).fullPath === toRoute.fullPath) continue
        // A redirected pop/init must not add a history entry — use replace.
        const nextMode = mode === 'push' ? 'push' : 'replace'
        return navigate(result, nextMode, redirectDepth + 1, id)
      }
    }

    // Apply the route FIRST, then sync the URL: the history listener below
    // compares incoming paths against currentRoute.fullPath to tell our own
    // push echo apart from a real Back/Forward.
    applyRoute(toRoute)
    if (mode === 'push' || mode === 'replace') history[mode](toRoute.fullPath)
    return true
  }

  // Run once, on install: the initial URL must pass the guards too (vue-router
  // behavior — think an auth guard on a bookmarked private page). It cannot
  // happen inside createRouter, because beforeEach registrations come after.
  let initialNavigationValidated = false
  function validateInitialNavigation() {
    if (initialNavigationValidated) return
    initialNavigationValidated = true
    // No guards — the eagerly applied route (below) is already correct.
    if (guards.length > 0) navigate(history.location, 'init')
  }

  const router = {
    currentRoute,
    // push/replace return a Promise resolving to true (navigated) or false
    // (cancelled by a guard / superseded / too many redirects).
    push: (to) => navigate(to, 'push'),
    replace: (to) => navigate(to, 'replace'),
    // Register a global navigation guard.
    beforeEach: (guard) => guards.push(guard),
    resolve,

    // Plug into the app: app.use(router).
    install(app) {
      // Expose the router and route to every component via inject.
      app.provide(ROUTER_KEY, router)
      app.provide(ROUTE_KEY, currentRoute)
      // Register the built-in components (both PascalCase and kebab-case).
      app.component('RouterView', RouterView)
      app.component('router-view', RouterView)
      app.component('RouterLink', RouterLink)
      app.component('router-link', RouterLink)
      // Convenient $router / $route (as in Vue).
      app.config.globalProperties.$router = router
      app.config.globalProperties.$route = currentRoute
      // By install time the app has registered its guards — run the initial
      // navigation through them.
      validateInitialNavigation()
    },

    // Detach from history so an unmounted app leaves no listeners behind.
    // (Our minimal app has no unmount hook for plugins, so this is explicit.)
    destroy() {
      unlisten()
      if (typeof history.destroy === 'function') history.destroy()
    },
  }

  // Listen for URL changes. Only external changes (browser Back/Forward) get
  // here with a *new* path — our own push/replace apply the route before
  // touching history, so their echo is deduplicated inside navigate(). External
  // changes go through the same guard pipeline as push ('pop' mode).
  const unlisten = history.listen((path) => {
    navigate(path, 'pop')
  })
  // Initialize with the current URL eagerly, so currentRoute is usable even
  // before (or without) app.use(router). Guards re-validate it on install.
  applyRoute(resolve(history.location))

  return router
}

// Keys for provide/inject — Symbols, so they don't collide with user keys.
const ROUTER_KEY = Symbol('router')
const ROUTE_KEY = Symbol('route')

// Composables for use inside setup().
export function useRouter() {
  return inject(ROUTER_KEY)
}
export function useRoute() {
  return inject(ROUTE_KEY)
}

// ---------------------------------------------------------------------------
//  <RouterView> — the "slot" where the router mounts the current route's component.
// ---------------------------------------------------------------------------
/** Built-in component that renders the component of the currently matched route. */
const RouterView = {
  name: 'RouterView',
  setup() {
    const route = inject(ROUTE_KEY)
    // Return a render function: it reads route.matched reactively, so on
    // navigation RouterView re-renders itself with the new component.
    return () => {
      const matched = route.matched[0]
      return matched ? h(matched.component) : null
    }
  },
}

// ---------------------------------------------------------------------------
//  <RouterLink to="/path"> — a link that navigates without a reload.
// ---------------------------------------------------------------------------
/**
 * Built-in component that renders an `<a>` performing in-app navigation.
 * @param {{ to: string | { path: string, query?: object, hash?: string } }} props
 *   the target to navigate to on click (string or location object).
 */
const RouterLink = {
  name: 'RouterLink',
  props: ['to'],
  setup(props, { slots }) {
    const router = inject(ROUTER_KEY)
    const route = inject(ROUTE_KEY)
    return () => {
      // `to` may be an object — resolve it to a real URL for the href
      // (otherwise the anchor would render href="[object Object]").
      const target = router.resolve(props.to)
      // Active classes, as in vue-router: exact-active — the link points at
      // the current path; active — the current path lives "under" the link
      // ('/user' is active while you are on '/user/42'). The root link '/'
      // is a prefix of everything, so it only counts when exact.
      const isExactActive = route.path === target.path
      const isActive =
        isExactActive ||
        (target.path !== '/' &&
          route.path.startsWith(target.path.endsWith('/') ? target.path : target.path + '/'))
      const classes = []
      if (isActive) classes.push('router-link-active')
      if (isExactActive) classes.push('router-link-exact-active')
      return h(
        'a',
        {
          href: target.fullPath,
          class: classes.length ? classes.join(' ') : undefined,
          onClick: (e) => {
            // Cancel the browser's default navigation and navigate ourselves.
            if (e && e.preventDefault) e.preventDefault()
            router.push(props.to)
          },
        },
        slots.default ? slots.default() : [],
      )
    }
  },
}

export { RouterView, RouterLink }
export {
  createWebHistory,
  createWebHashHistory,
  createMemoryHistory,
} from './history.js'
