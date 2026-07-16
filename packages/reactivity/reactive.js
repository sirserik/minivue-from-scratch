// ============================================================================
//  reactive.js — turning a plain object into a reactive one
// ----------------------------------------------------------------------------
//  reactive(obj) returns a Proxy — a "wrapper" around the object. A Proxy lets
//  us intercept operations: reading a property (get), writing one (set),
//  deleting (deleteProperty), the `in` operator (has) and key enumeration
//  (ownKeys). We insert calls to track() and trigger() from effect.js into
//  these traps. That way the object itself, without a single extra line in the
//  user's code, starts telling the system: "I was read" / "I was changed".
//
//  reactive, shallowReactive and readonly differ only in two flags — so all
//  three are produced by ONE handler factory (createGetter/createSetter),
//  exactly like in Vue. Map/Set can't be proxied trap-by-trap (their methods
//  use internal slots the Proxy doesn't have), so they get their own
//  "instrumented" method set further below.
// ============================================================================

import { track, trigger, ITERATE_KEY, pauseTracking, resetTracking } from './effect.js'
import { isRef } from './ref.js'

// Remember Proxies we already created so that reactive(obj) twice returns the
// SAME Proxy (otherwise object comparisons would break and we'd spawn wrappers).
// Each flavor gets its own cache: reactive(x) and readonly(x) are different
// proxies of the same target and must not collide.
const reactiveMap = new WeakMap()
const shallowReactiveMap = new WeakMap()
const readonlyMap = new WeakMap()

// Internal marker keys. Reading proxy[IS_REACTIVE] tells us the object is
// already reactive, and proxy[RAW] retrieves the original "raw" object.
export const IS_REACTIVE = Symbol('isReactive')
export const IS_READONLY = Symbol('isReadonly')
export const RAW = Symbol('raw')
// The "never make reactive" mark (markRaw). reactive returns such an object as-is.
export const SKIP = Symbol('skip')

// Well-known symbols (Symbol.iterator, Symbol.toStringTag, ...). The JS engine
// reads them all the time (e.g. every for...of touches Symbol.iterator).
// Tracking them would subscribe effects to keys that never meaningfully change.
const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map((key) => Symbol[key])
    .filter((value) => typeof value === 'symbol'),
)

// ---------------------------------------------------------------------------
//  What can be made reactive? Like Vue: only Object, Array, Map, Set, WeakMap
//  and WeakSet. Everything else (Date, RegExp, Promise, DOM nodes, class
//  instances with internal slots...) would BREAK behind a Proxy — their methods
//  check `this` for hidden internal slots that the Proxy doesn't carry
//  (`Date.prototype.getTime called on incompatible receiver`). Those targets
//  are returned raw, unwrapped.
// ---------------------------------------------------------------------------
const TargetType = { INVALID: 0, COMMON: 1, COLLECTION: 2 }

function targetTypeOf(target) {
  switch (Object.prototype.toString.call(target).slice(8, -1)) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}

// Is `receiver` the proxy WE created for this target? Used by the RAW marker
// (see createGetter) to avoid leaking the raw object through proto-chain reads.
function isOwnProxy(target, receiver) {
  return (
    receiver === reactiveMap.get(target) ||
    receiver === shallowReactiveMap.get(target) ||
    receiver === readonlyMap.get(target)
  )
}

// Is the key a valid array index written as a string ('0', '1', ...)?
function isIntegerKey(key) {
  return typeof key === 'string' && String(parseInt(key, 10)) === key && parseInt(key, 10) >= 0
}

// ---------------------------------------------------------------------------
//  Array method instrumentation. Two groups of methods need special care:
//
//  1) includes/indexOf/lastIndexOf compare by identity. Elements read through
//     the proxy come out WRAPPED, so searching for the raw object would fail:
//     reactive([obj]).includes(obj) → false. We run the search against the raw
//     array too (with raw arguments) as a fallback.
//
//  2) push/pop/shift/unshift/splice both READ (length, indices) and WRITE the
//     array. If an effect calls push(), it must not get subscribed to those
//     incidental reads — two effects pushing to one array would re-trigger each
//     other forever. So we pause tracking around the call (writes still trigger).
// ---------------------------------------------------------------------------
const arrayInstrumentations = {}

