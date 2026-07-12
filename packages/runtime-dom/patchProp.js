// ============================================================================
//  patchProp.js — how to apply a single prop to a real element
// ----------------------------------------------------------------------------
//  The renderer calls patchProp(el, key, prevValue, nextValue) for each prop.
//  "Props" come in very different flavors: plain attributes (id, class), event
//  handlers (onClick), styles (style), boolean values. Here we decide how
//  exactly to apply each of them to the DOM.
// ============================================================================

import { normalizeClass, normalizeStyle, camelToKebab } from '../shared.js'

/**
 * Apply a single prop to a real DOM element, dispatching by prop kind
 * (class, style, event handler, or plain attribute).
 * @param {Element} el - Target DOM element.
 * @param {string} key - Prop name (e.g. 'class', 'style', 'onClick', 'id').
 * @param {*} prevValue - Previous value, used to remove the old event/style.
 * @param {*} nextValue - New value to apply.
 */
export function patchProp(el, key, prevValue, nextValue) {
  if (key === 'class') {
    // class may arrive as a string, array, or object — coerce to a string.
    el.className = normalizeClass(nextValue)
  } else if (key === 'style') {
    patchStyle(el, prevValue, nextValue)
  } else if (isEventKey(key)) {
    // onClick, onInput, etc. — these are event handlers.
    patchEvent(el, key, prevValue, nextValue)
  } else {
    patchAttr(el, key, nextValue)
  }
}

// Event-handler key: starts with 'on' followed by an uppercase letter (onClick).
function isEventKey(key) {
  return /^on[A-Z]/.test(key)
}

// onClick → 'click'. Strip 'on' and lowercase the rest.
function eventName(key) {
  return key.slice(2).toLowerCase()
}

function patchEvent(el, key, prevValue, nextValue) {
  const name = eventName(key)
  // Remove the old handler if there was one, then attach the new one.
  if (prevValue) el.removeEventListener(name, prevValue)
  if (nextValue) el.addEventListener(name, nextValue)
}

function patchStyle(el, prev, next) {
  const nextObj = normalizeStyle(next)
  const prevObj = normalizeStyle(prev)
  // Set/update the new style properties (kebab-case via setProperty).
  for (const name in nextObj) {
    el.style.setProperty(camelToKebab(name), nextObj[name])
  }
  // Remove the ones that existed before but are now gone.
  for (const name in prevObj) {
    if (nextObj[name] == null) el.style.removeProperty(camelToKebab(name))
  }
}

function patchAttr(el, key, nextValue) {
  // For value/checked on input fields we write to the PROPERTY directly,
  // otherwise the browser won't update an already-rendered field (the attribute
  // only sets the initial value).
  if ((key === 'value' || key === 'checked') && key in el) {
    el[key] = key === 'checked' ? !!nextValue : nextValue == null ? '' : nextValue
    return
  }
  if (nextValue == null || nextValue === false) {
    // null / undefined / false — the attribute must be removed.
    el.removeAttribute(key)
  } else {
    el.setAttribute(key, nextValue === true ? '' : nextValue)
  }
}
