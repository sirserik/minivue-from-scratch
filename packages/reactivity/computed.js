// ============================================================================
//  computed.js — a cached computed value
// ----------------------------------------------------------------------------
//  computed(() => a.value + b.value) is a value that:
//    1) is lazy: the formula does NOT run until .value is accessed;
//    2) is cached: as long as the dependencies (a, b) haven't changed, a repeat
//       read returns the remembered result without recomputing;
//    3) is reactive itself: if it is read inside an effect and a dependency
//       changes, that effect re-runs.
//
//  All of this is assembled from ready-made building blocks: a ReactiveEffect
//  with lazy start and a scheduler, plus its own dep, just like a ref.
// ============================================================================

import { ReactiveEffect, trackEffects, triggerEffects, activeEffect } from './effect.js'

class ComputedRefImpl {
  constructor(getter) {
    this._value = undefined
    // "Dirty" flag: true means dependencies changed and we need to recompute.
    // Starts true so the first access computes the value.
    this._dirty = true
    this.dep = new Set()
    this.__isRef = true // computed behaves like a ref: accessed via .value

    // Wrap the formula in an effect, but with two twists:
    //  - lazy: we don't run the effect in the constructor (compute on read);
    //  - scheduler: when a dependency changes, the reactive system calls NOT
    //    the recompute directly but this scheduler. It only marks the value
    //    "dirty" and wakes whoever read the computed. The recompute itself
    //    happens on the next .value read — lazily again.
    this.effect = new ReactiveEffect(getter, () => {
      if (!this._dirty) {
        this._dirty = true
        triggerEffects(this.dep)
      }
    })
  }

  get value() {
    // If we're read inside someone else's effect, subscribe it to us.
    if (activeEffect) trackEffects(this.dep)

    // Recompute only when "dirty". During effect.run() the getter triggers
    // tracks on a and b — that's how computed learns its dependencies.
    if (this._dirty) {
      this._value = this.effect.run()
      this._dirty = false
    }

    return this._value
  }
}

/**
 * Creates a lazily-evaluated, cached, reactive value from a getter.
 * @param {() => *} getter - Function computing the value from reactive sources.
 * @returns {ComputedRefImpl} A ref-like object whose `.value` returns the result.
 */
export function computed(getter) {
  return new ComputedRefImpl(getter)
}
