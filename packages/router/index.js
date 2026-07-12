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

// ---------------------------------------------------------------------------
//  Matcher: turn a route path string into a test that also extracts params.
//  '/user/:id' → regex /^\/user\/([^/]+)$/ and a list of param names ['id'].
// ---------------------------------------------------------------------------
function compileRoute(record) {
  const keys = []
  // Replace each :param with a capture group, remembering the param name.
  const pattern = record.path
    .replace(/\//g, '\\/')
    .replace(/:(\w+)/g, (_, name) => {
      keys.push(name)
      return '([^/]+)'
    })
  return { ...record, regex: new RegExp('^' + pattern + '$'), keys }
}

/**
 * Create a router instance.
 * @param {{ history: object, routes: Array<{ path: string, component: object }> }} options
 *   `history` is a history implementation (see history.js); `routes` is the
 *   route table matched against the current URL.
 * @returns {object} the router (currentRoute, push, replace, beforeEach, resolve, install).
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
    params: {},
    matched: [], // list of matching records (nested routes would yield >1)
  })

  // Find the route record for a path and pull out its params.
  function resolve(path) {
    // Strip query/hash — simplified, we match on the path only.
    const cleanPath = path.split('?')[0].split('#')[0] || '/'
    for (const record of records) {
      const match = record.regex.exec(cleanPath)
      if (match) {
        const params = {}
        record.keys.forEach((key, i) => (params[key] = decodeURIComponent(match[i + 1])))
        return { path: cleanPath, params, matched: [record] }
      }
    }
    // Nothing matched — an empty route (RouterView renders nothing).
    return { path: cleanPath, params: {}, matched: [] }
  }

  // Write the resolved route into the reactive object — this is what triggers a re-render.
  function applyRoute(path) {
    const r = resolve(path)
    currentRoute.path = r.path
    currentRoute.params = r.params
    currentRoute.matched = r.matched
  }

  // Main navigation: run the guards, then change the URL in history.
  function navigate(to, replace) {
    const targetPath = typeof to === 'string' ? to : to.path
    const toRoute = resolve(targetPath)
    const from = currentRoute

    // Navigation guards: may cancel (false) or redirect (a string).
    for (const guard of guards) {
      const result = guard(toRoute, from)
      if (result === false) return // navigation cancelled
      if (typeof result === 'string') return navigate(result, replace) // redirect
    }

    history[replace ? 'replace' : 'push'](targetPath)
    // history.listen (see below) will call applyRoute — no need to duplicate it here.
  }

  const router = {
    currentRoute,
    push: (to) => navigate(to, false),
    replace: (to) => navigate(to, true),
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
    },
  }

  // Listen for URL changes (including browser buttons) and apply the route.
  history.listen(applyRoute)
  // Initialize with the current URL.
  applyRoute(history.location)

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
 * @param {{ to: string }} props - the target path to navigate to on click.
 */
const RouterLink = {
  name: 'RouterLink',
  props: ['to'],
  setup(props, { slots }) {
    const router = inject(ROUTER_KEY)
    return () =>
      h(
        'a',
        {
          href: props.to,
          onClick: (e) => {
            // Cancel the browser's default navigation and navigate ourselves.
            if (e && e.preventDefault) e.preventDefault()
            router.push(props.to)
          },
        },
        slots.default ? slots.default() : [],
      )
  },
}

export { RouterView, RouterLink }
export {
  createWebHistory,
  createWebHashHistory,
  createMemoryHistory,
} from './history.js'
