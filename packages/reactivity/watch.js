// ============================================================================
//  watch.js — "watch data and call a function when it changes"
// ----------------------------------------------------------------------------
//  effect re-runs a function on changes. watch is a layer on top: it gives you
//  a callback that receives the NEW and OLD values, and decides itself when to
//  call that callback (via a scheduler). The source can be:
//    - a ref             → watch(count, (n, o) => ...)
//    - a getter function → watch(() => state.count, (n, o) => ...)
//    - a reactive object → watch(state, (n, o) => ...)  (watched deeply)
//    - an array of those → watch([a, b], ([an, bn], [ao, bo]) => ...)
// ============================================================================

import { ReactiveEffect } from './effect.js'
import { isRef } from './ref.js'
import { isReactive, isObject, hasChanged } from './reactive.js'

// ---------------------------------------------------------------------------
//  A tiny job queue for the default flush: 'pre' mode. Watch callbacks don't
//  fire once per mutation — they are queued and flushed in a microtask, each
//  job at most once per flush (like Vue). Two wins:
//    1) three synchronous mutations = ONE callback with the final value;
//    2) a watcher that mutates its own source re-QUEUES its job instead of
//       recursing — the loop converges instead of overflowing the stack.
//  The queue lives here, in the reactivity layer: watch must work without the
//  renderer, so we don't import the runtime-core scheduler.
// ---------------------------------------------------------------------------
const queue = new Set()
let isFlushPending = false

function queueWatchJob(job) {
  queue.add(job) // a Set — queuing the same job twice is a no-op
  if (!isFlushPending) {
    isFlushPending = true
    Promise.resolve().then(flushWatchJobs)
  }
}

function flushWatchJobs() {
  try {
    // A job may queue jobs (even itself) while we flush: a Set iterator sees
    // entries added during iteration, so they run in this same flush.
    for (const job of queue) {
      queue.delete(job) // remove BEFORE running, so the job can re-queue itself
      job()
    }
  } finally {
    queue.clear()
    isFlushPending = false
  }
}

/**
 * Watches a reactive source and invokes a callback with the new and old values
 * when it changes. By default the callback is batched into a microtask
 * (flush: 'pre'); pass flush: 'sync' to fire on every mutation.
 * @param {object|Function|Array} source - A ref, a reactive object, a getter,
 *   or an array of such sources.
 * @param {(newValue: *, oldValue: *, onCleanup: (fn: Function) => void) => void} callback -
 *   Called on change; onCleanup registers a function run before the next call
 *   and on stop (e.g. to cancel a stale request).
 * @param {{immediate?: boolean, deep?: boolean, once?: boolean, flush?: 'pre'|'sync'}} [options]
 *   immediate runs the callback at once; deep traverses the value; once stops
 *   after the first call.
 * @returns {() => void} A function that stops watching.
 */
