// ============================================================================
//  errorHandling.js — one place where component errors go to be dealt with
// ----------------------------------------------------------------------------
//  A component's code (setup, render, lifecycle hooks, emit handlers) is USER
//  code — it can throw. If we let the exception fly, it unwinds through the
//  framework's own stack: a broken button handler would kill the scheduler
//  flush and freeze every other component on the page. So we do what real Vue
//  does: wrap user code in callWithErrorHandling and give errors an escape
//  route that does not take the app down with them.
//
//  Where a caught error goes, in order:
//    1) up the parent chain, to every onErrorCaptured hook — a component can
//       "catch" errors from its subtree (error boundaries). Returning false
//       from the hook stops the propagation;
//    2) app.config.errorHandler — the app-wide handler, if the user set one;
//    3) console.error — the last resort, so the error is at least visible.
//
//  This module deliberately imports nothing from component.js: it only reads
//  plain fields off the instance object (parent, ec, appContext). That keeps it
//  usable from the scheduler without creating an import cycle.
// ============================================================================

/**
 * Run a piece of user code; if it throws, route the error through
 * handleError instead of letting it unwind the framework's stack.
 * @param {Function} fn User code to run (a hook, a handler, a render fn...).
 * @param {object|null} instance The component the code belongs to (for
 *   onErrorCaptured propagation and app.config.errorHandler lookup).
 * @param {string} type Human-readable description for the error message
 *   ("render function", "mounted hook", ...).
 * @param {Array} [args] Arguments to call fn with.
 * @returns {*} Whatever fn returns, or undefined if it threw.
 */
export function callWithErrorHandling(fn, instance, type, args) {
  try {
    return args ? fn(...args) : fn()
  } catch (err) {
    handleError(err, instance, type)
  }
}

/**
 * Deliver an already-caught error: onErrorCaptured hooks up the parent chain,
 * then app.config.errorHandler, then console.error.
 * @param {*} err The thrown error.
 * @param {object|null} instance Component the error originated in (may be null).
 * @param {string} type What was running when it threw.
 */
export function handleError(err, instance, type) {
  if (instance) {
    // 1) Walk UP the tree. We start at the parent: a component does not capture
    //    its own errors — that's what try/catch in its own code is for.
    let cur = instance.parent
    while (cur) {
      const hooks = cur.ec // onErrorCaptured hooks (see apiLifecycle.js)
      if (hooks) {
        for (const hook of hooks) {
          // `return false` from the hook means "handled, stop here".
          if (hook(err, instance, type) === false) return
        }
      }
      cur = cur.parent
    }
    // 2) The app-level handler (app.config.errorHandler = (err, instance, info) => ...).
    const appErrorHandler =
      instance.appContext && instance.appContext.config && instance.appContext.config.errorHandler
    if (appErrorHandler) {
      appErrorHandler(err, instance, type)
      return
    }
  }
  // 3) Nobody claimed the error — report it, but do NOT rethrow: one broken
  //    component must not stop the rest of the app from updating.
  console.error(`[minivue] Unhandled error${type ? ` during ${type}` : ''}:`, err)
}
