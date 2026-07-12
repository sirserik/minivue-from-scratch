// ============================================================================
//  ref.js — a reactive wrapper around a single value
// ----------------------------------------------------------------------------
//  A Proxy can only track the PROPERTIES of an object. So how do we make a
//  plain number or string reactive? We can't — a primitive has no properties
//  to intercept. The solution: put the value inside an object under a .value
//  property and track reads/writes of that .value.
//
//  That is why a ref is always accessed through .value:
//    const count = ref(0)
//    count.value++             // write → trigger
//    console.log(count.value)  // read  → track
// ============================================================================

import { trackEffects, triggerEffects, activeEffect } from './effect.js'
import { reactive, isObject, hasChanged, toRaw } from './reactive.js'

class RefImpl {
  constructor(value) {
    // If an object was put inside the ref, wrap it in reactive so its nested
    // properties are reactive too. Primitives are stored as-is.
    this._value = convert(value)
    this._rawValue = value // raw value kept for comparison on write
    // This ref's own set of effects (the equivalent of a dep from targetMap,
    // but a ref keeps it directly on itself — it has only one "property", value).
    this.dep = new Set()
    this.__isRef = true
  }

  get value() {
    // Reading .value is the moment to link the active effect to this ref.
    if (activeEffect) trackEffects(this.dep)
    return this._value
  }

  set value(newValue) {
    // Compare against the "raw" old value (without the reactive wrapper),
    // otherwise comparing an object with its Proxy would always look "changed".
    if (hasChanged(toRaw(newValue), this._rawValue)) {
      this._rawValue = toRaw(newValue)
      this._value = convert(newValue)
      // The value changed — wake up every effect that read this ref.
      triggerEffects(this.dep)
    }
  }
}

function convert(value) {
  return isObject(value) ? reactive(value) : value
}

/**
 * Creates a reactive reference around a single value, accessed via `.value`.
 * If the value is an object, it is made deeply reactive.
 * @param {*} value - The initial value (primitive or object).
 * @returns {RefImpl} A ref; returns the argument unchanged if it is already a ref.
 */
export function ref(value) {
  // Already a ref — don't wrap it again.
  if (isRef(value)) return value
  return new RefImpl(value)
}

// shallowRef — like ref, but does NOT make its contents reactive and reacts
// only to replacing the whole .value (not to mutating fields of the inner
// object). Useful for large objects you change by replacement, not mutation.
class ShallowRefImpl {
  constructor(value) {
    this._value = value
    this.dep = new Set()
    this.__isRef = true
  }
  get value() {
    if (activeEffect) trackEffects(this.dep)
    return this._value
  }
  set value(newValue) {
    if (hasChanged(newValue, this._value)) {
      this._value = newValue
      triggerEffects(this.dep)
    }
  }
}

/**
 * Creates a shallow ref: only replacing `.value` is tracked, not mutations of
 * the inner object.
 * @param {*} value - The initial value.
 * @returns {ShallowRefImpl} A shallow ref.
 */
export function shallowRef(value) {
  return new ShallowRefImpl(value)
}

/**
 * Manually triggers effects that depend on a shallowRef, for cases where you
 * mutated a field inside its value and want to notify subscribers.
 * @param {object} ref - The ref whose dependents should be re-run.
 */
export function triggerRef(ref) {
  if (ref && ref.dep) triggerEffects(ref.dep)
}

/**
 * Checks whether a value is a ref.
 * @param {*} value - The value to test.
 * @returns {boolean} True if the value is a ref.
 */
export function isRef(value) {
  return !!(value && value.__isRef === true)
}

/**
 * Returns the inner value of a ref, or the value itself if it is not a ref.
 * Handy when a value may arrive either as a ref or as a plain value.
 * @param {*} value - A ref or a plain value.
 * @returns {*} `value.value` if it is a ref, otherwise `value`.
 */
export function unref(value) {
  return isRef(value) ? value.value : value
}

// ---------------------------------------------------------------------------
//  toRef / toRefs — a "bridge" between a reactive object and a ref.
//  The problem: pulling a property off a reactive object with plain
//  destructuring (const { count } = state) breaks the reactive link — count
//  becomes just a number. toRef creates a ref that reads/writes straight into
//  the source object, preserving the reactive connection.
// ---------------------------------------------------------------------------
class ObjectRefImpl {
  constructor(object, key) {
    this._object = object
    this._key = key
    this.__isRef = true
  }
  get value() {
    // The read goes through the reactive object, so track happens on its own.
    return this._object[this._key]
  }
  set value(newValue) {
    this._object[this._key] = newValue
  }
}

/**
 * Creates a ref bound to a single property of a reactive object, keeping the
 * reactive link even after the property is extracted.
 * @param {object} object - The source reactive object.
 * @param {string|symbol} key - The property to bind to.
 * @returns {ObjectRefImpl} A ref that reads/writes `object[key]`.
 */
export function toRef(object, key) {
  return new ObjectRefImpl(object, key)
}

/**
 * Converts a reactive object into a plain object (or array) whose every
 * property is a ref bound to the original, so it survives destructuring.
 * @param {object|Array} object - The source reactive object or array.
 * @returns {object|Array} An object/array of refs mirroring the source keys.
 */
export function toRefs(object) {
  const result = Array.isArray(object) ? new Array(object.length) : {}
  for (const key in object) {
    result[key] = toRef(object, key)
  }
  return result
}

// ---------------------------------------------------------------------------
//  proxyRefs — "automatic .value unwrapping".
//  Inside Vue templates you write {{ count }}, not {{ count.value }}. proxyRefs
//  provides that convenience: it wraps an object so that reading a ref property
//  automatically returns its .value, and writing assigns into that .value.
//  This is exactly what the components layer later applies to the setup() result.
// ---------------------------------------------------------------------------
/**
 * Wraps an object so that ref properties are automatically unwrapped on read
 * and assigned into their `.value` on write.
 * @param {object} objectWithRefs - An object that may contain refs.
 * @returns {Proxy} A proxy that transparently unwraps its ref properties.
 */
export function proxyRefs(objectWithRefs) {
  return new Proxy(objectWithRefs, {
    get(target, key, receiver) {
      // Read the property and, if it is a ref, unwrap it to its value.
      return unref(Reflect.get(target, key, receiver))
    },
    set(target, key, value, receiver) {
      const oldValue = target[key]
      // If a ref sits there and a non-ref is being assigned, write into its
      // .value to preserve reactivity. Otherwise do a plain write.
      if (isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
      return Reflect.set(target, key, value, receiver)
    },
  })
}