for (const method of ['includes', 'indexOf', 'lastIndexOf']) {
  arrayInstrumentations[method] = function (...args) {
    const raw = toRaw(this)
    // Searching reads every element — subscribe to each index and the length.
    track(raw, 'length')
    for (let i = 0; i < raw.length; i++) track(raw, String(i))
    // First try as-is (the argument may itself be a reactive proxy)...
    const result = raw[method](...args)
    if (result === -1 || result === false) {
      // ...then retry with raw arguments against the raw array.
      return raw[method](...args.map(toRaw))
    }
    return result
  }
}

for (const method of ['push', 'pop', 'shift', 'unshift', 'splice']) {
  arrayInstrumentations[method] = function (...args) {
    pauseTracking()
    try {
      // Call through `this` (the proxy) so the writes still trigger effects.
      return Array.prototype[method].apply(this, args)
    } finally {
      resetTracking()
    }
  }
}

// ---------------------------------------------------------------------------
//  The handler factory. reactive / shallowReactive / readonly share the same
//  logic; the two flags select the differences.
// ---------------------------------------------------------------------------
function createGetter(isReadonly = false, isShallow = false) {
  return function get(obj, key, receiver) {
    // Answers to internal markers (not tracked as data).
    if (key === IS_REACTIVE) return !isReadonly
    if (key === IS_READONLY) return isReadonly
    if (key === RAW) {
      // Reveal the raw object only to our own proxy. The same trap also runs
      // when a PLAIN object inherits from this proxy (proto-chain lookup) —
      // answering there would make reactive(Object.create(someProxy)) mistake
      // the child for an already-wrapped object.
      return isOwnProxy(obj, receiver) ? obj : undefined
    }

    // Identity-sensitive and mutating array methods need special treatment.
    if (!isReadonly && Array.isArray(obj) && Object.prototype.hasOwnProperty.call(arrayInstrumentations, key)) {
      return Reflect.get(arrayInstrumentations, key, receiver)
    }

    // Reflect.get works correctly with getters and inheritance, passing the
    // right this (receiver). This is more reliable than obj[key].
    const result = Reflect.get(obj, key, receiver)

    // Well-known symbols (Symbol.iterator etc.) are engine plumbing, not data —
    // return them untracked and unwrapped.
    if (typeof key === 'symbol' && builtInSymbols.has(key)) return result

    // Report: "the current effect read obj.key". A readonly value can never
    // change, so there is nothing to track.
    if (!isReadonly) track(obj, key)

    // Shallow mode stops here: no ref unwrapping, no nested wrapping.
    if (isShallow) return result

    // A ref stored inside a reactive object unwraps automatically:
    // state.count, not state.count.value. Arrays are the exception — arr[0]
    // may legitimately hold a ref (Vue semantics).
    if (isRef(result)) {
      return Array.isArray(obj) && isIntegerKey(key) ? result : result.value
    }

    // Lazy deep reactivity: when a nested object is read, we wrap it right
    // then, on access. Not recursively up front (that would be costly and
    // would break objects that must not be reactive), but on demand.
    if (isObject(result)) {
      return isReadonly ? readonly(result) : reactive(result)
    }

    return result
  }
}

