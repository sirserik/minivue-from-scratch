// ============================================================================
//  apiInject.js — provide / inject
// ----------------------------------------------------------------------------
//  Data is usually passed top-down through props: parent → child → grandchild.
//  If a grandchild deep down needs something from a distant ancestor, threading
//  it through every intermediate component ("prop drilling") is painful.
//  provide/inject solve this: an ancestor calls provide('key', value), and any
//  descendant inject('key') gets it directly, skipping the intermediate layers.
//
//  The implementation trick is prototype-based inheritance. Each component's
//  provides object inherits the parent's provides (Object.create). So reading a
//  key climbs the ancestor chain on its own until it finds a value.
// ============================================================================

import { getCurrentInstance } from './component.js'

/**
 * Provide a value keyed by `key` to all descendant components. Must be called
 * inside setup().
 * @param {string|symbol} key Injection key.
 * @param {*} value Value made available to descendants via inject.
 */
export function provide(key, value) {
  const instance = getCurrentInstance()
  if (!instance) {
    console.warn('provide() can only be called inside setup()')
    return
  }

  let provides = instance.provides
  // Initially instance.provides REFERENCES the parent's provides (the same object).
  // The first time a component provides something of its own, we give it its own
  // object that inherits the parent's. That way its keys don't pollute the
  // ancestor, but inherited ones remain visible.
  const parentProvides = instance.parent
    ? instance.parent.provides
    : instance.appContext.provides
  if (provides === parentProvides) {
    provides = instance.provides = Object.create(parentProvides)
  }

  provides[key] = value
}

/**
 * Inject a value provided by an ancestor (or at the app level). Must be called
 * inside setup().
 * @param {string|symbol} key Injection key to look up.
 * @param {*} [defaultValue] Returned when no provider is found.
 * @returns {*} The provided value, or `defaultValue` if none exists.
 */
export function inject(key, defaultValue) {
  const instance = getCurrentInstance()
  if (!instance) {
    console.warn('inject() can only be called inside setup()')
    return defaultValue
  }

  // Search what ancestors provided (the parent's provides is the whole chain via
  // the prototype), or at the app level (app.provide).
  const provides = instance.parent
    ? instance.parent.provides
    : instance.appContext.provides

  if (key in provides) {
    return provides[key]
  }
  return defaultValue
}
