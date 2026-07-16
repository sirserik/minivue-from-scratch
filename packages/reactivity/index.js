// ============================================================================
//  Public entry point of the reactivity package.
//  This is where the other layers (components, store, router) get everything
//  they need. It mirrors the "surface" of the real @vue/reactivity, so the
//  names match: ref, reactive, computed, watch, effect, etc.
// ============================================================================

export {
  effect,
  stop,
  ReactiveEffect,
  track,
  trigger,
  pauseTracking,
  resetTracking,
  ITERATE_KEY,
  EffectScope,
  effectScope,
  getCurrentScope,
  recordEffectScope,
} from './effect.js'
export {
  reactive,
  isReactive,
  isProxy,
  toRaw,
  isObject,
  markRaw,
  shallowReactive,
  readonly,
  isReadonly,
} from './reactive.js'
export { ref, isRef, unref, toRef, toRefs, proxyRefs, shallowRef, triggerRef } from './ref.js'
export { computed } from './computed.js'
export { watch, watchEffect } from './watch.js'
