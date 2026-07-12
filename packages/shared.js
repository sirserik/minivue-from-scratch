// ============================================================================
//  shared.js — small utilities shared by the runtime, compiler, and SSR
// ----------------------------------------------------------------------------
//  In templates, class and style are convenient to specify not only as a
//  string, but also as an object or an array:
//
//    :class="{ active: isActive, done: isDone }"   // toggle classes by condition
//    :class="['btn', isPrimary && 'btn-primary']"  // list
//    :style="{ color: 'red', fontSize: size + 'px' }"
//
//  So that both the browser and SSR understand any of these forms the same way,
//  we normalize them to a canonical form here.
// ============================================================================

/**
 * Normalize a class value (string, array, or object) to a string like 'a b c'.
 * @param {string|Array|object} value - Class binding value.
 * @returns {string} Space-separated class string.
 */
export function normalizeClass(value) {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    // Array: normalize each item and join the non-empty ones.
    return value
      .map(normalizeClass)
      .filter(Boolean)
      .join(' ')
  }
  if (value && typeof value === 'object') {
    // Object { className: enabled? } — keep keys with a truthy value.
    return Object.keys(value)
      .filter((key) => value[key])
      .join(' ')
  }
  return ''
}

/**
 * Normalize a style value to an object { property: value }.
 * Arrays are merged; strings are parsed into an object.
 * @param {string|Array|object} value - Style binding value.
 * @returns {object} Style object.
 */
export function normalizeStyle(value) {
  if (Array.isArray(value)) {
    // Array of style objects — merge into one.
    const result = {}
    for (const item of value) Object.assign(result, normalizeStyle(item))
    return result
  }
  if (typeof value === 'string') {
    const result = {}
    for (const decl of value.split(';')) {
      const [prop, val] = decl.split(':')
      if (prop && val) result[prop.trim()] = val.trim()
    }
    return result
  }
  if (value && typeof value === 'object') return value
  return {}
}

/**
 * Serialize a style value to a string like 'color:red;font-size:14px'
 * (for the attribute and SSR); camelCase properties become kebab-case.
 * @param {string|Array|object} style - Style binding value.
 * @returns {string} Serialized style string.
 */
export function styleToString(style) {
  const obj = normalizeStyle(style)
  return Object.keys(obj)
    .map((k) => `${camelToKebab(k)}:${obj[k]}`)
    .join(';')
}

/**
 * Convert a camelCase string to kebab-case: fontSize → font-size.
 * @param {string} str - camelCase string.
 * @returns {string} kebab-case string.
 */
export function camelToKebab(str) {
  return str.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}
