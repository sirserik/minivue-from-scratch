// ============================================================================
//  reactive.js — turning a plain object into a reactive one
// ----------------------------------------------------------------------------
//  reactive(obj) returns a Proxy — a "wrapper" around the object. A Proxy lets
//  us intercept operations: reading a property (get) and writing one (set). We
//  insert calls to track() and trigger() from effect.js into these traps. That
//  way the object itself, without a single extra line in the user's code, starts
//  telling the system: "I was read" / "I was changed".
// ============================================================================

import { track, trigger } from './effect.js'

// Remember Proxies we already created so that reactive(obj) twice returns the
// SAME Proxy (otherwise object comparisons would break and we'd spawn wrappers).
const reactiveMap = new WeakMap()

// Internal marker keys. Reading proxy[IS_REACTIVE] tells us the object is
// already reactive, and proxy[RAW] retrieves the original "raw" object.
export const IS_REACTIVE = Symbol('isReactive')
export const IS_READONLY = Symbol('isReadonly')
export const RAW = Symbol('raw')
// The "never make reactive" mark (markRaw). reactive returns such an object as-is.
export const SKIP = Symbol('skip')

/**
 * Wraps an object in a Proxy that tracks reads and triggers effects on writes,
 * making it deeply reactive (nested objects are wrapped lazily on access).
 * @param {object} target - The object (or array) to make reactive.
 * @returns {object} A reactive proxy; primitives and already-reactive objects
 *   are returned unchanged.
 */
export function reactive(target) {
  // Only objects (arrays included) are worth wrapping. Primitives are not:
  // ref exists for them (see ref.js).
  if (!isObject(target)) return target

  // If target is already our Proxy, return it as-is (reading RAW on a plain
  // object gives undefined; on our Proxy it gives the original object).
  if (target[RAW]) return target

  // We already wrapped this object — return the existing Proxy.
  const existing = reactiveMap.get(target)
  if (existing) return existing

  const proxy = new Proxy(target, {
    get(obj, key, receiver) {
      // Answers to internal markers (not tracked as data).
      if (key === IS_REACTIVE) return true
      if (key === RAW) return obj

      // Reflect.get works correctly with getters and inheritance, passing the
      // right this (receiver). This is more reliable than obj[key].
      const result = Reflect.get(obj, key, receiver)

      // Report: "the current effect read obj.key".
      track(obj, key)

      // Lazy deep reactivity: when a nested object is read, we wrap it in
      // reactive right then, on access. Not recursively up front (that would be
      // costly and would break objects that must not be reactive), but on
      // demand. markRaw objects are skipped.
      if (isObject(result) && !result[SKIP]) {
        return reactive(result)
      }

      return result
    },

    set(obj, key, value, receiver) {
      const oldValue = obj[key]

      // Track whether this property existed before, to tell adding a new key
      // from changing an existing one (this matters for arrays).
      const hadKey = Array.isArray(obj)
        ? Number(key) < obj.length
        : Object.prototype.hasOwnProperty.call(obj, key)

      const result = Reflect.set(obj, key, value, receiver)

      // Run effects only if the value actually changed — otherwise assigning
      // the same value would needlessly wake up the whole UI.
      if (!hadKey) {
        // A new key was added.
        trigger(obj, key)
      } else if (hasChanged(oldValue, value)) {
        // An existing key got a new value.
        trigger(obj, key)
      }

      return result
    },

    deleteProperty(obj, key) {
      const had = Object.prototype.hasOwnProperty.call(obj, key)
      const result = Reflect.deleteProperty(obj, key)
      if (had && result) {
        trigger(obj, key)
      }
      return result
    },
  })

  reactiveMap.set(target, proxy)
  return proxy
}

/**
 * Checks whether a value is a reactive proxy.
 * @param {*} value - The value to test.
 * @returns {boolean} True if the value was created by reactive/shallowReactive.
 */
export function isReactive(value) {
  return !!(value && value[IS_REACTIVE])
}

// --- markRaw ---------------------------------------------------------------
// Marks an object as "never make reactive". Useful for heavy third-party
// objects (a map instance, a class) that don't need reactivity and are even
// harmed by it. reactive() and the nested wrapper will skip such an object.
/**
 * Marks an object so it is never converted to reactive, even when nested inside
 * a reactive object.
 * @param {object} value - The object to protect from reactivity.
 * @returns {object} The same object, now marked.
 */
export function markRaw(value) {
  if (isObject(value)) {
    Object.defineProperty(value, SKIP, { value: true, configurable: true })
  }
  return value
}

// --- shallowReactive -------------------------------------------------------
// Top-level reactivity only: state.count is reactive, but state.nested.x is
// not. Cheaper than deep reactivity when nested data won't change.
/**
 * Creates a reactive proxy that tracks only top-level properties; nested
 * objects are not wrapped.
 * @param {object} target - The object to make shallowly reactive.
 * @returns {object} A shallow reactive proxy (primitives returned unchanged).
 */
export function shallowReactive(target) {
  if (!isObject(target)) return target
  return new Proxy(target, {
    get(obj, key, receiver) {
      if (key === IS_REACTIVE) return true
      if (key === RAW) return obj
      const result = Reflect.get(obj, key, receiver)
      track(obj, key)
      return result // nested is NOT wrapped — that is the whole "shallowness"
    },
    set(obj, key, value, receiver) {
      const oldValue = obj[key]
      const result = Reflect.set(obj, key, value, receiver)
      if (hasChanged(oldValue, value)) trigger(obj, key)
      return result
    },
  })
}

// --- readonly --------------------------------------------------------------
// Read-only: reading is allowed (nested values are readonly too), while writing
// is silently blocked with a warning. There is nothing to track — the value
// never changes.
/**
 * Creates a deeply read-only proxy: reads pass through, writes and deletes are
 * blocked with a warning.
 * @param {object} target - The object to protect.
 * @returns {object} A read-only proxy (primitives returned unchanged).
 */
export function readonly(target) {
  if (!isObject(target)) return target
  return new Proxy(target, {
    get(obj, key, receiver) {
      if (key === IS_READONLY) return true
      if (key === RAW) return obj
      const result = Reflect.get(obj, key, receiver)
      return isObject(result) ? readonly(result) : result
    },
    set(obj, key) {
      console.warn(`readonly: cannot modify property "${String(key)}"`)
      return true
    },
    deleteProperty(obj, key) {
      console.warn(`readonly: cannot delete property "${String(key)}"`)
      return true
    },
  })
}

/**
 * Checks whether a value is a read-only proxy.
 * @param {*} value - The value to test.
 * @returns {boolean} True if the value was created by readonly.
 */
export function isReadonly(value) {
  return !!(value && value[IS_READONLY])
}

/**
 * Returns the original raw object hidden behind a reactive/readonly proxy.
 * @param {*} value - A proxy or plain value.
 * @returns {*} The underlying raw object, or the value itself if not a proxy.
 */
export function toRaw(value) {
  return (value && value[RAW]) || value
}

// --- small utilities used across the whole reactive layer ------------------

/**
 * Checks whether a value is a non-null object (arrays included).
 * @param {*} value - The value to test.
 * @returns {boolean} True for non-null objects and arrays.
 */
export function isObject(value) {
  return value !== null && typeof value === 'object'
}

/**
 * NaN-aware inequality check: NaN !== NaN, yet such a value counts as unchanged.
 * @param {*} oldValue - The previous value.
 * @param {*} newValue - The next value.
 * @returns {boolean} True if the value actually changed.
 */
export function hasChanged(oldValue, newValue) {
  return !Object.is(oldValue, newValue)
}
