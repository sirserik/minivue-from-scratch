// ============================================================================
//  store — a Pinia-like store
// ----------------------------------------------------------------------------
//  A component's state lives inside it. But often you need state shared across
//  the whole app: the cart, the current user, the theme. Threading it through
//  props and events across the tree is painful. A store is a separate reactive
//  container that any component can access directly.
//
//  Like everything in MiniVue, the store is built on top of the reactivity of
//  layer 1. State is reactive/ref, getters are computed, actions are plain
//  functions that mutate state. There is no separate "store magic".
// ============================================================================

import { inject, getCurrentInstance } from '../runtime-core/index.js'
import { reactive, computed, watch, proxyRefs, toRef } from '../reactivity/index.js'

// Key for inject and the "active" Pinia container (in case it's used outside setup).
// ⚠ activePinia is a MODULE-LEVEL global — one per Node process. On a server
// that means it is shared by every request, so relying on it during SSR leaks
// one user's state into another user's HTML. That's why useStore() prefers
// inject() (per-app) and only falls back to this global outside components.
const PINIA_KEY = Symbol('pinia')
let activePinia = null
export function setActivePinia(pinia) {
  activePinia = pinia
}

/**
 * Create the Pinia container that holds all of the app's stores.
 * Installed as a plugin: `app.use(createPinia())`.
 *
 * SSR note: create a FRESH pinia for every request. Stores are cached per
 * pinia (see _stores below), so a module-level pinia reused across requests
 * would serve request A's mutated state to request B:
 *
 *   // per request:
 *   const pinia = createPinia()
 *   const app = createSSRApp(App).use(pinia)   // provides pinia to this app only
 *   const html = app.renderToString()
 *
 * @returns {object} The Pinia instance.
 */
export function createPinia() {
  const pinia = {
    _stores: new Map(), // id → ready store (created once, lazily)
    _plugins: [], // extensions (see use below)
    state: reactive({}), // shared state: state[id] = state of store id

    // Register a store plugin. The plugin receives { store, pinia, id } and can
    // add something to the store (logging, persistence, etc.).
    use(plugin) {
      pinia._plugins.push(plugin)
      return pinia
    },

    // Install into the app. app.provide is the isolation mechanism: every
    // component of THIS app can inject THIS pinia, no matter what other apps
    // (other SSR requests) are doing in the same process.
    install(app) {
      setActivePinia(pinia)
      app.provide(PINIA_KEY, pinia)
      app.config.globalProperties.$pinia = pinia
    },
  }
  return pinia
}

// Get the active container. Inside a component setup we resolve through
// inject — that walks the component's provides chain up to app.provide, so
// each app (each SSR request) sees its own pinia even when several coexist.
// Outside components (plain modules, tests) there is no chain to walk, so we
// fall back to the process-wide activePinia — fine on the client, hazardous
// on the server (see the note next to activePinia above).
function getActivePinia() {
  const fromInject = getCurrentInstance() ? inject(PINIA_KEY, null) : null
  return fromInject || activePinia
}

/**
 * Define a store. Two styles are supported:
 *
 *   1) Options — like the Vue Options API:
 *      defineStore('counter', {
 *        state: () => ({ count: 0 }),
 *        getters: { double: (s) => s.count * 2 },
 *        actions: { inc() { this.count++ } },
 *      })
 *
 *   2) Setup — like the Composition API:
 *      defineStore('counter', () => {
 *        const count = ref(0)
 *        const double = computed(() => count.value * 2)
 *        const inc = () => count.value++
 *        return { count, double, inc }
 *      })
 *
 * @param {string} id - Unique store id.
 * @param {Function|object} setupOrOptions - A setup function or an options object.
 * @returns {Function} A useStore() function that creates the store on first call
 *   and returns the same instance afterwards (a store is an app-wide singleton).
 */
export function defineStore(id, setupOrOptions) {
  function useStore() {
    const pinia = getActivePinia()
    if (!pinia) {
      throw new Error('Pinia is not installed: call app.use(createPinia())')
    }
    if (!pinia._stores.has(id)) {
      createStore(id, setupOrOptions, pinia)
    }
    return pinia._stores.get(id)
  }
  useStore.$id = id
  return useStore
}

// Create and register a store.
function createStore(id, setupOrOptions, pinia) {
  let store // reference to the final store — needed by getters/actions as `this`

  const isSetupStyle = typeof setupOrOptions === 'function'
  const setup = isSetupStyle
    ? setupOrOptions
    : optionsToSetup(id, setupOrOptions, pinia, () => store)

  // parts — an object of ref/computed/functions. proxyRefs unwraps .value,
  // so from the outside you write store.count, not store.count.value.
  const parts = setup()
  store = proxyRefs(parts)
  store.$id = id
  store._parts = parts // useful for storeToRefs

  // $state — direct access to the reactive state (for options stores).
  // Assignment is supported too: `store.$state = obj` behaves like $patch(obj).
  // We must patch INTO the existing reactive object, never swap it — swapping
  // would silently detach every effect subscribed to the old object.
  if (pinia.state[id]) {
    Object.defineProperty(store, '$state', {
      get: () => pinia.state[id],
      set: (newState) => store.$patch((s) => Object.assign(s, newState)),
    })
  }

  // Store utility methods: $patch / $subscribe / $reset.
  addStoreApi(store, id, pinia, isSetupStyle ? null : setupOrOptions)

  pinia._stores.set(id, store)

  // Run the store plugins: whatever they return is merged into the store.
  for (const plugin of pinia._plugins) {
    const extension = plugin({ store, pinia, id })
    if (extension) Object.assign(store, extension)
  }

  return store
}