export function watch(source, callback, options = {}) {
  const { immediate, deep, once, flush } = options

  // 1. Normalize any source to a single shape — a getter function that returns
  //    the observed value AND, along the way, "reads" all dependencies (so the
  //    effect tracks them).
  let getter
  // A reactive object is watched deeply: even when the same object comes back,
  // something inside it changed — the callback must fire without a value
  // comparison (there is nothing cheap to compare).
  let forceTrigger = false
  const isMultiSource = Array.isArray(source) && !isReactive(source)

  if (isRef(source)) {
    getter = () => source.value
  } else if (isReactive(source)) {
    // traverse walks every nested property, "touching" it so the effect
    // subscribes to each one.
    getter = () => traverse(source)
    forceTrigger = true
  } else if (isMultiSource) {
    // Array of sources: the getter returns an array of current values, and the
    // callback receives arrays of new/old values.
    forceTrigger = source.some(isReactive)
    getter = () =>
      source.map((s) => {
        if (isRef(s)) return s.value
        if (isReactive(s)) return traverse(s)
        if (typeof s === 'function') return s()
        return s
      })
  } else if (typeof source === 'function') {
    getter = source
  } else {
    getter = () => source
  }

  if (deep) {
    const baseGetter = getter
    getter = () => traverse(baseGetter())
  }

  // onCleanup: the callback can register a function to run before its NEXT
  // invocation and when the watcher stops — the standard way to cancel work
  // that a newer value has made stale.
  let cleanup
  const onCleanup = (fn) => {
    cleanup = fn
  }
  const runCleanup = () => {
    if (cleanup) {
      cleanup()
      cleanup = undefined
    }
  }

  let oldValue = isMultiSource ? [] : undefined

  // 2. The job is the "reaction to a change": compute the new value (by
  //    re-running the effect) and, if it REALLY changed, call the callback.
  const job = () => {
    if (!effect.active) return // stopped while waiting in the queue

    const newValue = effect.run()
    const changed =
      forceTrigger ||
      deep ||
      (isMultiSource
        ? newValue.some((value, i) => hasChanged(value, oldValue[i]))
        : hasChanged(newValue, oldValue))

    if (!changed) return // e.g. the getter re-ran but produced the same value

    runCleanup()
    callback(newValue, oldValue, onCleanup)
    oldValue = newValue
    if (once) stop()
  }

  // 3. flush decides WHEN the job runs: 'sync' — right inside the mutation,
  //    'pre' (default) — batched in a microtask via the queue above.
  const scheduler = flush === 'sync' ? job : () => queueWatchJob(job)
  const effect = new ReactiveEffect(getter, scheduler)
  // Run pending cleanup when the watcher is stopped (directly or by its scope).
  effect.onStop = runCleanup

  const stop = () => effect.stop()

  // 4. immediate: true — call the callback at once, without waiting for the
  //    first change.
  if (immediate) {
    job()
  } else {
    // The first run only collects dependencies and remembers the starting
    // value — we don't call the callback yet.
    oldValue = effect.run()
  }

  return stop
}

// watchEffect(fn) — a "simplified watch without a source". It runs fn right away
// and then re-runs it whenever any reactive data it read changes. Unlike watch,
// it gives no old/new value — just "do this whenever something you read
// changes". Re-runs are batched in a microtask like watch (flush: 'pre').
// Returns a stop function.
//
//   const stop = watchEffect((onCleanup) => console.log('count =', count.value))
/**
 * Runs a function immediately and re-runs it whenever any reactive data it read
 * changes. The function receives onCleanup to register a cleanup callback run
 * before each re-run and on stop.
 * @param {(onCleanup: (fn: Function) => void) => void} fn - The function to run reactively.
 * @param {{flush?: 'pre'|'sync'}} [options] - 'sync' re-runs on every mutation.
 * @returns {() => void} A function that stops the effect.
 */
export function watchEffect(fn, options = {}) {
  let cleanup
  const onCleanup = (registered) => {
    cleanup = registered
  }
  const runCleanup = () => {
    if (cleanup) {
      cleanup()
      cleanup = undefined
    }
  }

  const job = () => {
    if (!effect.active) return
    runCleanup()
    effect.run()
  }

  const scheduler = options.flush === 'sync' ? job : () => queueWatchJob(job)
  const effect = new ReactiveEffect(() => fn(onCleanup), scheduler)
  effect.onStop = runCleanup

  effect.run() // first run: both executes and collects dependencies
  return () => effect.stop()
}

// Recursively walk a value, reading everything reachable. The reads go through
// the reactive Proxy and trigger track, so the effect subscribes to every
// level. Refs are unwrapped, Map/Set entries are visited through their
// (instrumented) iteration. seen guards against looping on self-references.
function traverse(value, seen = new Set()) {
  if (!isObject(value) || seen.has(value)) return value
  seen.add(value)

  if (isRef(value)) {
    traverse(value.value, seen)
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) traverse(value[i], seen)
  } else if (value instanceof Map) {
    value.forEach((v) => traverse(v, seen))
  } else if (value instanceof Set) {
    value.forEach((v) => traverse(v, seen))
  } else {
    for (const key in value) traverse(value[key], seen)
  }
  return value
}
