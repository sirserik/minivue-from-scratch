// ============================================================================
//  vnode.js — the "virtual node", a description of a piece of UI as an object
// ----------------------------------------------------------------------------
//  Creating and mutating page elements directly (document.createElement, etc.)
//  is expensive and awkward. Instead we describe WHAT the UI should look like
//  with plain objects — this is what's called the virtual DOM. The renderer
//  (renderer.js) then compares "how it was" with "how it should be" and applies
//  only the necessary, targeted changes to the real page.
//
//  A single VNode is a node in the tree:
//    {
//      type,     // what it is: a tag string ('div'), Text, Fragment or a component
//      props,    // attributes/handlers: { id, class, onClick, ... }
//      children, // content: a string, an array of child VNodes, or null
//      key,      // optional key for matching nodes in lists
//      el,       // reference to the real page node (filled in on mount)
//    }
// ============================================================================

// Special node "types" that have no tag. Symbol guarantees uniqueness — they
// can't be confused with a string tag.
export const Text = Symbol('Text') // a plain text node
export const Fragment = Symbol('Fragment') // a group of nodes with no wrapping tag

/**
 * Create a VNode manually. Normally you call h() (below); createVNode is the base.
 * @param {string|symbol|object|function} type Tag string, Text/Fragment symbol, or component.
 * @param {object|null} [props] Attributes and event handlers.
 * @param {string|Array|null} [children] Child content.
 * @returns {object} The VNode.
 */
export function createVNode(type, props = null, children = null) {
  return {
    type,
    props: props || {},
    children,
    key: props && props.key != null ? props.key : null,
    el: null, // the renderer will put the real DOM node here
  }
}

// ---------------------------------------------------------------------------
//  h(type, propsOrChildren, children) — a convenient, "human-friendly" wrapper
//  over createVNode. It lets you omit props when there are none:
//
//    h('div', 'hello')                        // tag + text
//    h('div', { id: 'app' }, 'hello')         // tag + props + text
//    h('ul', [ h('li', 'a'), h('li', 'b') ])  // tag + array of children
//    h('div', { class: 'x' }, [ ...children ]) // everything together
//
//  The name h comes from "hyperscript", the historical name for such functions.
//  We keep it because the function is called the same in Vue and React.
// ---------------------------------------------------------------------------
/**
 * Create a VNode with flexible arguments (props may be omitted).
 * @param {string|symbol|object|function} type Tag string, Text/Fragment symbol, or component.
 * @param {object|string|Array|null} [propsOrChildren] Either props object or children.
 * @param {string|Array|null} [children] Child content when props is given.
 * @returns {object} The VNode.
 */
export function h(type, propsOrChildren = null, children = null) {
  // The second argument may be either props (an object) or children directly
  // (a string/array/VNode). Figure out which one was actually passed.
  if (arguments.length === 2) {
    if (isVNode(propsOrChildren)) {
      // h('div', someVNode) — a single VNode child
      return createVNode(type, null, [propsOrChildren])
    }
    if (typeof propsOrChildren === 'object' && !Array.isArray(propsOrChildren)) {
      // h('div', { props }) — this is props with no children
      return createVNode(type, propsOrChildren, null)
    }
    // h('div', 'text') or h('div', [children]) — this is children with no props
    return createVNode(type, null, propsOrChildren)
  }

  // Full form h(type, props, children).
  return createVNode(type, propsOrChildren, children)
}

/**
 * Check whether a value is a VNode.
 * @param {*} value Value to test.
 * @returns {boolean} True if the value looks like a VNode.
 */
export function isVNode(value) {
  return value != null && typeof value === 'object' && 'type' in value && 'el' in value
}

/**
 * withDirectives(vnode, [[dir, value, arg, modifiers], ...]) — attach a list of
 * custom directives to a vnode. The renderer will later call their hooks
 * (mounted/updated/unmounted). The compiler emits exactly this call for v-focus,
 * v-color, etc.
 * @param {object} vnode Target VNode.
 * @param {Array} directives Array of [dir, value, arg, modifiers] tuples.
 * @returns {object} The same vnode, with directives attached.
 */
export function withDirectives(vnode, directives) {
  vnode.dirs = directives.map(([dir, value, arg, modifiers]) => ({
    dir,
    value,
    oldValue: undefined,
    arg,
    modifiers: modifiers || {},
  }))
  return vnode
}

/**
 * Normalize a "raw" child into a VNode. Strings and numbers are wrapped in a text
 * node so the renderer works with a uniform tree made only of VNodes.
 * @param {*} child Raw child (VNode, string, number, null, boolean, etc.).
 * @returns {object} A VNode.
 */
export function normalizeVNode(child) {
  if (child == null || typeof child === 'boolean') {
    // null/undefined/false in markup means "nothing"; render an empty text node.
    return createVNode(Text, null, '')
  }
  if (typeof child === 'string' || typeof child === 'number') {
    return createVNode(Text, null, String(child))
  }
  // Already a VNode — return it as is.
  return child
}