// Attach the utility methods that start with $ (as in Pinia).
function addStoreApi(store, id, pinia, options) {
  const stateTarget = pinia.state[id] || store // options → reactive state, setup → the store itself

  // Label for the mutation-info object that $subscribe callbacks receive
  // (like Pinia): 'direct' for plain assignments, 'patch object'/'patch
  // function' while a $patch is being applied.
  let mutationType = 'direct'

  // $patch — batched change: an object (partial merge) or a function.
  //   store.$patch({ count: 5 })
  //   store.$patch((s) => { s.count++; s.done = true })
  store.$patch = (partialOrFn) => {
    mutationType = typeof partialOrFn === 'function' ? 'patch function' : 'patch object'
    if (typeof partialOrFn === 'function') partialOrFn(stateTarget)
    else Object.assign(stateTarget, partialOrFn)
    // The watch jobs these mutations queued flush on the next microtask (watch
    // batches with flush: 'pre'); this microtask is queued AFTER that flush,
    // so subscribers see the patch label, and later mutations report 'direct'.
    queueMicrotask(() => {
      mutationType = 'direct'
    })
  }

  // $subscribe — call the callback on any change to the store's state.
  // Built on the deep watch of layer 1, so it batches like Vue/Pinia: any
  // number of synchronous mutations (e.g. one $patch of three keys) collapse
  // into ONE callback on the next microtask — not one call per assignment.
  // The callback receives (mutation, state), where mutation = { type, storeId }.
  store.$subscribe = (callback) => {
    const notify = () => callback({ type: mutationType, storeId: id }, stateTarget)
    if (pinia.state[id]) {
      // Options store: watching a reactive object is deep by definition —
      // traverse subscribes to every nested property, array indices/length and
      // key additions, so arr.push() and brand-new keys are seen too.
      return watch(pinia.state[id], notify)
    }
    // Setup store: watch every STATE ref deeply ({ deep } makes traverse walk
    // inside ref values, so items.value.push(...) is seen). We exclude computed
    // (it has an .effect) — otherwise a single state change would fire the
    // callback twice: once from the ref, once from the computed built on it.
    const stateRefs = Object.keys(store._parts)
      .map((k) => store._parts[k])
      .filter((v) => v && v.__isRef && !v.effect)
    return watch(stateRefs, notify, { deep: true })
  }

  // $reset — restore the state to its initial value. Only an options store
  // knows its state() factory; for a setup store we throw like Pinia does
  // (a setup store can expose its own reset action if it wants one).
  store.$reset = () => {
    if (!options || !options.state) {
      throw new Error(
        `Store "${id}" is built using the setup syntax and does not implement $reset().`,
      )
    }
    store.$patch((s) => Object.assign(s, options.state()))
  }
}

// Turn an options description into a setup function — so there's one creation path.
function optionsToSetup(id, options, pinia, getStore) {
  return function setup() {
    // State is kept in the shared container pinia.state[id] — reactive.
    const state = reactive(options.state ? options.state() : {})
    pinia.state[id] = state

    const parts = {}
    // Expose each state field as a ref bound to the shared state.
    for (const key in state) {
      parts[key] = toRef(state, key)
    }
    // getters → computed. `this` and the first argument are the store itself.
    for (const name in options.getters || {}) {
      const getterFn = options.getters[name]
      parts[name] = computed(() => getterFn.call(getStore(), getStore()))
    }
    // actions → functions with this = the store.
    for (const name in options.actions || {}) {
      const actionFn = options.actions[name]
      parts[name] = function (...args) {
        return actionFn.apply(getStore(), args)
      }
    }
    return parts
  }
}

/**
 * Turn a store's fields back into refs so destructuring doesn't break reactivity:
 *   const { count, double } = storeToRefs(store)  // count.value stays reactive
 * Actions are taken straight from the store instead: const { inc } = store.
 * @param {object} store - The store instance.
 * @returns {Object<string, object>} A map of field name → ref.
 */
export function storeToRefs(store) {
  const refs = {}
  for (const key in store._parts) {
    const value = store._parts[key]
    // Skip functions (actions) — those are destructured directly from the store.
    if (typeof value === 'function' && !value.__isRef) continue
    // toRef(store, key) reads/writes store[key], preserving the reactive link.
    refs[key] = toRef(store, key)
  }
  return refs
}
