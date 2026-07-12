// ============================================================================
//  effect.js — the heart of reactivity
// ----------------------------------------------------------------------------
//  The idea in one sentence: an "effect" is a function that must be re-run when
//  the data it read changes. Everything else in reactivity is built around two
//  verbs:
//
//    track(target, key)   — "remember that the current effect read target.key"
//    trigger(target, key) — "target.key changed — re-run every effect that read
//                            it"
//
//  Below we store these links in the targetMap structure and manage them carefully.
// ============================================================================

// Who is "listening" right now? While some effect's body is running, that
// effect lives here. Any read of reactive data at that moment lands in its
// dependency list. Outside effects activeEffect === undefined, and reading data
// tracks nothing (it just returns the value).
export let activeEffect = undefined

// Effects can be nested (an effect inside an effect — for example, a component
// with a computed running inside it). So that the outer effect becomes "active"
// again after leaving the inner one, we keep a stack.
const effectStack = []

// The main store of all dependencies in the app:
//
//   targetMap: WeakMap {
//     reactiveObject -> depsMap: Map {
//       'propertyName' -> dep: Set(effect1, effect2, ...)
//     }
//   }
//
// A WeakMap so that an object no longer used anywhere can be garbage-collected
// together with its dependencies (we don't "hold" it).
const targetMap = new WeakMap()

// ---------------------------------------------------------------------------
//  ReactiveEffect — an effect as an object rather than a plain function.
//  We wrap the function in a class so we can attach to it:
//    - deps      : the list of Sets this effect is "registered" in
//                  (needed to clean up stale dependencies);
//    - scheduler : an optional "scheduler" — if set, trigger calls it instead
//                  of an immediate run() (this is how computed and watch work,
//                  and later the async UI update).
// ---------------------------------------------------------------------------
export class ReactiveEffect {
  constructor(fn, scheduler = null) {
    this.fn = fn
    this.scheduler = scheduler
    this.deps = []
    this.active = true // false after stop() — such an effect no longer tracks
  }

  run() {
    // A stopped effect just runs the function without tracking.
    if (!this.active) return this.fn()

    // Before running, clean up old dependencies. An example of why this matters:
    //   () => text.value = ok.value ? a.value : b.value
    // When ok === true the effect reads a but NOT b. Without cleanup the effect
    // would stay subscribed to b forever and needlessly re-run when b changes.
    // So before each run we forget everything and collect dependencies afresh —
    // leaving only the ones actually read this time.
    cleanup(this)

    try {
      effectStack.push(this)
      activeEffect = this
      return this.fn()
    } finally {
      // Whatever happens, restore the previous active effect.
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1]
    }
  }

  stop() {
    if (this.active) {
      cleanup(this)
      this.active = false
    }
  }
}

// Remove the effect from every Set it is recorded in and clear its own deps
// list. After this the effect is "subscribed to nothing".
function cleanup(effect) {
  const { deps } = effect
  for (const dep of deps) {
    dep.delete(effect)
  }
  deps.length = 0
}

// ---------------------------------------------------------------------------
//  effect(fn) — the public function. Creates an effect and runs it immediately
//  so it collects its dependencies. Returns a "runner" — a function to re-run
//  the effect manually, carrying a .effect property for stop().
// ---------------------------------------------------------------------------
/**
 * Creates a reactive effect and runs it (unless lazy), re-running whenever any
 * reactive data it read changes.
 * @param {Function} fn - The function to run reactively.
 * @param {{scheduler?: Function, lazy?: boolean}} [options] - Optional scheduler
 *   and lazy flag (lazy defers the first run).
 * @returns {Function} A runner to re-run the effect; its `.effect` allows stop().
 */
export function effect(fn, options = {}) {
  const _effect = new ReactiveEffect(fn, options.scheduler)

  // lazy: true — don't run immediately (needed for computed, which is computed
  // only when accessed).
  if (!options.lazy) {
    _effect.run()
  }

  const runner = _effect.run.bind(_effect)
  runner.effect = _effect
  return runner
}

/**
 * Stops a reactive effect so it no longer tracks or re-runs.
 * @param {Function} runner - The runner returned by effect().
 */
export function stop(runner) {
  runner.effect.stop()
}

// ---------------------------------------------------------------------------
//  track — called when a reactive property is READ.
//  "If there is an active effect right now, link it to this (target, key)".
// ---------------------------------------------------------------------------
/**
 * Records that the current active effect depends on `target[key]`.
 * @param {object} target - The reactive source object.
 * @param {string|symbol} key - The property being read.
 */
export function track(target, key) {
  // Nobody is listening — nothing to track.
  if (!activeEffect) return

  // Get (or create) the dependency map for this object.
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    targetMap.set(target, (depsMap = new Map()))
  }

  // Get (or create) the set of effects for this specific property.
  let dep = depsMap.get(key)
  if (!dep) {
    depsMap.set(key, (dep = new Set()))
  }

  trackEffects(dep)
}

// Extracted separately because ref and computed keep their dep directly (not in
// targetMap) and reuse this function.
/**
 * Links the current active effect to a dep set (a two-way subscription).
 * @param {Set} dep - The set of effects for a given source/property.
 */
export function trackEffects(dep) {
  if (!activeEffect) return
  // Two-way link:
  //   the dep knows about the effect (to re-run it on change),
  //   the effect knows about the dep (to clean itself out on cleanup).
  dep.add(activeEffect)
  activeEffect.deps.push(dep)
}

// ---------------------------------------------------------------------------
//  trigger — called when a reactive property is WRITTEN.
//  "Find every effect that read (target, key) and re-run them".
// ---------------------------------------------------------------------------
/**
 * Re-runs every effect that depends on `target[key]`.
 * @param {object} target - The reactive source object.
 * @param {string|symbol} key - The property that changed.
 */
export function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return // this object was never read inside an effect

  const dep = depsMap.get(key)
  if (!dep) return

  triggerEffects(dep)
}

/**
 * Re-runs (or schedules) every effect in a dep set.
 * @param {Set} dep - The set of effects to trigger.
 */
export function triggerEffects(dep) {
  // An important subtlety: copy the set into a new array BEFORE iterating.
  // During run() the effect calls cleanup (removing itself from dep) and adds
  // itself back (track). Mutating a Set while iterating it is a source of
  // infinite loops and missed entries. The copy guards against that.
  const effects = [...dep]
  for (const effect of effects) {
    // Don't let an effect re-run itself (e.g. i++ inside an effect that reads i)
    // — otherwise infinite recursion.
    if (effect === activeEffect) continue

    if (effect.scheduler) {
      // There's a scheduler — hand the decision to it (computed/watch/UI queue).
      effect.scheduler()
    } else {
      effect.run()
    }
  }
}
