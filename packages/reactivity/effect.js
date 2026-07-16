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

// Global "is tracking allowed?" switch. Array mutators like push() READ the
// array (length, indices) as a side effect of writing. If an effect calls
// push(), we must not subscribe it to those incidental reads — two effects
// pushing to the same array would otherwise re-trigger each other forever.
// pauseTracking() flips the switch off for the duration of such an operation.
export let shouldTrack = true
const trackStack = []

/** Temporarily disables dependency tracking (see array mutators in reactive.js). */
export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

/** Restores the tracking state saved by the matching pauseTracking(). */
export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

// A special key representing "the shape of the object" (its set of keys).
// Iterating an object (for...in, Object.keys, Map.forEach, size) depends not on
// one property but on which keys EXIST — so we track this key instead, and
// adding/removing a key triggers it.
export const ITERATE_KEY = Symbol('iterate')

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
    this.onStop = null // optional hook run once when the effect is stopped
    // If a scope is collecting right now (a component is being set up), register
    // there — so the whole group can be stopped at once on unmount.
    recordEffectScope(this)
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
      if (this.onStop) this.onStop()
    }
  }
}

// ---------------------------------------------------------------------------
//  EffectScope — a "basket" that collects effects so they can be stopped as a
//  group. A component creates one scope for itself: the render effect and every
//  watch/computed born inside setup() land in it. On unmount a single
//  scope.stop() disconnects the whole component from reactivity — without it,
//  "dead" components would keep re-rendering and leak memory.
// ---------------------------------------------------------------------------
let activeScope = undefined

export class EffectScope {
  constructor() {
    this.effects = []
    this.active = true
  }

  // Run fn with this scope "collecting": every ReactiveEffect created inside
  // (see the constructor above) is recorded here.
  run(fn) {
    if (!this.active) return fn()
    const prevScope = activeScope
    activeScope = this
    try {
      return fn()
    } finally {
      activeScope = prevScope
    }
  }

  // Stop every collected effect. Idempotent: a second call does nothing.
  stop() {
    if (!this.active) return
    this.active = false
    for (const effect of this.effects) {
      effect.stop()
    }
    this.effects.length = 0
  }
}

/**
 * Creates a new effect scope (see EffectScope).
 * @returns {EffectScope} A scope; use scope.run(fn) to collect, scope.stop() to
 *   stop everything collected.
 */
export function effectScope() {
  return new EffectScope()
}

/**
 * Returns the scope currently collecting effects, if any.
 * @returns {EffectScope|undefined} The active scope.
 */
export function getCurrentScope() {
  return activeScope
}

/**
 * Records an effect into a scope (the active one by default) so it is stopped
 * together with the scope.
 * @param {ReactiveEffect} effect - The effect to record.
 * @param {EffectScope} [scope] - The scope to record into.
 */
export function recordEffectScope(effect, scope = activeScope) {
  if (scope && scope.active) {
    scope.effects.push(effect)
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
  // Nobody is listening (or tracking is paused) — nothing to track.
  if (!activeEffect || !shouldTrack) return

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
  if (!activeEffect || !shouldTrack) return
  // Already linked (the effect read this source twice in one run) — don't push
  // a duplicate dep reference into effect.deps.
  if (dep.has(activeEffect)) return
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
 * The `type` says WHAT happened — changing a value ('set') wakes only readers
 * of that key, while adding/removing a key ('add'/'delete'/'clear') also wakes
 * iteration effects (for...in, Object.keys, array length, Map.forEach).
 * @param {object} target - The reactive source object.
 * @param {string|symbol} key - The property that changed.
 * @param {'set'|'add'|'delete'|'clear'} [type] - The kind of change.
 * @param {*} [newValue] - The new value (used for array length shrinking).
 */
export function trigger(target, key, type = 'set', newValue) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return // this object was never read inside an effect

  // Collect every dep set the change affects, then fire them all at once.
  const deps = []

  if (type === 'clear') {
    // collection.clear() — every key is gone, wake everything.
    deps.push(...depsMap.values())
  } else if (key === 'length' && Array.isArray(target)) {
    // arr.length = N shrunk the array: effects reading .length re-run, and so
    // do effects that read a now-removed index (arr[5] when length became 2).
    const newLength = Number(newValue)
    depsMap.forEach((dep, depKey) => {
      if (depKey === 'length' || (typeof depKey === 'string' && Number(depKey) >= newLength)) {
        deps.push(dep)
      }
    })
  } else {
    deps.push(depsMap.get(key))

    if (type === 'add') {
      if (Array.isArray(target)) {
        // A new index appeared → the array's length changed.
        deps.push(depsMap.get('length'))
      } else {
        // A new key appeared → the set of keys changed.
        deps.push(depsMap.get(ITERATE_KEY))
      }
    } else if (type === 'delete') {
      if (!Array.isArray(target)) {
        deps.push(depsMap.get(ITERATE_KEY))
      }
    } else if (type === 'set' && target instanceof Map) {
      // map.set() with an existing key: forEach/entries read VALUES too, so an
      // iteration over a Map must re-run even without a key being added.
      deps.push(depsMap.get(ITERATE_KEY))
    }
  }

  // Merge into one set so an effect subscribed to several deps runs once.
  const effects = new Set()
  for (const dep of deps) {
    if (dep) dep.forEach((effect) => effects.add(effect))
  }
  triggerEffects(effects)
}

/**
 * Re-runs (or schedules) every effect in a dep set.
 * @param {Set} dep - The set of effects to trigger.
 */
// Bookkeeping for the "computed first" ordering below. When a computed
// invalidates, it re-runs its own subscribers immediately (they need the fresh
// value). Those runs happen while a computed pass is active somewhere on the
// stack — we record them, so the plain pass of the original trigger doesn't
// run the same effect a second time for the same change.
let ranViaComputed = null
let computedPassDepth = 0

export function triggerEffects(dep) {
  // An important subtlety: copy the set into a new array BEFORE iterating.
  // During run() the effect calls cleanup (removing itself from dep) and adds
  // itself back (track). Mutating a Set while iterating it is a source of
  // infinite loops and missed entries. The copy guards against that.
  const effects = [...dep]

  // The outermost trigger of this cascade owns the "already ran" set.
  const isRootTrigger = ranViaComputed === null
  if (isRootTrigger) ranViaComputed = new Set()

  try {
    // Pass 1: computed effects go FIRST. If an effect reads both a value and a
    // computed built on it, running the plain effect before the computed's
    // invalidation would let it see a stale cached result (a "glitch").
    computedPassDepth++
    try {
      for (const effect of effects) {
        if (effect.computed) triggerEffect(effect)
      }
    } finally {
      computedPassDepth--
    }

    // Pass 2: plain effects — skipping the ones that already ran with fresh
    // values through a computed's invalidation in pass 1.
    for (const effect of effects) {
      if (!effect.computed && !ranViaComputed.has(effect)) triggerEffect(effect)
    }
  } finally {
    if (isRootTrigger) ranViaComputed = null
  }
}

function triggerEffect(effect) {
  // Don't let an effect re-run itself (e.g. i++ inside an effect that reads i)
  // — otherwise infinite recursion.
  if (effect === activeEffect) return

  // Runs caused by a computed invalidation are remembered (see above).
  if (computedPassDepth > 0 && ranViaComputed) ranViaComputed.add(effect)

  if (effect.scheduler) {
    // There's a scheduler — hand the decision to it (computed/watch/UI queue).
    effect.scheduler()
  } else {
    effect.run()
  }
}
