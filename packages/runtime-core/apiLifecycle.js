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

import { getCurrentInstance } from './component.js'

// Each stage has a short key under which the instance stores its array of hooks.
// bm = beforeMount, m = mounted, bu = beforeUpdate, u = updated,
// bum = beforeUnmount, um = unmounted.
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
 * Invoke every hook in a list (the list may be undefined — then it's a no-op).
 * @param {Function[]|undefined} hooks
 */
export function invokeHooks(hooks) {
  if (!hooks) return
  for (const hook of hooks) hook()
}
