// ============================================================================
//  apiLifecycle.js — component lifecycle hooks
// ----------------------------------------------------------------------------
//  A component goes through stages: created → mounted into the DOM → updated on
//  changes → unmounted. You can attach your own code to each stage — e.g. "once
//  mounted, fetch data from the server". Those functions are the hooks. Inside
//  setup() you write:  onMounted(() => { ... }).
//
//  A hook simply appends your function to the list for the given stage on the
//  CURRENT component (currentInstance). Later, when it reaches that stage, the
//  renderer calls all the functions in the list.
// ============================================================================

// NOTE on the import below: component.js imports invokeHooks from this file,
// and this file imports getCurrentInstance from component.js — a circular
// import. ESM handles it: both are hoisted function declarations, and neither
// module CALLS the other at import time, only later at runtime. Real Vue has
// the same shape (lifecycle hooks live next to the component internals); we
// keep the cycle and document it rather than merge two teaching topics into
// one file.
import { getCurrentInstance } from './component.js'
import { callWithErrorHandling } from './errorHandling.js'

// Each stage has a short key under which the instance stores its array of hooks.
// bm = beforeMount, m = mounted, bu = beforeUpdate, u = updated,
// bum = beforeUnmount, um = unmounted, a = activated, da = deactivated,
// ec = errorCaptured.
function createHook(lifecycle) {
  return (hook) => {
    const instance = getCurrentInstance()
    if (!instance) {
      // The hook was called outside setup() — there's nothing to attach it to.
      console.warn(`The ${lifecycle} hook can only be called inside setup()`)
      return
    }
    const list = instance[lifecycle] || (instance[lifecycle] = [])
    list.push(hook)
  }
}

/** Register a callback to run right before the component is mounted. @param {Function} hook */
export const onBeforeMount = createHook('bm')
/** Register a callback to run after the component is mounted. @param {Function} hook */
export const onMounted = createHook('m')
/** Register a callback to run right before the component re-renders. @param {Function} hook */
export const onBeforeUpdate = createHook('bu')
/** Register a callback to run after the component re-renders. @param {Function} hook */
export const onUpdated = createHook('u')
/** Register a callback to run right before the component is unmounted. @param {Function} hook */
export const onBeforeUnmount = createHook('bum')
/** Register a callback to run after the component is unmounted. @param {Function} hook */
export const onUnmounted = createHook('um')
/**
 * Register a callback for when a kept-alive component is shown again
 * (KeepAlive moved its DOM back instead of remounting). @param {Function} hook
 */
export const onActivated = createHook('a')
/**
 * Register a callback for when a kept-alive component is hidden
 * (KeepAlive stashed its DOM instead of destroying it). @param {Function} hook
 */
export const onDeactivated = createHook('da')
/**
 * Register an error boundary: the hook receives (err, instance, info) for any
 * error thrown in a DESCENDANT component (render, setup, lifecycle hooks, emit
 * handlers). Return false to stop the error from propagating further up.
 * See errorHandling.js for the propagation order. @param {Function} hook
 */
export const onErrorCaptured = createHook('ec')

/**
 * Invoke every hook in a list (the list may be undefined — then it's a no-op).
 * Hooks are user code, so each runs through callWithErrorHandling: one throwing
 * onMounted must not abort the mount or the sibling hooks after it.
 * @param {Function[]|undefined} hooks
 * @param {object|null} [instance] Owning component (for error routing).
 * @param {string} [type] Description used in error messages.
 */
export function invokeHooks(hooks, instance = null, type = 'lifecycle hook') {
  if (!hooks) return
  for (const hook of hooks) callWithErrorHandling(hook, instance, type)
}
