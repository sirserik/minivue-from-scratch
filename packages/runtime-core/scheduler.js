// ============================================================================
//  scheduler.js — the update queue and nextTick
// ----------------------------------------------------------------------------
//  If you change several reactive values one after another, naive reactivity
//  would re-render the component just as many times. That's wasteful: the user
//  only cares about the final result. So we don't run component updates right
//  away — we push them into a queue and drain it once, asynchronously, "at the
//  end of the current tick".
//
//  This way three changes in a row produce a single re-render. The same trick is
//  used in Vue, React (batching) and almost any modern UI framework.
// ============================================================================

import { handleError } from './errorHandling.js'

const queue = [] // update jobs (one per component)
let isFlushPending = false // a flush microtask is scheduled but hasn't started
let isFlushing = false // the queue is being drained right now
// Index of the job that is running RIGHT NOW during a flush. Everything before
// it has already run; everything after it is still pending. Both deduplication
// and cancellation below hinge on this split.
let flushIndex = 0
// One and the same already-resolved promise — a cheap way to "run after the
// current synchronous code". The promise microtask runs as soon as the stack
// empties out.
const resolvedPromise = Promise.resolve()
let currentFlushPromise = null

// Jobs without an id (plain functions in tests, non-component work) sort last —
// component updates carry uid-based ids and must keep parent-before-child order.
const getId = (job) => (job.id == null ? Infinity : job.id)

/**
 * Queue an update job. If it's already waiting in the queue we don't duplicate
 * it (a component doesn't need to be updated twice within one tick).
 * @param {Function & { id?: number }} job The update job to schedule.
 */
export function queueJob(job) {
  // Deduplicate — but only against jobs that haven't run yet. During a flush we
  // search starting AFTER the currently running job (flushIndex + 1): the
  // running job must be allowed to re-queue itself. Classic case: onUpdated
  // changes state again — Vue re-runs the component in the same flush cycle;
  // searching from index 0 would find the running job and silently drop that
  // follow-up update forever.
  if (!queue.includes(job, isFlushing ? flushIndex + 1 : 0)) {
    if (!isFlushing) {
      queue.push(job)
    } else {
      // A job arriving mid-flush must respect the sorted order (parent before
      // child), so insert it by id after the running index instead of pushing
      // to the end — otherwise a parent re-queued from inside a child's update
      // would run after children it might re-render or even remove.
      let i = flushIndex + 1
      while (i < queue.length && getId(queue[i]) <= getId(job)) i++
      queue.splice(i, 0, job)
    }
    queueFlush()
  }
}

/**
 * Remove a not-yet-run job from the queue. Called on component unmount: its
 * already-scheduled update must never run — it would re-render a dead component
 * into the DOM. A job that already ran in the current flush is left alone.
 * @param {Function} job The job to cancel.
 */
export function invalidateJob(job) {
  // Search only in the "hasn't run yet" part of the queue (see queueJob).
  const i = queue.indexOf(job, isFlushing ? flushIndex + 1 : 0)
  if (i > -1) queue.splice(i, 1)
}

function queueFlush() {
  if (!isFlushPending && !isFlushing) {
    isFlushPending = true
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}

function flushJobs() {
  isFlushPending = false
  isFlushing = true
  try {
    // Sort by ascending component id. A parent has a smaller id than its child
    // (it was created earlier), so the parent updates first. This matters: the
    // parent may remove the child, and then updating the child is no longer needed.
    queue.sort((a, b) => getId(a) - getId(b))
    for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
      // Each job runs in its own try/catch: one component throwing in render
      // must not cancel every other pending update in this tick (and must not
      // reject the nextTick promise the whole app awaits). The error is routed
      // to onErrorCaptured / app.config.errorHandler via errorHandling.js;
      // job.i is the owning component instance (set in setupRenderEffect).
      try {
        queue[flushIndex]()
      } catch (err) {
        handleError(err, queue[flushIndex].i || null, 'component update')
      }
    }
  } finally {
    flushIndex = 0
    queue.length = 0
    isFlushing = false
    currentFlushPromise = null
  }
}

/**
 * nextTick(fn) — "run after all scheduled DOM updates have been applied". Without
 * an argument it returns a promise you can await.
 *   await nextTick()
 *   // the DOM is already updated here
 * @param {Function} [fn] Optional callback to run after the flush.
 * @returns {Promise} A promise that resolves once pending updates are flushed.
 */
export function nextTick(fn) {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(fn) : p
}