function createSetter(isShallow = false) {
  return function set(obj, key, value, receiver) {
    let oldValue = obj[key]

    if (!isShallow) {
      // If a ref sits at this key and a non-ref is being assigned, write into
      // its .value (Vue semantics) — replacing the ref would silently
      // disconnect everyone subscribed to it.
      if (!Array.isArray(obj) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
      // Compare raw values: an object and its proxy are the "same" value.
      oldValue = toRaw(oldValue)
      value = toRaw(value)
    }

    // Track whether this property existed before, to tell adding a new key
    // from changing an existing one (adding wakes iteration/length effects).
    const hadKey =
      Array.isArray(obj) && isIntegerKey(key)
        ? Number(key) < obj.length
        : Object.prototype.hasOwnProperty.call(obj, key)

    const result = Reflect.set(obj, key, value, receiver)

    // Prototype-chain guard: assigning to a child object whose PROTOTYPE is
    // also reactive runs the parent's set trap too (with the child as
    // receiver). Only the object actually written to should trigger.
    if (obj !== toRaw(receiver)) return result

    // Run effects only if something actually changed — otherwise assigning
    // the same value would needlessly wake up the whole UI.
    if (!hadKey) {
      // A new key was added.
      trigger(obj, key, 'add')
    } else if (hasChanged(oldValue, value)) {
      // An existing key got a new value. For arr.length we pass the new value
      // so trigger can also wake effects reading removed indices.
      trigger(obj, key, 'set', value)
    }

    return result
  }
}

function createDeleteProperty() {
  return function deleteProperty(obj, key) {
    const had = Object.prototype.hasOwnProperty.call(obj, key)
    const result = Reflect.deleteProperty(obj, key)
    if (had && result) {
      trigger(obj, key, 'delete')
    }
    return result
  }
}

// `key in obj` reads the object too — track it like a get.
function has(obj, key) {
  const result = Reflect.has(obj, key)
  if (typeof key !== 'symbol' || !builtInSymbols.has(key)) {
    track(obj, key)
  }
  return result
}

// for...in / Object.keys enumerate the KEYS. There is no single key to track,
// so we track the special ITERATE_KEY (arrays: 'length', because adding or
// removing array elements always moves the length).
function ownKeys(obj) {
  track(obj, Array.isArray(obj) ? 'length' : ITERATE_KEY)
  return Reflect.ownKeys(obj)
}

const mutableHandlers = {
  get: createGetter(false, false),
  set: createSetter(false),
  deleteProperty: createDeleteProperty(),
  has,
  ownKeys,
}

const shallowHandlers = {
  get: createGetter(false, true),
  set: createSetter(true),
  deleteProperty: createDeleteProperty(),
  has,
  ownKeys,
}

const readonlyHandlers = {
  get: createGetter(true, false),
  set(obj, key) {
    console.warn(`readonly: cannot modify property "${String(key)}"`)
    return true
  },
  deleteProperty(obj, key) {
    console.warn(`readonly: cannot delete property "${String(key)}"`)
    return true
  },
}

// ---------------------------------------------------------------------------
//  Map / Set instrumentation. A Proxy can't intercept map.get('a') the usual
//  way: Map methods work on hidden internal slots that live on the ORIGINAL
//  object, not the Proxy — calling them with the Proxy as `this` throws
//  "called on incompatible receiver". So instead of forwarding, our get trap
//  substitutes the methods below, which run against the raw collection and
//  weave in track/trigger by hand.
// ---------------------------------------------------------------------------

// Wrap values coming OUT of a collection, mirroring the deep get trap.
function wrap(value) {
  return isObject(value) ? reactive(value) : value
}

const collectionInstrumentations = {
  // --- Map ---
  get(key) {
    const target = toRaw(this)
    track(target, key)
    return wrap(target.get(key))
  },
  set(key, value) {
    const target = toRaw(this)
    const had = target.has(key)
    const oldValue = target.get(key)
    target.set(key, toRaw(value))
    if (!had) {
      trigger(target, key, 'add')
    } else if (hasChanged(oldValue, toRaw(value))) {
      trigger(target, key, 'set')
    }
    return this
  },

  // --- Set ---
  add(value) {
    const target = toRaw(this)
    value = toRaw(value)
    if (!target.has(value)) {
      target.add(value)
      trigger(target, value, 'add')
    }
    return this
  },

  // --- shared ---
  has(key) {
    const target = toRaw(this)
    track(target, key)
    return target.has(key)
  },
  delete(key) {
    const target = toRaw(this)
    const had = target.has(key)
    const result = target.delete(key)
    if (had) trigger(target, key, 'delete')
    return result
  },
  clear() {
    const target = toRaw(this)
    const hadItems = target.size > 0
    target.clear()
    // Everything is gone at once — trigger every dep of this collection.
    if (hadItems) trigger(target, undefined, 'clear')
  },
  forEach(callback, thisArg) {
    const target = toRaw(this)
    // Iteration depends on the whole shape of the collection.
    track(target, ITERATE_KEY)
    target.forEach((value, key) => {
      callback.call(thisArg, wrap(value), wrap(key), this)
    })
  },
}

// keys() / values() / entries() / for...of — same idea as forEach: track
// ITERATE_KEY and wrap what comes out.
for (const method of ['keys', 'values', 'entries', Symbol.iterator]) {
  collectionInstrumentations[method] = function (...args) {
    const target = toRaw(this)
    track(target, ITERATE_KEY)
    const innerIterator = target[method](...args)
    // entries() (and Map's default iterator) yield [key, value] pairs.
    const yieldsPairs = method === 'entries' || (method === Symbol.iterator && target instanceof Map)
    return {
      next() {
        const { value, done } = innerIterator.next()
        if (done) return { value, done }
        return {
          value: yieldsPairs ? [wrap(value[0]), wrap(value[1])] : wrap(value),
          done,
        }
      },
      [Symbol.iterator]() {
        return this
      },
    }
  }
}

const collectionHandlers = {
  get(target, key, receiver) {
    if (key === IS_REACTIVE) return true
    if (key === RAW) return isOwnProxy(target, receiver) ? target : undefined
    if (key === 'size') {
      track(target, ITERATE_KEY)
      return Reflect.get(target, 'size', target) // size is a getter — needs the raw this
    }
    if (Object.prototype.hasOwnProperty.call(collectionInstrumentations, key)) {
      return Reflect.get(collectionInstrumentations, key, receiver)
    }
    return Reflect.get(target, key, receiver)
  },
}

// ---------------------------------------------------------------------------
//  The three public creators, all funneling through createReactiveObject.
// ---------------------------------------------------------------------------
function createReactiveObject(target, handlers, cache, isReadonly = false) {
  // Only objects are worth wrapping. Primitives are not: ref exists for them.
  if (!isObject(target)) return target

  // markRaw said "never make this reactive" — respect it.
  if (target[SKIP]) return target

  // If target is already a proxy of the right kind, return it as-is (reading
  // RAW on a plain object gives undefined; on our Proxy the original object).
  // readonly(reactive(x)) is the legal exception: a readonly view of a proxy.
  if (target[RAW] && !(isReadonly && target[IS_REACTIVE])) return target

  // We already wrapped this object — return the existing proxy. This keeps
  // identity stable: state.nested === state.nested on every read.
  const existing = cache.get(target)
  if (existing) return existing

  const type = targetTypeOf(target)
  // Date, RegExp, Promise, class instances with internal slots... — a Proxy
  // would break their methods, so they stay raw (same as Vue).
  if (type === TargetType.INVALID) return target

  const proxy = new Proxy(target, type === TargetType.COLLECTION ? collectionHandlers : handlers)
  cache.set(target, proxy)
  return proxy
}

/**
 * Wraps an object in a Proxy that tracks reads and triggers effects on writes,
 * making it deeply reactive (nested objects are wrapped lazily on access).
 * @param {object} target - The object (array, Map, Set...) to make reactive.
 * @returns {object} A reactive proxy; primitives, markRaw'd and non-proxyable
 *   objects (Date, RegExp...) are returned unchanged.
 */
export function reactive(target) {
  return createReactiveObject(target, mutableHandlers, reactiveMap)
}

// --- shallowReactive -------------------------------------------------------
// Top-level reactivity only: state.count is reactive, but state.nested.x is
// not. Cheaper than deep reactivity when nested data won't change.
/**
 * Creates a reactive proxy that tracks only top-level properties; nested
 * objects are not wrapped and refs are not unwrapped.
 * @param {object} target - The object to make shallowly reactive.
 * @returns {object} A shallow reactive proxy (primitives returned unchanged).
 */
export function shallowReactive(target) {
  return createReactiveObject(target, shallowHandlers, shallowReactiveMap)
}

// --- readonly --------------------------------------------------------------
// Read-only: reading is allowed (nested values are readonly too), while writing
// is silently blocked with a warning. Reads are not tracked — a value that can
// never change through this proxy has nothing to notify. Note: readonly Map/Set
// views are not implemented here (Vue has them; we keep the layer small).
/**
 * Creates a deeply read-only proxy: reads pass through, writes and deletes are
 * blocked with a warning. Nested proxies are cached, so identity is stable.
 * @param {object} target - The object to protect.
 * @returns {object} A read-only proxy (primitives returned unchanged).
 */
export function readonly(target) {
  return createReactiveObject(target, readonlyHandlers, readonlyMap, true)
}

/**
 * Checks whether a value is a reactive proxy.
 * @param {*} value - The value to test.
 * @returns {boolean} True if the value was created by reactive/shallowReactive.
 */
export function isReactive(value) {
  return !!(value && value[IS_REACTIVE])
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
 * Checks whether a value is ANY proxy created by this package — reactive,
 * shallowReactive or readonly. Mirrors Vue's isProxy.
 * @param {*} value - The value to test.
 * @returns {boolean} True if the value is one of our proxies.
 */
export function isProxy(value) {
  return isReactive(value) || isReadonly(value)
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

/**
 * Returns the original raw object hidden behind a reactive/readonly proxy,
 * peeling nested wrappers (readonly over reactive) all the way down.
 * @param {*} value - A proxy or plain value.
 * @returns {*} The underlying raw object, or the value itself if not a proxy.
 */
export function toRaw(value) {
  const raw = value && value[RAW]
  return raw ? toRaw(raw) : value
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
