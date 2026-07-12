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
//  The activation/deactivation logic lives in the renderer (driven by markers on
//  the vnode). Here we only keep a "key → vnode with a live instance" cache and
//  set the markers.
// ---------------------------------------------------------------------------
/** KeepAlive built-in: caches the wrapped dynamic component so its state survives toggling. */
export const KeepAlive = {
  name: 'KeepAlive',
  __isKeepAlive: true,
  setup(props, { slots }) {
    const cache = new Map() // component key → its cached vnode

    return () => {
      const children = slots.default ? slots.default() : []
      const vnode = children[0]
      // Only cache components (there's no state worth keeping for plain tags).
      if (!vnode || typeof vnode.type !== 'object') return vnode || null

      const key = vnode.key != null ? vnode.key : vnode.type
      if (cache.has(key)) {
        // Seen before: reuse the live instance from the cache.
        vnode.component = cache.get(key).component
        vnode.__keptAlive = true // the renderer "reactivates" instead of remounting
      } else {
        cache.set(key, vnode)
      }
      // On leave, the renderer stashes this vnode away instead of destroying it.
      vnode.__shouldKeepAlive = true
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

  return {
    name: 'AsyncComponentWrapper',
    setup() {
      const loaded = ref(false)
      const error = ref(null)

      options
        .loader()
        .then((mod) => {
          // Support both `export default` and returning the component directly.
          resolvedComponent = mod && mod.default ? mod.default : mod
          loaded.value = true
        })
        .catch((err) => {
          error.value = err
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
