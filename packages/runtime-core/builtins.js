// ============================================================================
//  builtins.js — built-in components (Teleport, KeepAlive, async)
// ----------------------------------------------------------------------------
//  These are not ordinary components: they carry special markers (__isTeleport,
//  __isKeepAlive) by which the renderer knows to handle them differently. The
//  compiler resolves them by name via resolveComponent (see the BUILTINS list in
//  component.js).
// ============================================================================

import { h } from './vnode.js'
import { ref } from '../reactivity/index.js'
// Circular import (component.js imports BUILTIN_COMPONENTS back from us) —
// fine: getCurrentInstance is a hoisted function only called at runtime.
import { getCurrentInstance } from './component.js'

// ---------------------------------------------------------------------------
//  Teleport — a "portal": renders its children not in place, but into a given
//  container. Useful for overlays, modals, tooltips: logically the element sits
//  inside the component, but physically at the end of <body>, so it isn't clipped
//  by the parent's overflow or z-index.
//
//    <Teleport to="#modals"><div class="modal">...</div></Teleport>
//
//  The component itself is just a marker; all the logic is in the renderer
//  (processTeleport).
// ---------------------------------------------------------------------------
/** Teleport built-in: renders its children into the container given by the `to` prop. */
export const Teleport = {
  name: 'Teleport',
  __isTeleport: true,
}

// ---------------------------------------------------------------------------
//  KeepAlive — caches inactive components instead of destroying them. Switch a
//  tab away and back, and the state (typed text, scroll position) is still there.
//  It wraps a dynamic component:
//
//    <KeepAlive><component :is="tab" /></KeepAlive>
//
//  The activation/deactivation logic lives in the component system (driven by
//  markers on the vnode). Here we only keep a "key → vnode with a live
//  instance" cache and set the markers.
// ---------------------------------------------------------------------------
/** KeepAlive built-in: caches the wrapped dynamic component so its state survives toggling. */
export const KeepAlive = {
  name: 'KeepAlive',
  __isKeepAlive: true,
  setup(props, { slots }) {
    // The KeepAlive instance OWNS its cache. When the KeepAlive itself is
    // unmounted, unmountComponent (component.js) walks this cache and truly
    // destroys every stashed instance — hooks fire, effects stop. Without an
    // owner, "unmount" would keep stashing forever and leak every cached
    // component for the life of the page.
    const instance = getCurrentInstance()
    const cache = new Map() // component key → its cached vnode
    instance.__keepAliveCache = cache

    return () => {
      const children = slots.default ? slots.default() : []
      const vnode = children[0]
      // Only cache components (there's no state worth keeping for plain tags).
      if (!vnode || typeof vnode.type !== 'object') return vnode || null

      const key = vnode.key != null ? vnode.key : vnode.type
      if (cache.has(key)) {
        // Seen before: reuse the live instance from the cache.
        vnode.component = cache.get(key).component
        vnode.__keptAlive = true // the component system "reactivates" instead of remounting
      }
      // Always store the FRESH vnode: it carries the latest props, and the
      // teardown pass must see current state, not a first-render snapshot.
      cache.set(key, vnode)
      // On leave, this vnode is stashed away instead of destroyed — unless the
      // owner (this KeepAlive) is itself being torn down.
      vnode.__shouldKeepAlive = true
      vnode.__keepAliveOwner = instance
      return vnode
    }
  },
}

// ---------------------------------------------------------------------------
//  defineAsyncComponent — a component loaded on demand (the code arrives later,
//  e.g. over the network). While it loads we show a "loading" placeholder, then
//  the real component. Reactivity does the rest: a ref switches the view.
//
//    const Chart = defineAsyncComponent(() => import('./Chart.js'))
// ---------------------------------------------------------------------------
/**
 * Create a wrapper component that lazily loads its real implementation.
 * @param {(() => Promise<object>)|{loader: () => Promise<object>, loadingComponent?: object, errorComponent?: object}} source
 *   A loader function, or an options object with a loader plus optional
 *   loadingComponent/errorComponent.
 * @returns {object} The async component wrapper.
 */
export function defineAsyncComponent(source) {
  const options = typeof source === 'function' ? { loader: source } : source
  let resolvedComponent = null
  // ONE in-flight request shared by every instance of this wrapper: ten async
  // components in a list must trigger one fetch, not ten. A failed load clears
  // the slot so a later instance can retry.
  let pendingRequest = null

  function load() {
    if (resolvedComponent) return Promise.resolve(resolvedComponent)
    if (!pendingRequest) {
      pendingRequest = options
        .loader()
        .then((mod) => {
          // Support both `export default` and returning the component directly.
          resolvedComponent = mod && mod.default ? mod.default : mod
          return resolvedComponent
        })
        .catch((err) => {
          pendingRequest = null // allow retrying after a failure
          throw err
        })
    }
    return pendingRequest
  }

  return {
    name: 'AsyncComponentWrapper',
    setup() {
      const instance = getCurrentInstance()
      const loaded = ref(false)
      const error = ref(null)

      load()
        .then(() => {
          // The user may navigate away before the chunk arrives. A dead wrapper
          // must not flip state and mount the late component into a container
          // that was already cleared.
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
    },
  }
}

// Map of built-in components — resolveComponent uses it to find them by name.
export const BUILTIN_COMPONENTS = { Teleport, KeepAlive }
