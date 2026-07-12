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

const queue = [] // update jobs (one per component)
let isFlushing = false // whether the queue is already being drained
// One and the same already-resolved promise — a cheap way to "run after the
// current synchronous code". The promise microtask runs as soon as the stack
// empties out.
const resolvedPromise = Promise.resolve()
let currentFlushPromise = null

/**
 * Queue an update job. If it's already in the queue we don't duplicate it (a
 * component doesn't need to be updated twice within one tick).
 * @param {Function & { id?: number }} job The update job to schedule.
 */
export function queueJob(job) {
  if (!queue.includes(job)) {
    queue.push(job)
    queueFlush()
  }
}

function queueFlush() {
  if (isFlushing) return
  isFlushing = true
  currentFlushPromise = resolvedPromise.then(flushJobs)
}

function flushJobs() {
  try {
    // Sort by ascending component id. A parent has a smaller id than its child
    // (it was created earlier), so the parent updates first. This matters: the
    // parent may remove the child, and then updating the child is no longer needed.
    queue.sort((a, b) => a.id - b.id)
    for (let i = 0; i < queue.length; i++) {
      queue[i]()
    }
  } finally {
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
