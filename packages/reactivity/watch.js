// ============================================================================
//  watch.js — "watch data and call a function when it changes"
// ----------------------------------------------------------------------------
//  effect re-runs a function on changes. watch is a layer on top: it gives you
//  a callback that receives the NEW and OLD values, and decides itself when to
//  call that callback (via a scheduler). The source can be:
//    - a ref            → watch(count, (n, o) => ...)
//    - a getter function→ watch(() => state.count, (n, o) => ...)
//    - a reactive object→ watch(state, (n, o) => ...)  (watched deeply)
// ============================================================================

import { ReactiveEffect } from './effect.js'
import { isRef } from './ref.js'
import { isReactive, isObject } from './reactive.js'

/**
 * Watches a reactive source and invokes a callback with the new and old values
 * when it changes.
 * @param {object|Function} source - A ref, a reactive object, or a getter.
 * @param {(newValue: *, oldValue: *) => void} callback - Called on change.
 * @param {{immediate?: boolean}} [options] - immediate runs the callback at once.
 * @returns {() => void} A function that stops watching.
 */
export function watch(source, callback, options = {}) {
  // 1. Normalize any source to a single shape — a getter function that returns
  //    the observed value AND, along the way, "reads" all dependencies (so the
  //    effect tracks them).
  let getter
  if (isRef(source)) {
    getter = () => source.value
  } else if (isReactive(source)) {
    // For a reactive object we watch deeply: traverse walks every nested
    // property, "touching" it so the effect subscribes to each one.
    getter = () => traverse(source)
  } else if (typeof source === 'function') {
    getter = source
  } else {
    getter = () => source
  }

  let oldValue

  // 2. The scheduler is the "reaction to a change": compute the new value
  //    (by re-running the effect) and call the user's callback.
  const job = () => {
    const newValue = effect.run()
    callback(newValue, oldValue)
    oldValue = newValue
  }

  const effect = new ReactiveEffect(getter, job)

  // 3. immediate: true — call the callback at once, without waiting for the
  //    first change.
  if (options.immediate) {
    job()
  } else {
    // The first run only collects dependencies and remembers the starting
    // value — we don't call the callback yet.
    oldValue = effect.run()
  }

  // Return the function that stops watching.
  return () => effect.stop()
}

// watchEffect(fn) — a "simplified watch without a source". It runs fn right away
// and then re-runs it whenever any reactive data it read changes. Unlike watch,
// it gives no old/new value — just "do this whenever something you read
// changes". Returns a stop function.
//
//   const stop = watchEffect(() => console.log('count =', count.value))
/**
 * Runs a function immediately and re-runs it whenever any reactive data it read
 * changes.
 * @param {Function} fn - The function to run reactively.
 * @returns {() => void} A function that stops the effect.
 */
export function watchEffect(fn) {
  const effect = new ReactiveEffect(fn, () => effect.run())
  effect.run() // first run: both executes and collects dependencies
  return () => effect.stop()
}

// Recursively walk an object, reading every property. The read through the
// reactive Proxy triggers track, so the effect subscribes to every level.
// seen guards against looping on objects that reference themselves.
function traverse(value, seen = new Set()) {
  if (!isObject(value) || seen.has(value)) return value
  seen.add(value)
  for (const key in value) {
    traverse(value[key], seen)
  }
  return value
}
